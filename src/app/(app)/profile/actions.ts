"use server";

import { revalidatePath } from "next/cache";
import { AiUnavailableError } from "@/lib/ai/openai";
import { requireOwner, requireUser } from "@/lib/auth";
import {
  REQUIRED_FIELDS,
  WEEKDAYS,
  draftFromSaved,
  mergeUpdates,
  missingFields,
  normalizeUsPhone,
  parseZips,
  type AgentQuestion,
} from "@/lib/setup/draft";
import { generateCampaignPlan, loadSaved, loadSetupContext, saveSetup } from "@/lib/setup/service";
import { createClient } from "@/lib/supabase/server";

export type ProfileState = { error?: string; message?: string } | undefined;

/** Core questions the qualification logic depends on: always asked, always required. */
const CORE_QUESTION_KEYS = ["service", "zip_code", "homeowner"];

function num(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? "").replace(/[$,\s]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

export async function saveDemandProfile(_: ProfileState, formData: FormData): Promise<ProfileState> {
  const workspace = await requireOwner();
  const user = await requireUser();
  const supabase = await createClient();
  const [ctx, saved] = await Promise.all([loadSetupContext(supabase, workspace), loadSaved(supabase, workspace.id)]);
  const current = draftFromSaved(saved.profile, saved.agent);

  const hours = WEEKDAYS.filter((d) => formData.get(`hours_${d}_on`)).map((day) => ({
    day,
    start: String(formData.get(`hours_${day}_start`) ?? ""),
    end: String(formData.get(`hours_${day}_end`) ?? ""),
  }));
  const zipText = String(formData.get("zip_codes") ?? "");

  // Start from blank for every field this form shows, so clearing a box really clears it.
  const blank = {
    ...current,
    services: [],
    lead_types: [],
    customer_types: [],
    zip_codes: [],
    booking_hours: {},
    capacity_per_day: null,
    appointment_minutes: null,
    monthly_budget: null,
    target_cost_per_appointment: null,
  };
  const { draft, rejected } = mergeUpdates(
    blank,
    {
      services: formData.getAll("services").map(String),
      lead_types: formData.getAll("lead_types").map(String),
      customer_types: formData.getAll("customer_types").map(String),
      zip_codes: zipText.trim() ? [zipText] : null,
      booking_hours: hours.length ? hours : null,
      capacity_per_day: num(formData, "capacity_per_day"),
      appointment_minutes: num(formData, "appointment_minutes"),
      monthly_budget: num(formData, "monthly_budget"),
      target_cost_per_appointment: num(formData, "target_cost_per_appointment"),
    },
    { services: ctx.services.map((s) => s.value), customerTypes: ctx.customerTypes.map((s) => s.value) },
  );
  const notes = String(formData.get("notes") ?? "").trim();
  draft.notes = notes ? notes.slice(0, 1000) : null;

  if (rejected.length) {
    const first = rejected[0].split(":")[0];
    const label = REQUIRED_FIELDS.find((f) => f.key === first)?.label ?? first.replaceAll("_", " ");
    return { error: `Please check '${label}'. ${rejected[0].split(": ").slice(1).join(": ")}` };
  }
  const missing = missingFields(draft).filter((k) => k !== "transfer_phone" && k !== "questions_confirmed");
  if (missing.length) {
    return { error: `Please fill in: ${missing.map((k) => REQUIRED_FIELDS.find((f) => f.key === k)!.label).join(", ")}.` };
  }
  if (parseZips(zipText).length > 500) return { error: "Please list at most 500 ZIP codes." };

  await saveSetup(supabase, workspace.id, user.id, draft, "form");
  revalidatePath("/profile");
  return { message: "Saved." };
}

export async function saveAgentSettings(_: ProfileState, formData: FormData): Promise<ProfileState> {
  const workspace = await requireOwner();
  const user = await requireUser();
  const supabase = await createClient();
  const { agent } = await loadSaved(supabase, workspace.id);
  const savedByKey = new Map((agent?.questions ?? []).map((q) => [q.key, q]));

  const phoneRaw = String(formData.get("transfer_phone") ?? "").trim();
  const transferPhone = phoneRaw ? normalizeUsPhone(phoneRaw) : null;
  if (phoneRaw && !transferPhone) return { error: "The transfer phone doesn't look like a valid US number." };
  if (!transferPhone) return { error: "Please add a phone number for live transfers." };

  const keys = formData.getAll("q_key").map(String);
  const texts = formData.getAll("q_text").map((t) => String(t).replace(/\s+/g, " ").trim());
  let customN = 0;
  const questions: AgentQuestion[] = [];
  keys.forEach((key, i) => {
    const text = texts[i]?.slice(0, 200);
    const saved = savedByKey.get(key);
    const core = CORE_QUESTION_KEYS.includes(key);
    if (!text || text.length < 5) {
      if (core && saved) questions.push(saved); // core questions cannot be removed
      return;
    }
    if (saved && !key.startsWith("custom_")) {
      questions.push({ ...saved, question: text, required: core || formData.has(`q_required:${i}`) });
    } else {
      customN += 1;
      questions.push({ key: `custom_${customN}`, question: text, answer_type: "text", required: formData.has(`q_required:${i}`) });
    }
  });
  if (questions.length > 20) return { error: "Please keep it to 20 questions or fewer." };

  const greeting = String(formData.get("greeting") ?? "").trim().slice(0, 300) || null;
  const version = (agent?.version ?? 0) + 1;
  const { error } = await supabase
    .from("agent_settings")
    .update({ questions, transfer_phone: transferPhone, greeting, version, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Could not save. Please try again." };

  await supabase.from("events").insert({
    workspace_id: workspace.id,
    type: "agent_settings.updated",
    subject_table: "agent_settings",
    subject_id: workspace.id,
    actor_id: user.id,
    payload: { source: "form", version },
  });
  revalidatePath("/profile");
  return { message: "Saved." };
}

export async function regeneratePlan(): Promise<ProfileState> {
  const workspace = await requireOwner();
  const user = await requireUser();
  const supabase = await createClient();
  const { profile, agent } = await loadSaved(supabase, workspace.id);
  const draft = draftFromSaved(profile, agent);
  if (missingFields(draft).filter((k) => k !== "transfer_phone").length) {
    return { error: "Fill in your services, area, hours, capacity and budget first." };
  }
  try {
    await generateCampaignPlan(supabase, workspace, user.id, draft);
  } catch (e) {
    if (e instanceof AiUnavailableError) return { error: "The AI service isn't responding right now. Please try again in a moment." };
    throw e;
  }
  revalidatePath("/profile");
  return { message: "New plan created." };
}

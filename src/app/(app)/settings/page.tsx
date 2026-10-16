import type { Metadata } from "next";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BUSINESS_TYPES, STATUS_LABELS, type BusinessType, type Registration, type TextingStatus } from "@/lib/texting/registration";
import { removeMember, revokeInvite } from "./actions";
import { AutoCallForm, BusinessForm, InviteForm, TextingForm } from "./forms";
import { TwoFactorCard } from "./two-factor";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const workspace = await requireWorkspace();
  const isOwner = workspace.role === "owner";
  const supabase = await createClient();

  const [{ data: business }, { data: members }, { data: invites }, { data: voice }, { data: numbers }, { data: texting }] = await Promise.all([
    supabase.from("workspaces").select("name, timezone, phone, website").eq("id", workspace.id).single(),
    supabase
      .from("workspace_members")
      .select("user_id, role, profiles (email, full_name)")
      .eq("workspace_id", workspace.id)
      .order("created_at"),
    isOwner
      ? supabase
          .from("workspace_invites")
          .select("id, email, role, expires_at")
          .eq("workspace_id", workspace.id)
          .is("accepted_at", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; email: string; role: string; expires_at: string }[] }),
    supabase.from("voice_agents").select("retell_agent_id, auto_call").eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("phone_numbers").select("e164").eq("workspace_id", workspace.id),
    // Owners only (holds the EIN; RLS hides it from staff too).
    isOwner ? supabase.from("texting_registrations").select("*").eq("workspace_id", workspace.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const totp = factors?.totp[0] ?? null;
  const reg = texting as (Registration & { status: TextingStatus; admin_note: string | null }) | null;
  const regEditable = !reg || reg.status === "draft" || reg.status === "rejected";
  const aiReady = Boolean(voice?.retell_agent_id);
  const aiNumber = numbers?.[0]?.e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") ?? null;

  return (
    <>
      <PageHeader title="Settings" description="Business details and team." />

      <div className="grid items-start gap-6 lg:grid-cols-2 lg:gap-8">
        <Card className="p-6">
          <h2 className="mb-4 font-semibold text-slate-900">Business</h2>
          {business ? <BusinessForm business={business} disabled={!isOwner} /> : null}
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-900">AI caller</h2>
            {voice?.auto_call ? <Badge tone="green">Calling new leads</Badge> : <Badge>Automatic calls off</Badge>}
          </div>
          <ul className="mb-5 space-y-1.5 text-sm text-slate-600">
            <li>AI caller: {aiReady ? <span className="font-medium text-slate-900">ready</span> : "being set up by Lead96"}</li>
            <li>Calls from: {aiNumber ? <span className="font-medium tabular-nums text-slate-900">{aiNumber}</span> : "no number yet"}</li>
          </ul>
          <p className="mb-4 text-sm leading-relaxed text-slate-500">
            When on, the AI calls each new form lead within a minute, between 8am and 8pm, and tries up to 3 times. It only calls people who agreed to AI
            calls on the form, stays inside your service area, and never calls anyone who asked not to be called.
          </p>
          {isOwner ? <AutoCallForm on={Boolean(voice?.auto_call)} ready={aiReady} /> : <p className="text-xs text-slate-500">Only owners can change this.</p>}
        </Card>

        <Card className="p-6">
          <h2 className="mb-2 font-semibold text-slate-900">Two-factor sign-in</h2>
          <p className="mb-4 text-sm leading-relaxed text-slate-500">
            Ask for a code from an authenticator app after your password, so a stolen password alone can&apos;t open your account. Applies to your own
            sign-in.
          </p>
          <TwoFactorCard
            on={Boolean(totp)}
            since={totp ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(totp.created_at)) : null}
          />
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 font-semibold text-slate-900">Team</h2>
          <ul className="divide-y divide-slate-100">
            {(members ?? []).map((m) => {
              const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
              return (
                <li key={m.user_id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{p?.full_name || p?.email}</p>
                    <p className="truncate text-xs text-slate-500">
                      {p?.email} · <span className="capitalize">{m.role}</span>
                    </p>
                  </div>
                  {isOwner && m.role !== "owner" ? (
                    <form action={removeMember}>
                      <input type="hidden" name="userId" value={m.user_id} />
                      <button className="text-xs text-red-600 hover:underline">Remove</button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {isOwner ? (
            <>
              {invites && invites.length > 0 ? (
                <div className="mt-4">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Pending invites</p>
                  <ul className="divide-y divide-slate-100">
                    {invites.map((inv) => (
                      <li key={inv.id} className="flex items-center justify-between py-2 text-sm">
                        <span className="text-slate-700">
                          {inv.email} · <span className="capitalize">{inv.role}</span>
                        </span>
                        <form action={revokeInvite}>
                          <input type="hidden" name="inviteId" value={inv.id} />
                          <button className="text-xs text-slate-500 hover:underline">Revoke</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-5 border-t border-slate-100 pt-5">
                <InviteForm />
              </div>
            </>
          ) : null}
        </Card>

        {isOwner ? (
          <Card className="p-6 lg:col-span-2">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-slate-900">Texting (US SMS registration)</h2>
              <Badge tone={STATUS_LABELS[reg?.status ?? "draft"].tone}>{STATUS_LABELS[reg?.status ?? "draft"].label}</Badge>
            </div>
            <p className="mb-5 max-w-3xl text-sm leading-relaxed text-slate-500">
              Before the AI can text your customers (follow-ups after a missed call, visit reminders), US carriers need your business registered as the
              sender. Lead96 files it for you with these details; the review takes about 2-3 weeks. Until then, customers get their visit confirmation
              and reminders by email.
            </p>
            {reg?.status === "rejected" && reg.admin_note ? (
              <div className="mb-5">
                <Alert tone="error">Please fix and send again: {reg.admin_note}</Alert>
              </div>
            ) : null}
            {regEditable ? (
              <TextingForm values={reg} />
            ) : (
              <>
                <p className="mb-4 text-sm text-slate-600">
                  {reg?.status === "approved"
                    ? "Your business is registered. The AI can text customers who agreed to texts on your form."
                    : reg?.status === "in_review"
                      ? "Lead96 filed your registration. The carriers are reviewing it (about 2-3 weeks)."
                      : "Lead96 has your details and will file the registration. We keep you posted here."}
                  {reg?.admin_note ? ` ${reg.admin_note}` : ""}
                </p>
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {[
                    ["Legal name", reg?.legal_name],
                    ["Business type", BUSINESS_TYPES[reg?.business_type as BusinessType]],
                    ["EIN", reg?.ein],
                    ["Website", reg?.website],
                    ["Address", `${reg?.street}, ${reg?.city}, ${reg?.state} ${reg?.zip}`],
                    ["Contact", `${reg?.contact_first_name} ${reg?.contact_last_name} (${reg?.contact_title})`],
                  ].map(([k, val]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="w-28 shrink-0 text-slate-500">{k}</dt>
                      <dd className="min-w-0 break-words text-slate-900">{val}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-xs text-slate-500">To change these details, contact Lead96 at admin@lead96.com.</p>
              </>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}

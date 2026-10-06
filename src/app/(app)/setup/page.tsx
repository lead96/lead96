import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getUser, requireOwner } from "@/lib/auth";
import { draftFromSaved, missingFields } from "@/lib/setup/draft";
import { getActiveConversation, greeting, loadSaved, loadSetupContext } from "@/lib/setup/service";
import { createClient } from "@/lib/supabase/server";
import { SetupChat } from "./setup-chat";

export const metadata: Metadata = { title: "Setup assistant" };

export default async function SetupPage() {
  const workspace = await requireOwner();
  const user = await getUser();
  const supabase = await createClient();
  const isUpdate = Boolean(workspace.setupCompletedAt);

  const [ctx, conversation] = await Promise.all([
    loadSetupContext(supabase, workspace),
    getActiveConversation(supabase, workspace.id),
  ]);

  // No conversation row is created until the first message (page loads have no side effects).
  let draft = conversation?.extracted;
  if (!draft) {
    const saved = isUpdate ? await loadSaved(supabase, workspace.id) : null;
    draft = draftFromSaved(saved?.profile ?? null, saved?.agent ?? null);
  }
  const messages = conversation?.messages ?? [
    { role: "assistant" as const, content: greeting(workspace.name, isUpdate), at: new Date().toISOString() },
  ];
  const intent = user?.user_metadata?.lead_intent;
  const suggestion = !conversation && !isUpdate && typeof intent === "string" ? intent : "";

  return (
    <>
      <PageHeader
        title="Setup assistant"
        description="Answer a few questions. We'll save your services, area, hours and AI call questions, and suggest a campaign plan."
      />
      <SetupChat
        initial={{ messages, draft, missing: missingFields(draft) }}
        options={{ services: ctx.services, customerTypes: ctx.customerTypes }}
        defaultQuestions={ctx.defaultQuestions}
        suggestion={suggestion}
        hasConversation={Boolean(conversation)}
      />
    </>
  );
}

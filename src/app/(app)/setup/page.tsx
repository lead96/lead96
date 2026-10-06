import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";

export const metadata: Metadata = { title: "Setup assistant" };

// Placeholder: the chat-based setup assistant (Exhibit A.1) replaces this page.
export default async function SetupPage() {
  await requireOwner();

  return (
    <>
      <PageHeader
        title="Setup assistant"
        description="Answer a few questions and we'll set up your services, area, hours, AI call questions and a campaign plan."
      />
      <Card className="p-10 text-center text-sm text-slate-500">The setup chat is being built.</Card>
    </>
  );
}

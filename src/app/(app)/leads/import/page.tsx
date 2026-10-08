import type { Metadata } from "next";
import { Alert, Card, PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { Importer } from "./importer";

export const metadata: Metadata = { title: "Import leads" };

export default async function ImportLeadsPage() {
  const workspace = await requireWorkspace();

  return (
    <>
      <PageHeader
        title="Import leads"
        description="Bring in leads from a spreadsheet or your old CRM. People already in Lead96 are matched by phone or email, not added twice."
        back={{ href: "/leads", label: "Leads" }}
      />
      {workspace.role === "owner" ? (
        <Importer timezone={workspace.timezone} />
      ) : (
        <Card className="max-w-xl p-6">
          <Alert tone="info">Only the account owner can import leads. You can still add leads one at a time.</Alert>
        </Card>
      )}
    </>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert, Badge, Card, PageHeader, Section, buttonClass } from "@/components/ui";
import { getProfile } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { formatDateTime, timeAgo } from "@/lib/format";
import { getConnection, googleConfig, GoogleAdsError, listClientAccounts, type ClientAccount, type SyncSummary } from "@/lib/google/ads";
import { createAdminClient } from "@/lib/supabase/server";
import { disconnectGoogle } from "./actions";
import { AssignForm, CopyField, SyncButton } from "./forms";

export const metadata: Metadata = { title: "Google Ads" };

const TZ = "America/New_York";
const formatCustomerId = (id: string) => id.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");

type Assigned = {
  id: string;
  workspace_id: string;
  external_id: string;
  name: string | null;
  webhook_key: string;
  last_sync_at: string | null;
  last_sync_status: "ok" | "error" | null;
  last_sync_error: string | null;
  last_sync_summary: SyncSummary | null;
};

export default async function GoogleAdsAdminPage({ searchParams }: PageProps<"/admin/google">) {
  const profile = await getProfile();
  if (!profile?.is_platform_admin) redirect("/dashboard");
  const sp = await searchParams;
  const flashError = typeof sp.error === "string" ? sp.error : null;
  const flashConnected = typeof sp.connected === "string" ? sp.connected : null;

  const config = googleConfig();
  const admin = createAdminClient();
  const [connection, { data: assignedRows }, { data: businesses }] = await Promise.all([
    getConnection(),
    admin.from("ad_accounts").select("id, workspace_id, external_id, name, webhook_key, last_sync_at, last_sync_status, last_sync_error, last_sync_summary").eq("platform", "google"),
    admin.from("workspaces").select("id, name").order("name"),
  ]);
  const assigned = new Map(((assignedRows ?? []) as Assigned[]).map((a) => [a.external_id, a]));
  const businessName = new Map((businesses ?? []).map((b) => [b.id, b.name]));

  let accounts: ClientAccount[] = [];
  let accountsError: string | null = null;
  if (connection) {
    try {
      accounts = await listClientAccounts();
    } catch (e) {
      accountsError = e instanceof GoogleAdsError ? e.message : "Could not load the ad accounts.";
    }
  }
  // Assigned accounts Google no longer lists under the manager account (unlinked) still show, flagged.
  const listed = new Set(accounts.map((a) => a.id));
  const orphans = [...assigned.values()].filter((a) => !listed.has(a.external_id));
  const base = publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

  return (
    <>
      <PageHeader
        title="Google Ads"
        description={`Lead96 manager account ${config.managerId ? formatCustomerId(config.managerId) : "(not set)"}. Leads and spend from each ad account go to the business you assign it to.`}
        back={{ href: "/admin", label: "Admin" }}
      />

      <div className="space-y-10">
        {flashError ? <Alert tone="error">{flashError}</Alert> : null}
        {flashConnected ? <Alert tone="success">Google Ads connected{flashConnected !== "1" ? ` as ${flashConnected}` : ""}.</Alert> : null}

        <Section title="Connection" description="One Google sign-in with access to the manager account. Stored encrypted; only the server can use it.">
          <Card className="space-y-4 p-6">
            {config.missing.length ? (
              <Alert tone="error">Missing server settings: {config.missing.join(", ")}.</Alert>
            ) : connection ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone={connection.last_error ? "red" : "green"}>{connection.last_error ? "Needs attention" : "Connected"}</Badge>
                  <p className="text-sm text-slate-700">
                    Signed in as <span className="font-medium text-slate-900">{connection.account_email ?? "unknown"}</span> · connected {timeAgo(connection.connected_at, TZ)}
                    {connection.last_ok_at ? ` · last successful request ${timeAgo(connection.last_ok_at, TZ)}` : ""}
                  </p>
                </div>
                {connection.last_error ? (
                  <Alert tone="error">
                    {connection.last_error} ({connection.last_error_at ? formatDateTime(connection.last_error_at, TZ) : ""} ET)
                  </Alert>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {/* A plain link: this starts a redirect to Google, not a page navigation. */}
                  <a href="/api/google/connect" className={buttonClass("secondary", "", "sm")}>
                    Reconnect
                  </a>
                  <form action={disconnectGoogle}>
                    <button type="submit" className={buttonClass("ghost", "text-red-600", "sm")}>
                      Disconnect
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Sign in once with the Google user that manages the manager account. Lead96 then reads leads and spend for the ad accounts linked to it.
                </p>
                <a href="/api/google/connect" className={buttonClass("primary")}>
                  Connect Google Ads
                </a>
              </div>
            )}
            <p className="text-xs text-slate-500">
              Redirect URI registered in the Google Cloud OAuth client must include: <code className="font-mono">{config.redirectUri}</code>
            </p>
          </Card>
        </Section>

        {connection ? (
          <Section title="Ad accounts" description="Ad accounts linked to the manager account. Assign each one to the business it advertises for.">
            {accountsError ? <Alert tone="error">{accountsError}</Alert> : null}
            {!accountsError && accounts.length === 0 && orphans.length === 0 ? (
              <Card className="p-6 text-sm text-slate-600">
                No ad accounts are linked to the manager account yet. In Google Ads, the business accepts Lead96&apos;s manager-account link request (or Lead96
                creates the account under the manager account).
              </Card>
            ) : null}
            <div className="space-y-4">
              {[...accounts.map((a) => ({ ...a, missing: false })), ...orphans.map((o) => ({ id: o.external_id, name: o.name ?? `Account ${o.external_id}`, currency: null, timeZone: null, test: false, status: null, missing: true }))].map(
                (a) => {
                  const row = assigned.get(a.id);
                  const s = row?.last_sync_summary;
                  return (
                    <Card key={a.id} className="space-y-4 p-6" data-account={a.id}>
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900">{a.name}</p>
                          <p className="text-sm text-slate-500">
                            {formatCustomerId(a.id)}
                            {a.currency ? ` · ${a.currency}` : ""}
                            {a.timeZone ? ` · ${a.timeZone}` : ""}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {a.test ? <Badge>Test account</Badge> : null}
                            {a.missing ? <Badge tone="red">No longer linked to the manager account</Badge> : null}
                            {row ? <Badge tone="blue">{businessName.get(row.workspace_id) ?? "Business"}</Badge> : <Badge>Not assigned</Badge>}
                          </div>
                        </div>
                        <AssignForm account={a} businesses={businesses ?? []} current={row?.workspace_id ?? null} />
                      </div>

                      {row ? (
                        <div className="grid gap-4 border-t border-slate-100 pt-4 lg:grid-cols-2">
                          <div className="space-y-2">
                            <p className="text-sm font-medium text-slate-900">Sync</p>
                            <p className="text-xs text-slate-500">
                              {row.last_sync_at ? (
                                <>
                                  Last sync {timeAgo(row.last_sync_at, TZ)} -{" "}
                                  {row.last_sync_status === "ok" && s
                                    ? `${s.leadsFound} leads found, ${s.leadsNew} new; ${s.spendRows} spend rows (${s.spendTotal.toLocaleString("en-US")})`
                                    : (row.last_sync_error ?? "failed")}
                                </>
                              ) : (
                                "Not synced yet. Runs daily; sync now to pull the last 30 days."
                              )}
                            </p>
                            <SyncButton accountId={row.id} />
                          </div>
                          <details className="space-y-2">
                            <summary className="cursor-pointer text-sm font-medium text-slate-900">Lead form webhook (real-time leads)</summary>
                            <p className="mt-2 text-xs text-slate-500">
                              In Google Ads, open the lead form, then Lead delivery, then Webhook integration. Paste this URL and key, then click &quot;Send test data&quot;. The test
                              shows up below in Admin as a test delivery.
                            </p>
                            <div className="mt-2 space-y-2">
                              <CopyField label="Webhook URL" value={`${base}/api/intake/google-lead/${row.id}`} />
                              <CopyField label="Key" value={row.webhook_key} />
                            </div>
                          </details>
                        </div>
                      ) : null}
                    </Card>
                  );
                },
              )}
            </div>
          </Section>
        ) : null}
      </div>
    </>
  );
}

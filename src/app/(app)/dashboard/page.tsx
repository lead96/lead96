import Link from "next/link";
import type { Metadata } from "next";
import { Card, PageHeader, buttonClass } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";

export const metadata: Metadata = { title: "Dashboard" };

const kpis = ["Leads", "Qualified", "Booked", "Won", "Revenue", "Cost per booked appt."];

export default async function DashboardPage() {
  const workspace = await requireWorkspace();
  const needsSetup = !workspace.setupCompletedAt;

  return (
    <>
      <PageHeader title="Dashboard" description="Leads, bookings, jobs and revenue by source." />

      {needsSetup && workspace.role === "owner" ? (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 border-brand-200 bg-brand-50 p-5">
          <div>
            <p className="font-medium text-brand-900">Finish setting up your business</p>
            <p className="text-sm text-brand-900/80">
              Tell us your services, area and hours so the AI can call and book your leads.
            </p>
          </div>
          <Link href="/setup" className={buttonClass()}>
            Continue setup
          </Link>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        {kpis.map((label) => (
          <Card key={label} className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-300">—</p>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-sm text-slate-500">Numbers appear here once leads start coming in.</p>
    </>
  );
}

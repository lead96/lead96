import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, Section } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { calendarContext } from "@/lib/calendar/service";
import { friendlyHours, openWindows } from "@/lib/calendar/slots";
import { formatPhone } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { removeBlackout } from "./actions";
import { AppointmentActions, BlackoutForm, type WindowOption } from "./forms";

export const metadata: Metadata = { title: "Calendar" };

type Appt = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  service: string | null;
  address: string | null;
  notes: string | null;
  customer_id: string | null;
  customers: { full_name: string | null; phone: string | null } | null;
};

const STATUS: Record<string, { label: string; tone: "blue" | "green" | "slate" | "amber" | "red" }> = {
  scheduled: { label: "Booked", tone: "blue" },
  confirmed: { label: "Confirmed", tone: "green" },
  completed: { label: "Done", tone: "slate" },
  no_show: { label: "No-show", tone: "amber" },
  cancelled: { label: "Cancelled", tone: "red" },
};
const SOURCE: Record<string, string> = { ai_call: "Booked by AI call", ai_text: "Booked by AI text", manual: "Booked by your team" };

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const workspace = await requireWorkspace();
  const past = (await searchParams).view === "past";
  const isOwner = workspace.role === "owner";
  const supabase = await createClient();
  const tz = workspace.timezone;

  const now = new Date();
  const from = past ? new Date(now.getTime() - 30 * 86_400_000) : new Date(now.getTime() - 12 * 3_600_000);
  const to = past ? now : new Date(now.getTime() + 30 * 86_400_000);
  const [{ data }, ctx, { data: blackouts }] = await Promise.all([
    supabase
      .from("appointments")
      .select("id, starts_at, ends_at, status, source, service, address, notes, customer_id, customers (full_name, phone)")
      .eq("workspace_id", workspace.id)
      .gte("starts_at", from.toISOString())
      .lte("starts_at", to.toISOString())
      .order("starts_at", { ascending: !past }),
    calendarContext(supabase, workspace.id),
    supabase.from("calendar_blackouts").select("id, starts_on, ends_on, reason").eq("workspace_id", workspace.id).gte("ends_on", now.toISOString().slice(0, 10)).order("starts_on"),
  ]);
  const appts = (data ?? []) as unknown as Appt[];
  const free = openWindows({ ...ctx, now, days: 10 });
  const options: WindowOption[] = free.map((w) => ({ value: `${w.date}|${w.start}|${w.end}`, label: `${w.label} (${w.left} left)` }));

  const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" }).format(new Date(iso));
  const time = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(":00", "").replace(" ", "").toLowerCase();
  const groups = new Map<string, Appt[]>();
  for (const a of appts) groups.set(dayKey(a.starts_at), [...(groups.get(dayKey(a.starts_at)) ?? []), a]);

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`Visits booked by the AI and your team. Times in ${tz.replace("_", " ")}.`}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs text-slate-500">Visit hours</p>
          <p className="mt-1 text-sm font-medium text-slate-900">{friendlyHours(ctx.hours)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-slate-500">Capacity</p>
          <p className="mt-1 text-sm font-medium text-slate-900">{ctx.capacityPerDay ? `${ctx.capacityPerDay} visits a day` : "1 visit per window (not set)"}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-slate-500">Open windows, next days</p>
          <p className="mt-1 text-sm font-medium text-slate-900">{free.length ? `${free.length} windows, from ${free[0].label}` : "None open"}</p>
        </Card>
      </div>
      <p className="-mt-3 mb-6 text-xs text-slate-500">
        Change hours and visits per day in the{" "}
        <Link href="/profile" className="text-brand-700 hover:underline">
          Business profile
        </Link>
        .
      </p>

      <div className="mb-4 flex gap-2">
        {[
          { href: "/calendar", label: "Upcoming", active: !past },
          { href: "/calendar?view=past", label: "Past 30 days", active: past },
        ].map((t) => (
          <Link key={t.href} href={t.href} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${t.active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {appts.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title={past ? "No visits in the last 30 days" : "No visits booked yet"}
            description={past ? undefined : "When the AI or your team books a visit, it shows up here."}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([key, list]) => (
            <section key={key}>
              <h2 className="mb-2 text-sm font-semibold text-slate-900">{dayLabel(list[0].starts_at)}</h2>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-slate-100">
                  {list.map((a) => {
                    const who = a.customers?.full_name || formatPhone(a.customers?.phone ?? null) || "Customer";
                    return (
                      <li key={a.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[160px_minmax(0,1fr)_auto]" data-appointment={a.id}>
                        <div>
                          <p className="font-semibold tabular-nums text-slate-900">
                            {time(a.starts_at)} - {time(a.ends_at)}
                          </p>
                          <Badge tone={STATUS[a.status]?.tone ?? "slate"}>{STATUS[a.status]?.label ?? a.status}</Badge>
                        </div>
                        <div className="min-w-0 text-sm">
                          {a.customer_id ? (
                            <Link href={`/leads/${a.customer_id}`} className="font-medium text-slate-900 hover:text-brand-700">
                              {who}
                            </Link>
                          ) : (
                            <span className="font-medium text-slate-900">{who}</span>
                          )}
                          <p className="text-slate-600">{[a.service, a.address].filter(Boolean).join(" · ") || "No address yet"}</p>
                          {a.notes ? <p className="text-xs text-slate-500">{a.notes}</p> : null}
                          <p className="text-xs text-slate-400">{SOURCE[a.source] ?? a.source}</p>
                        </div>
                        <AppointmentActions id={a.id} status={a.status} windows={options} />
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}

      <div className="mt-10">
        <Section title="Blocked days" description="No visits are offered on these days (holidays, vacation). Visits already booked stay.">
          <Card className="space-y-4 p-6">
            {(blackouts ?? []).length ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {(blackouts ?? []).map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      {b.starts_on === b.ends_on ? b.starts_on : `${b.starts_on} to ${b.ends_on}`}
                      {b.reason ? <span className="text-slate-500"> · {b.reason}</span> : null}
                    </span>
                    {isOwner ? (
                      <form action={removeBlackout}>
                        <input type="hidden" name="id" value={b.id} />
                        <button className="text-xs text-slate-500 hover:underline">Remove</button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No blocked days.</p>
            )}
            {isOwner ? <BlackoutForm /> : <p className="text-xs text-slate-500">Only owners can block days.</p>}
          </Card>
        </Section>
      </div>
    </>
  );
}

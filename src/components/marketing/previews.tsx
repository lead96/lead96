/**
 * Static product previews for the public home page. Plain markup that mirrors the real app's look
 * (white cards, gray labels, blue/green badges); the names and numbers are sample data.
 */
import {
  CalendarCheck,
  CheckCircle2,
  Inbox,
  LayoutDashboard,
  PhoneCall,
  Users,
} from "lucide-react";
import { Badge, cx, type Tone } from "@/components/ui";

const LEADS: {
  name: string;
  job: string;
  source: string;
  status: string;
  tone: Tone;
  live?: boolean;
  time: string;
}[] = [
  {
    name: "Maria Lopez",
    job: "AC not cooling · 75201",
    source: "Google",
    status: "AI calling...",
    tone: "blue",
    live: true,
    time: "now",
  },
  {
    name: "James Carter",
    job: "Furnace tune-up · 75204",
    source: "Meta",
    status: "Booked · Tue 10:00",
    tone: "green",
    time: "4 min",
  },
  {
    name: "Aisha Khan",
    job: "New AC quote · 75219",
    source: "Landing page",
    status: "Qualified",
    tone: "blue",
    time: "12 min",
  },
  {
    name: "Tom Becker",
    job: "Water heater · 75206",
    source: "Call",
    status: "Booked · Wed 14:00",
    tone: "green",
    time: "38 min",
  },
];

const STATS = [
  { label: "New leads", value: "48", note: "this week" },
  { label: "Called < 1 min", value: "96%", note: "of new leads" },
  { label: "Booked jobs", value: "21", note: "this week" },
  { label: "Cost / booking", value: "$38", note: "all campaigns" },
];

/** Browser-framed dashboard used in the hero. */
export function DashboardPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="ml-3 hidden rounded-md bg-white px-3 py-1 text-[11px] text-slate-400 ring-1 ring-slate-200 sm:block">
          app.lead96.com/dashboard
        </span>
      </div>
      <div className="flex">
        <aside className="hidden w-44 shrink-0 border-r border-slate-100 p-3 md:block">
          {[
            { icon: LayoutDashboard, label: "Dashboard", active: true },
            { icon: Inbox, label: "Leads" },
            { icon: PhoneCall, label: "Calls" },
            { icon: CalendarCheck, label: "Calendar" },
            { icon: Users, label: "Customers" },
          ].map(({ icon: I, label, active }) => (
            <div
              key={label}
              className={cx(
                "mb-0.5 flex items-center gap-2 rounded-md px-2.5 py-2 text-xs",
                active
                  ? "bg-brand-50 font-medium text-brand-700"
                  : "text-slate-500",
              )}
            >
              <I size={14} strokeWidth={1.75} />
              {label}
            </div>
          ))}
        </aside>
        <div className="min-w-0 flex-1 bg-page/60 p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {STATS.map((s) => (
              <div
                key={s.label}
                className="rounded-xl bg-white p-3 shadow-card ring-1 ring-slate-200/70 sm:p-4"
              >
                <p className="text-[11px] text-slate-500">{s.label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-slate-900 sm:text-2xl">
                  {s.value}
                </p>
                <p className="text-[10px] text-slate-400">{s.note}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl bg-white shadow-card ring-1 ring-slate-200/70">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <p className="text-xs font-semibold text-slate-900">
                Recent leads
              </p>
              <p className="text-[11px] text-slate-400">All sources</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {LEADS.map((l) => (
                <li
                  key={l.name}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
                    {l.name
                      .split(" ")
                      .map((p) => p[0])
                      .join("")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-slate-900">
                      {l.name}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {l.job}
                    </span>
                  </span>
                  <span className="hidden text-[11px] text-slate-500 sm:block">
                    {l.source}
                  </span>
                  <Badge tone={l.tone}>
                    {l.live ? (
                      <span className="mr-1 h-1.5 w-1.5 rounded-full bg-brand-600" />
                    ) : null}
                    {l.status}
                  </Badge>
                  <span className="hidden w-10 text-right text-[11px] text-slate-400 lg:block">
                    {l.time}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small floating "call summary" card that overlaps the dashboard on wide screens. */
export function CallSummaryChip() {
  return (
    <div className="w-72 rounded-xl bg-white p-4 shadow-menu ring-1 ring-slate-200/70">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 size={16} strokeWidth={2} />
        </span>
        <p className="text-xs font-semibold text-slate-900">
          Appointment booked
        </p>
        <span className="ml-auto text-[11px] text-slate-400">1:42 call</span>
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-slate-600">
        AC not cooling since last night. Owner, single-family home in 75201.
        Booked Tue 10:00-12:00.
      </p>
    </div>
  );
}

/** AI call transcript + extracted answers, for the "speed" spotlight. */
export function CallPreview() {
  const lines: { who: "ai" | "lead"; text: string }[] = [
    {
      who: "ai",
      text: "Hi Maria, this is Cool Air HVAC - you asked about your AC a minute ago. Is now a good time?",
    },
    { who: "lead", text: "Yes! It stopped cooling last night." },
    {
      who: "ai",
      text: "Sorry to hear that. Is it a central system at your home in 75201?",
    },
    { who: "lead", text: "Yes, central air. I own the house." },
    { who: "ai", text: "We have Tuesday 10 to 12 open. Shall I book it?" },
  ];
  return (
    <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200/70 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <PhoneCall size={16} strokeWidth={1.75} />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900">
            Call with Maria Lopez
          </p>
          <p className="text-xs text-slate-500">
            Started 38 seconds after the form was sent
          </p>
        </div>
      </div>
      <div className="mt-5 space-y-2.5">
        {lines.map((l, i) => (
          <div
            key={i}
            className={cx("flex", l.who === "lead" && "justify-end")}
          >
            <p
              className={cx(
                "max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed",
                l.who === "ai"
                  ? "rounded-tl-sm bg-slate-100 text-slate-700"
                  : "rounded-tr-sm bg-brand-600 text-white",
              )}
            >
              {l.text}
            </p>
          </div>
        ))}
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-4 text-xs">
        {[
          ["Service", "AC repair"],
          ["Urgency", "Today / tomorrow"],
          ["Area", "75201 · in service area"],
          ["Outcome", "Booked Tue 10:00"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-slate-400">{k}</dt>
            <dd
              className={cx(
                "mt-0.5 font-medium",
                k === "Outcome" ? "text-emerald-700" : "text-slate-900",
              )}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Campaign -> revenue table, for the "attribution" spotlight. */
export function RevenuePreview() {
  const rows = [
    {
      name: "Google · AC repair Dallas",
      leads: 64,
      booked: 27,
      revenue: 18400,
      share: 100,
    },
    {
      name: "Meta · Spring tune-up offer",
      leads: 41,
      booked: 12,
      revenue: 6900,
      share: 38,
    },
    {
      name: "Landing page · New AC quote",
      leads: 18,
      booked: 7,
      revenue: 11200,
      share: 61,
    },
  ];
  return (
    <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200/70 sm:p-6">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-slate-900">
          Revenue by campaign
        </p>
        <p className="text-xs text-slate-400">Last 30 days</p>
      </div>
      <ul className="mt-5 space-y-5">
        {rows.map((r) => (
          <li key={r.name}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate font-medium text-slate-900">
                {r.name}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                ${r.revenue.toLocaleString("en-US")}
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-brand-600"
                style={{ width: `${r.share}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              {r.leads} leads · {r.booked} booked ·{" "}
              <span className="text-emerald-700">
                {Math.round((r.booked / r.leads) * 100)}% booking rate
              </span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

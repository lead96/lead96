"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Alert, Button, Card, Select, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import {
  IMPORT_CHUNK,
  IMPORT_TARGETS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  guessMapping,
  mapRows,
  parseCsv,
  rowProblem,
  type ColumnMapping,
  type ImportRow,
} from "@/lib/leads/csv";
import { importLeads } from "../actions";

type Parsed = { fileName: string; headers: string[]; rows: string[][] };
type Totals = { created: number; updated: number; duplicates: number; failed: { row: number; error: string }[] };

export function Importer({ timezone }: { timezone: string }) {
  const [file, setFile] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);

  const onFile = async (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (f.size > MAX_IMPORT_BYTES) return setError("The file is larger than 5 MB. Split it into smaller files.");
    const rows = parseCsv(await f.text());
    if (rows.length < 2) return setError("The file has no data rows. The first row must be the column names.");
    if (rows.length - 1 > MAX_IMPORT_ROWS) return setError(`The file has ${rows.length - 1} rows. Import up to ${MAX_IMPORT_ROWS} at a time.`);
    const headers = rows[0].map((h, i) => h || `Column ${i + 1}`);
    setFile({ fileName: f.name, headers, rows: rows.slice(1) });
    setMapping(guessMapping(headers));
  };

  const mapped = useMemo(() => (file ? mapRows(file.headers, file.rows, mapping, timezone) : []), [file, mapping, timezone]);
  const checked = useMemo(() => mapped.map((r) => ({ row: r, problem: rowProblem(r) })), [mapped]);
  const ready = checked.filter((c) => !c.problem).map((c) => c.row);
  const skipped = checked.filter((c) => c.problem).map((c) => ({ row: c.row.row, error: c.problem! }));
  const hasContact = mapping.includes("phone") || mapping.includes("email");

  const reset = () => (setFile(null), setMapping([]), setTotals(null), setProgress(null), setError(null));

  const run = async () => {
    if (!file || !ready.length) return;
    setError(null);
    const sum: Totals = { created: 0, updated: 0, duplicates: 0, failed: [...skipped] };
    setProgress({ done: 0, total: ready.length });
    for (let i = 0; i < ready.length; i += IMPORT_CHUNK) {
      const chunk = ready.slice(i, i + IMPORT_CHUNK);
      let result;
      try {
        result = await importLeads({ fileName: file.fileName, rows: chunk });
      } catch {
        result = { ok: false as const, error: "Connection lost." };
      }
      if (!result.ok) {
        setProgress(null);
        setTotals(sum);
        setError(`${result.error} Stopped after ${i} of ${ready.length} rows - import the same file again to finish; rows already imported are recognized and skipped.`);
        return;
      }
      sum.created += result.created;
      sum.updated += result.updated;
      sum.duplicates += result.duplicates;
      sum.failed.push(...result.failed);
      setProgress({ done: Math.min(i + IMPORT_CHUNK, ready.length), total: ready.length });
    }
    sum.failed.sort((a, b) => a.row - b.row);
    setTotals(sum);
    setProgress(null);
  };

  if (totals) return <Summary totals={totals} error={error} onAgain={reset} />;

  if (!file) {
    return (
      <Card className="max-w-xl space-y-4 p-6">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="space-y-1.5">
          <label htmlFor="csv" className="block text-sm font-medium text-slate-700">
            CSV file
          </label>
          <input id="csv" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="block text-sm" />
          <p className="text-xs text-slate-500">
            Save your spreadsheet as CSV. The first row must be the column names. Up to {MAX_IMPORT_ROWS.toLocaleString()} rows; each needs a phone
            number or email.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <Card className="overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold text-slate-900">
            Match your columns <span className="font-normal text-slate-500">· {file.fileName}</span>
          </h2>
          <button type="button" onClick={reset} className="text-sm text-slate-600 hover:underline" disabled={Boolean(progress)}>
            Choose another file
          </button>
        </div>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2 font-medium">Column in your file</th>
              <th className="px-5 py-2 font-medium">Example</th>
              <th className="px-5 py-2 font-medium">Import as</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {file.headers.map((h, col) => (
              <tr key={col}>
                <td className="px-5 py-2 font-medium text-slate-900">{h}</td>
                <td className="max-w-[260px] truncate px-5 py-2 text-slate-600">{file.rows.find((r) => r[col])?.[col] ?? "-"}</td>
                <td className="px-5 py-2">
                  <Select
                    aria-label={`Import ${h} as`}
                    value={mapping[col]}
                    disabled={Boolean(progress)}
                    onChange={(e) => setMapping((m) => m.map((v, i) => (i === col ? (e.target.value as ColumnMapping) : v)))}
                    className="w-52"
                  >
                    {IMPORT_TARGETS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                    <option value="extra">Keep as extra info</option>
                    <option value="skip">Don&apos;t import</option>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="space-y-4 p-5">
        {!hasContact ? <Alert tone="error">Choose which column is the phone number or email - every lead needs one.</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <p className="text-sm text-slate-700">
          <strong>{ready.length.toLocaleString()}</strong> of {mapped.length.toLocaleString()} rows are ready to import.
          {skipped.length ? ` ${skipped.length.toLocaleString()} will be skipped (no valid phone or email) - you'll see which ones after the import.` : ""}
        </p>
        {ready.length ? <Preview rows={ready.slice(0, 5)} timezone={timezone} /> : null}
        {progress ? (
          <div className="space-y-1.5" role="status">
            <div className="h-2 overflow-hidden rounded bg-slate-100">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <p className="text-xs text-slate-500">
              Importing... {progress.done.toLocaleString()} of {progress.total.toLocaleString()}
            </p>
          </div>
        ) : (
          <Button type="button" onClick={run} disabled={!ready.length}>
            Import {ready.length.toLocaleString()} {ready.length === 1 ? "lead" : "leads"}
          </Button>
        )}
      </Card>
    </div>
  );
}

function Preview({ rows, timezone }: { rows: ImportRow[]; timezone: string }) {
  return (
    <div className="overflow-x-auto rounded border border-slate-200">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            {["Row", "Name", "Phone", "Email", "ZIP", "Service", "Date received", "Campaign"].map((h) => (
              <th key={h} className="px-3 py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-800">
          {rows.map((r) => (
            <tr key={r.row}>
              <td className="px-3 py-1.5 text-slate-500">{r.row}</td>
              <td className="px-3 py-1.5">{r.full_name ?? "-"}</td>
              <td className="px-3 py-1.5">{r.phone ?? "-"}</td>
              <td className="px-3 py-1.5">{r.email ?? "-"}</td>
              <td className="px-3 py-1.5">{r.zip ?? "-"}</td>
              <td className="px-3 py-1.5">{r.service ?? "-"}</td>
              <td className="px-3 py-1.5">{r.received_at ? formatDateTime(r.received_at, timezone) : "Today"}</td>
              <td className="px-3 py-1.5">{r.campaign_name ?? r.utm_campaign ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Summary({ totals, error, onAgain }: { totals: Totals; error: string | null; onAgain: () => void }) {
  const stats = [
    { label: "New customers", value: totals.created },
    { label: "Added to existing customers", value: totals.updated },
    { label: "Already imported before", value: totals.duplicates },
    { label: "Not imported", value: totals.failed.length },
  ];
  return (
    <Card className="max-w-2xl space-y-5 p-6">
      {error ? <Alert tone="error">{error}</Alert> : <Alert tone="success">Import finished.</Alert>}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-xs text-slate-500">{s.label}</dt>
            <dd className="text-2xl font-semibold text-slate-900">{s.value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      {totals.failed.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-700">Rows not imported ({totals.failed.length})</summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded bg-slate-50 px-3 py-2 text-xs text-slate-700">
            {totals.failed.map((f) => (
              <li key={f.row}>
                Row {f.row}: {f.error}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Link href="/leads?source=csv" className={buttonClass()}>
          View imported leads
        </Link>
        <Button type="button" variant="secondary" onClick={onAgain}>
          Import another file
        </Button>
      </div>
    </Card>
  );
}

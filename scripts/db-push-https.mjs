#!/usr/bin/env node
/**
 * Apply pending migrations through the Supabase Management API (HTTPS).
 * Use when Postgres ports are blocked (e.g. by a VPN) and `supabase db push` can't connect.
 *
 * Each migration runs in one transaction together with its row in
 * supabase_migrations.schema_migrations, exactly as `supabase db push` records it,
 * so both tools can be used interchangeably.
 *
 *   npm run db:push:https            # apply
 *   npm run db:push:https -- --dry-run
 *
 * Needs SUPABASE_ACCESS_TOKEN (personal access token, from the account that owns the project)
 * in .env.local. The target is the project in NEXT_PUBLIC_SUPABASE_URL.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

const dryRun = process.argv.includes("--dry-run");
const token = process.env.SUPABASE_ACCESS_TOKEN;
// Target = the project the app itself uses (NEXT_PUBLIC_SUPABASE_URL), so migrations can never
// land in a different database than the one the app and tests talk to.
const refFile = "supabase/.temp/project-ref";
const urlRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? "";
const linkedRef = fs.existsSync(refFile) ? fs.readFileSync(refFile, "utf8").trim() : "";
const ref = process.env.SUPABASE_PROJECT_REF || urlRef;
if (!token || !ref) {
  console.error("Set SUPABASE_ACCESS_TOKEN and NEXT_PUBLIC_SUPABASE_URL in .env.local (or SUPABASE_PROJECT_REF).");
  process.exit(1);
}
if (urlRef && ref !== urlRef) {
  console.error(`SUPABASE_PROJECT_REF (${ref}) is not the project in NEXT_PUBLIC_SUPABASE_URL (${urlRef}). Refusing to push.`);
  process.exit(1);
}
if (linkedRef && linkedRef !== ref) {
  console.warn(`Note: the Supabase CLI is linked to ${linkedRef}, but the app uses ${ref}. Pushing to ${ref}.`);
  console.warn(`      Run \`npx supabase link --project-ref ${ref}\` so \`npm run db:push\` targets the same project.`);
}

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${body}`);
  return JSON.parse(body);
}

/** Dollar-quote with a random tag so file contents can never break out of the literal. */
function literal(text) {
  const tag = `m${randomBytes(6).toString("hex")}`;
  return `$${tag}$${text}$${tag}$`;
}

// process.exit() right after fetch() can crash Node on Windows (libuv assertion), so let main() end naturally.
async function main() {
  const dir = "supabase/migrations";
  const local = fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ file: f, version: f.split("_")[0], name: f.replace(/^\d+_/, "").replace(/\.sql$/, "") }));

  // A brand-new project has no history table yet (the CLI creates it on first push); same shape as the CLI's.
  if (!dryRun) {
    await query(`create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
  }
  const exists = (await query("select to_regclass('supabase_migrations.schema_migrations') is not null as ok"))[0]?.ok;
  const applied = new Set(
    exists ? (await query("select version from supabase_migrations.schema_migrations")).map((r) => r.version) : [],
  );
  const remoteOnly = [...applied].filter((v) => !local.some((m) => m.version === v));
  if (remoteOnly.length) {
    console.error(`Remote has migrations not in ${dir}: ${remoteOnly.join(", ")}. Resolve before pushing.`);
    process.exitCode = 1;
    return;
  }

  const pending = local.filter((m) => !applied.has(m.version));
  console.log(`Project ${ref}: ${applied.size} applied, ${pending.length} pending.`);
  for (const m of pending) console.log(` • ${m.file}`);
  if (dryRun || pending.length === 0) return;

  for (const m of pending) {
    const sql = fs.readFileSync(path.join(dir, m.file), "utf8");
    process.stdout.write(`Applying ${m.file}... `);
    await query(`begin;
  ${sql}
  ;
  insert into supabase_migrations.schema_migrations (version, name, statements)
  values (${literal(m.version)}, ${literal(m.name)}, array[${literal(sql)}]);
  commit;`);
    console.log("done");
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

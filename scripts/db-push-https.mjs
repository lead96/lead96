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
 * Needs SUPABASE_ACCESS_TOKEN (personal access token) in .env.local. The project ref
 * comes from SUPABASE_PROJECT_REF or the linked project (supabase/.temp/project-ref).
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

const dryRun = process.argv.includes("--dry-run");
const token = process.env.SUPABASE_ACCESS_TOKEN;
const refFile = "supabase/.temp/project-ref";
const ref = process.env.SUPABASE_PROJECT_REF || (fs.existsSync(refFile) ? fs.readFileSync(refFile, "utf8").trim() : "");
if (!token || !ref) {
  console.error("Set SUPABASE_ACCESS_TOKEN in .env.local and link the project (or set SUPABASE_PROJECT_REF).");
  process.exit(1);
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

  const applied = new Set((await query("select version from supabase_migrations.schema_migrations")).map((r) => r.version));
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

#!/usr/bin/env node
/**
 * Data export (a safety copy while the project has no automatic backups).
 *
 * Writes every table in the public schema as JSON, the sign-in accounts (id, email, dates, metadata;
 * never passwords - Supabase can't export them, users would reset theirs) and a list of stored
 * files, into backups/<timestamp>/ (git-ignored). With --files it also downloads the stored files
 * (landing page images, call recordings).
 *
 *   npm run db:export
 *   npm run db:export -- --files
 *
 * Needs SUPABASE_ACCESS_TOKEN (Management API, reads without row-level security) and, for --files,
 * SUPABASE_SERVICE_ROLE_KEY, from .env.local. The export holds customer data and encrypted secrets:
 * keep it somewhere only owners can read, never in git or a shared drive.
 */
import fs from "node:fs";
import path from "node:path";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ref = process.env.SUPABASE_PROJECT_REF || url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const withFiles = process.argv.includes("--files");
// Re-created from supabase/seed by `npm run db:seed:zips`; no need to copy 41k rows.
const SKIP = new Set(["us_zip_codes"]);
const CHUNK = 5000;

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

const ident = (name) => `"${name.replace(/"/g, '""')}"`;

async function exportRows(dir, file, from, orderBy) {
  const rows = [];
  for (let offset = 0; ; offset += CHUNK) {
    const [r] = await query(`select coalesce(json_agg(t), '[]'::json) as rows from (select * from ${from} order by ${orderBy} offset ${offset} limit ${CHUNK}) t`);
    rows.push(...r.rows);
    if (r.rows.length < CHUNK) break;
  }
  fs.writeFileSync(path.join(dir, file), JSON.stringify(rows));
  return rows.length;
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join("backups", stamp);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { project: ref, exported_at: new Date().toISOString(), tables: {}, skipped: [...SKIP], files: 0 };

  const tables = await query(`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`);
  for (const { name } of tables) {
    if (SKIP.has(name)) continue;
    // Order by the first column (the id) so chunks are stable.
    const [{ col }] = await query(`select a.attname as col from pg_attribute a where a.attrelid = 'public.${ident(name)}'::regclass and a.attnum = 1`);
    manifest.tables[name] = await exportRows(dir, `${name}.json`, `public.${ident(name)}`, ident(col));
    console.log(`${name}: ${manifest.tables[name]}`);
  }

  manifest.tables["auth.users"] = await exportRows(
    dir,
    "auth_users.json",
    "(select id, email, created_at, last_sign_in_at, email_confirmed_at, raw_user_meta_data from auth.users) u",
    "created_at",
  );
  manifest.migrations = (await query("select version from supabase_migrations.schema_migrations order by version")).map((m) => m.version);

  const objects = await query("select bucket_id, name, (metadata ->> 'size')::bigint as size, created_at from storage.objects order by bucket_id, name");
  fs.writeFileSync(path.join(dir, "storage_objects.json"), JSON.stringify(objects));
  manifest.storage_objects = objects.length;

  if (withFiles && objects.length) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error("--files needs SUPABASE_SERVICE_ROLE_KEY");
    for (const o of objects) {
      const res = await fetch(`${url}/storage/v1/object/${o.bucket_id}/${o.name.split("/").map(encodeURIComponent).join("/")}`, { headers: { Authorization: `Bearer ${key}`, apikey: key } });
      if (!res.ok) {
        console.warn(`skipped ${o.bucket_id}/${o.name}: ${res.status}`);
        continue;
      }
      const target = path.join(dir, "files", o.bucket_id, ...o.name.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      manifest.files += 1;
    }
  }

  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nExported to ${dir} (${Object.keys(manifest.tables).length} tables, ${manifest.storage_objects} stored files listed${withFiles ? `, ${manifest.files} downloaded` : ""}).`);
}

// process.exit() right after fetch() can crash Node on Windows (libuv assertion), so let main() end naturally.
if (!token || !ref) {
  console.error("Set SUPABASE_ACCESS_TOKEN and NEXT_PUBLIC_SUPABASE_URL in .env.local.");
  process.exitCode = 1;
} else {
  await main();
}

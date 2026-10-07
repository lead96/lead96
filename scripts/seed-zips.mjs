#!/usr/bin/env node
/**
 * Load supabase/seed/us_zip_codes.csv into public.us_zip_codes (upsert, 1000 rows per request).
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local. Safe to re-run.
 *
 *   npm run db:seed:zips
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

async function main() {
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const lines = fs.readFileSync("supabase/seed/us_zip_codes.csv", "utf8").trim().split(/\r?\n/).slice(1);
  const rows = lines.map((l) => {
    const [zip, city, state, county, lat, lng] = l.split(",");
    return { zip, city, state, county: county || null, lat: Number(lat), lng: Number(lng) };
  });
  console.log(`Seeding ${rows.length} ZIP codes…`);
  for (let i = 0; i < rows.length; i += 1000) {
    // Upserts are idempotent, so a batch that fails on a dropped connection can simply be retried.
    for (let attempt = 1; ; attempt++) {
      const { error } = await supabase.from("us_zip_codes").upsert(rows.slice(i, i + 1000), { onConflict: "zip" });
      if (!error) break;
      if (attempt === 4) throw new Error(`batch ${i}: ${error.message}`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
    process.stdout.write(`\r${Math.min(i + 1000, rows.length)}/${rows.length}`);
  }
  const { count } = await supabase.from("us_zip_codes").select("*", { count: "exact", head: true });
  console.log(`\nDone. Table has ${count} rows.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

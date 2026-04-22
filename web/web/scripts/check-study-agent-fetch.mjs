/**
 * Run from web/web: node --env-file=.env.local scripts/check-study-agent-fetch.mjs
 * Verifies PostgREST can read study_agent.assignments (no secrets printed).
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const schema = process.env.NEXT_PUBLIC_DB_SCHEMA ?? process.env.DB_SCHEMA ?? "study_agent";

if (!url || !key) {
  console.error("FAIL: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const supabase = createClient(url, key, { db: { schema } });

const { data, error } = await supabase.from("assignments").select("id").limit(1);

if (error) {
  console.error("FAIL:", error.code ?? "no-code", error.message);
  process.exit(1);
}

console.log("OK: study_agent.assignments readable, row count sample:", data?.length ?? 0);
process.exit(0);

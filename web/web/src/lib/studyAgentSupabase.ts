import { createClient } from "@supabase/supabase-js";

/** `public` is always exposed to PostgREST; custom schemas (e.g. study_agent) need Dashboard + GRANTs. */
const SCHEMA = process.env.NEXT_PUBLIC_DB_SCHEMA ?? process.env.DB_SCHEMA ?? "public";

/**
 * If PostgREST returns PGRST106 / "Invalid schema" / "schema must be one of the following",
 * add `study_agent` under Supabase **Project Settings → API → Exposed schemas**, save, then
 * reload the schema (Dashboard or SQL per docs). See:
 * https://supabase.com/docs/guides/api/using-custom-schemas
 */
export function getStudyAgentPostgrestHelpMessage(): string {
  if (SCHEMA === "public") {
    return [
      `PostgREST error on schema "public" (unusual). Check NEXT_PUBLIC_SUPABASE_URL / keys in web/web/.env.local.`,
      `If tables are missing, run public_bootstrap.sql in Supabase SQL Editor, then NOTIFY pgrst, 'reload schema';`,
    ].join("\n");
  }
  return [
    `PostgREST cannot use schema "${SCHEMA}" (PGRST106). Fastest fix (empty DB is fine): set NEXT_PUBLIC_DB_SCHEMA=public in web/web/.env.local, run the SQL file public_bootstrap.sql in Supabase, restart npm run dev.`,
    `To keep ${SCHEMA} instead: Project Settings → API → Exposed schemas add "${SCHEMA}", run GRANTs + NOTIFY from study_agent_schema.sql: https://supabase.com/docs/guides/api/using-custom-schemas`,
  ].join("\n");
}

export function mapStudyAgentQueryError(
  err: { message: string; code?: string; details?: string; hint?: string } | null,
): string {
  if (!err) {
    return "Unknown Supabase error";
  }
  const code = err.code ?? "";
  const message = (err.message || "").toLowerCase();
  if (
    code === "PGRST106" ||
    message.includes("invalid schema") ||
    message.includes("schema must be one of the following")
  ) {
    return getStudyAgentPostgrestHelpMessage();
  }
  if (
    code === "PGRST205" ||
    code === "PGRST204" ||
    message.includes("could not find the table")
  ) {
    return `Table not in PostgREST cache or does not exist. In Supabase SQL Editor run: deadline_agent/public_bootstrap.sql, then: NOTIFY pgrst, 'reload schema';  (${err.message})`;
  }
  return err.message;
}

export function getSupabaseForStudyAgent() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const schema = SCHEMA;

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable.");
  }

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    db: { schema },
  });
}

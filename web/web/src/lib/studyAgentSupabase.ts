import { createClient } from "@supabase/supabase-js";

export function getSupabaseForStudyAgent() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const schema = process.env.NEXT_PUBLIC_DB_SCHEMA ?? process.env.DB_SCHEMA ?? "study_agent";

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

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const DEFAULT_DUE_WINDOW_HOURS = 24;

function getSupabaseForStudyAgent() {
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

function isAuthorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  const provided =
    request.headers.get("CRON_SECRET") ??
    request.headers.get("cron_secret") ??
    request.headers.get("x-cron-secret");

  return Boolean(expected) && provided === expected;
}

async function sendWhatsAppReminderPlaceholder() {
  // Placeholder: integrate your WhatsApp API provider here.
  // Example next step:
  // - Build message payload from dueSoonAssignments
  // - Call Twilio/WhatsApp endpoint
  // - Handle retries + logging
  return { sent: false, reason: "WhatsApp integration not implemented yet." };
}

async function handleCronRequest(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseForStudyAgent();
  const now = new Date();
  const dueBy = new Date(now.getTime() + DEFAULT_DUE_WINDOW_HOURS * 60 * 60 * 1000);

  const { data: dueSoonAssignments, error } = await supabase
    .from("assignments")
    .select("id,title,due_date,status,course_id")
    .gte("due_date", now.toISOString())
    .lte("due_date", dueBy.toISOString())
    .neq("status", "completed")
    .order("due_date", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch due-soon assignments", details: error.message },
      { status: 500 },
    );
  }

  const whatsappResult = await sendWhatsAppReminderPlaceholder();

  return NextResponse.json({
    ok: true,
    schema: process.env.NEXT_PUBLIC_DB_SCHEMA ?? process.env.DB_SCHEMA ?? "study_agent",
    dueWindowHours: DEFAULT_DUE_WINDOW_HOURS,
    count: dueSoonAssignments?.length ?? 0,
    assignments: dueSoonAssignments ?? [],
    whatsapp: whatsappResult,
  });
}

export async function GET(request: Request) {
  return handleCronRequest(request);
}

export async function POST(request: Request) {
  return handleCronRequest(request);
}

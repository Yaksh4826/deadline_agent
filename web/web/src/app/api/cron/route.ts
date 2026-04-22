import { NextResponse } from "next/server";
import { normalizeAssignmentRows, type AssignmentRow } from "@/lib/assignmentRow";
import { getSupabaseForStudyAgent } from "@/lib/studyAgentSupabase";
import { sendWhatsAppText } from "@/lib/whatsappCloud";

const UPCOMING_DAYS = 14;
const OVERDUE_LOOKBACK_DAYS = 30;
const ASSIGNMENT_FETCH_LIMIT = 80;
const VELOCITY_WINDOW_DAYS = 14;
const PRODUCTIVITY_LOG_CAP = 400;
const LLM_MAX_OUT_TOKENS = 2500;

type ProductivityLogRow = {
  activity_type: string;
  duration_minutes: number | null;
  logged_at: string;
  notes: string | null;
  assignment_id: number | null;
  course_id: number | null;
};

type ProductivityVelocitySnapshot = {
  windowDays: number;
  logRowsInWindow: number;
  totalMinutesLogged: number;
  avgMinutesPerLog: number | null;
  minutesPerDayEstimate: number | null;
  byActivityType: Record<string, { entries: number; minutes: number }>;
  recentEntries: Array<{
    logged_at: string;
    activity_type: string;
    duration_minutes: number | null;
    notes: string | null;
  }>;
};

function isAuthorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return false;
  }

  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    const token = bearer.slice("Bearer ".length).trim();
    if (token === expected) {
      return true;
    }
  }

  const provided =
    request.headers.get("CRON_SECRET") ??
    request.headers.get("cron_secret") ??
    request.headers.get("x-cron-secret");

  return provided === expected;
}

function filterUpcomingAssignments(rows: AssignmentRow[]): AssignmentRow[] {
  const now = Date.now();
  const upcomingEnd = now + UPCOMING_DAYS * 24 * 60 * 60 * 1000;
  const overdueStart = now - OVERDUE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  return rows.filter((a) => {
    if (a.due_date === null) {
      return true;
    }
    const t = new Date(a.due_date).getTime();
    if (Number.isNaN(t)) {
      return true;
    }
    if (t < now) {
      return t >= overdueStart;
    }
    return t <= upcomingEnd;
  });
}

/** Full assignment rows as stored / joined (for the agent). */
function assignmentsToRawPayload(assignments: AssignmentRow[]) {
  return assignments.map((a) => ({
    id: a.id,
    course_id: a.course_id,
    course: a.courses
      ? { name: a.courses.name, code: a.courses.code }
      : null,
    title: a.title,
    description: a.description,
    due_date: a.due_date,
    status: a.status,
    priority: a.priority,
  }));
}

function buildVelocityFromLogs(rows: ProductivityLogRow[]): ProductivityVelocitySnapshot {
  const byActivityType: Record<string, { entries: number; minutes: number }> = {};
  let totalMinutesLogged = 0;

  for (const row of rows) {
    const m = row.duration_minutes ?? 0;
    totalMinutesLogged += m;
    const key = row.activity_type || "unknown";
    if (!byActivityType[key]) {
      byActivityType[key] = { entries: 0, minutes: 0 };
    }
    byActivityType[key].entries += 1;
    byActivityType[key].minutes += m;
  }

  const n = rows.length;
  const avgMinutesPerLog = n > 0 ? totalMinutesLogged / n : null;
  const minutesPerDayEstimate =
    VELOCITY_WINDOW_DAYS > 0 ? totalMinutesLogged / VELOCITY_WINDOW_DAYS : null;

  const recentEntries = rows.slice(0, 20).map((r) => ({
    logged_at: r.logged_at,
    activity_type: r.activity_type,
    duration_minutes: r.duration_minutes,
    notes: r.notes ? r.notes.slice(0, 200) : null,
  }));

  return {
    windowDays: VELOCITY_WINDOW_DAYS,
    logRowsInWindow: n,
    totalMinutesLogged,
    avgMinutesPerLog,
    minutesPerDayEstimate,
    byActivityType,
    recentEntries,
  };
}

function scheduleTimezone(): string {
  return process.env.STUDY_SCHEDULE_TZ ?? process.env.WHATSAPP_WEBHOOK_TZ ?? "America/New_York";
}

function formatTodayInTz(timeZone: string): string {
  return new Date().toLocaleString("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function buildAgenticSchedulePrompt(
  assignments: AssignmentRow[],
  velocity: ProductivityVelocitySnapshot,
): { system: string; user: string } {
  const tz = scheduleTimezone();
  const todayStr = formatTodayInTz(tz);
  const rawAssignmentsJson = JSON.stringify(assignmentsToRawPayload(assignments), null, 2);
  const velocityJson = JSON.stringify(velocity, null, 2);

  const system = `You are a study scheduling agent. You receive structured data from the student's database (assignments + productivity velocity). You must reason about cognitive load and sustainable pacing, then output exactly one plain-text message for WhatsApp: no JSON, no markdown code fences, no XML.`;

  const user = `## Scheduling context

### Today (student timezone: ${tz})
${todayStr}

### Productivity velocity
Computed from Supabase table productivity_logs over the last ${velocity.windowDays} days (see fields below). Use minutesPerDayEstimate and recentEntries to calibrate how aggressive today's schedule should be. If logRowsInWindow is 0 or totals are very low, keep the plan gentle and build habits.

${velocityJson}

### Raw assignments (JSON)
These rows are already filtered to: overdue within ${OVERDUE_LOOKBACK_DAYS} days, due within the next ${UPCOMING_DAYS} days, or no due date; status is not completed. Use ids/titles consistently.

${rawAssignmentsJson}

## What you must produce

1) **Intensity map** — For every assignment in the JSON above, assign exactly one label: **High Intensity** (deep focus: exams, proofs, long writing, hard problem sets, big projects) or **Low Intensity** (readings, flashcards, light review, organization, short quizzes). List under two headings with bullet lines that include assignment id and title.

2) **Today's schedule** — Build a single-day timetable with **specific clock times** (e.g. 9:15–10:45). Include:
   - Named blocks tied to assignment id or title
   - **Breaks** after demanding blocks (state duration, e.g. 10 min walk)
   - A longer break mid-day if the plan spans lunch
   - Interleave high and low intensity where it aids recovery
   - Let **productivity velocity** guide total focused minutes: lower recent volume → shorter deep-work stretches; higher volume → you may propose deeper blocks while still including breaks

3) **Closing** — One short encouraging line.

Start the message with the title line: Daily Study Plan

Keep the full message under 3500 characters.`;

  return { system, user };
}

function fallbackPlan(assignments: AssignmentRow[]): string {
  if (assignments.length === 0) {
    return "Daily Study Plan\n\nNo open assignments in the upcoming window. Nice work—use the time for review or deep work.";
  }

  const lines = assignments.slice(0, 25).map((a) => {
    const course = a.courses?.name ?? `Course ${a.course_id}`;
    const due = a.due_date ? new Date(a.due_date).toISOString().slice(0, 16).replace("T", " ") : "no due date";
    return `• ${a.title} (${course}) — due ${due}`;
  });

  return ["Daily Study Plan", "", ...lines].join("\n");
}

async function generateAgenticScheduleWithLlm(
  assignments: AssignmentRow[],
  velocity: ProductivityVelocitySnapshot,
): Promise<string> {
  const { system, user } = buildAgenticSchedulePrompt(assignments, velocity);

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.55,
        max_tokens: LLM_MAX_OUT_TOKENS,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (text) {
      return text;
    }
    throw new Error("OpenAI returned an empty completion.");
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const model = process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-20241022";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: LLM_MAX_OUT_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((b) => b.type === "text")?.text?.trim();
    if (text) {
      return text;
    }
    throw new Error("Anthropic returned an empty completion.");
  }

  throw new Error("Set OPENAI_API_KEY or ANTHROPIC_API_KEY to generate a study plan.");
}

async function handleCronRequest(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseForStudyAgent();
  const since = new Date(Date.now() - VELOCITY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [assignRes, logsRes] = await Promise.all([
    supabase
      .from("assignments")
      .select("id,title,description,due_date,status,priority,course_id,courses(name,code)")
      .neq("status", "completed")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(ASSIGNMENT_FETCH_LIMIT),
    supabase
      .from("productivity_logs")
      .select("activity_type, duration_minutes, logged_at, notes, assignment_id, course_id")
      .gte("logged_at", since)
      .order("logged_at", { ascending: false })
      .limit(PRODUCTIVITY_LOG_CAP),
  ]);

  if (assignRes.error) {
    return NextResponse.json(
      { error: "Failed to fetch assignments", details: assignRes.error.message },
      { status: 500 },
    );
  }

  if (logsRes.error) {
    console.error("productivity_logs fetch:", logsRes.error.message);
  }

  const allFetched = normalizeAssignmentRows(assignRes.data);
  const assignments = filterUpcomingAssignments(allFetched);
  const velocity = buildVelocityFromLogs((logsRes.data ?? []) as ProductivityLogRow[]);

  let plan: string;
  try {
    plan = await generateAgenticScheduleWithLlm(assignments, velocity);
  } catch (e) {
    plan = fallbackPlan(assignments);
    const message = e instanceof Error ? e.message : String(e);
    const to = process.env.WHATSAPP_RECIPIENT_PHONE;
    if (!to) {
      return NextResponse.json(
        { ok: false, error: "Missing WHATSAPP_RECIPIENT_PHONE", llmError: message },
        { status: 500 },
      );
    }
    const whatsappResult = await sendWhatsAppText(to, plan);
    if (!whatsappResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "LLM failed and WhatsApp send failed",
          llmError: message,
          whatsappError: whatsappResult.error,
          assignmentCount: assignments.length,
        },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      warning: "LLM unavailable; sent fallback plan",
      llmError: message,
      assignmentCount: assignments.length,
      whatsapp: whatsappResult,
    });
  }

  const to = process.env.WHATSAPP_RECIPIENT_PHONE;
  if (!to) {
    return NextResponse.json({ ok: false, error: "Missing WHATSAPP_RECIPIENT_PHONE" }, { status: 500 });
  }
  const whatsappResult = await sendWhatsAppText(to, plan);
  if (!whatsappResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "WhatsApp send failed",
        details: whatsappResult.error,
        assignmentCount: assignments.length,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    schema: process.env.NEXT_PUBLIC_DB_SCHEMA ?? process.env.DB_SCHEMA ?? "study_agent",
    assignmentCount: assignments.length,
    whatsapp: whatsappResult,
  });
}

export async function GET(request: Request) {
  return handleCronRequest(request);
}

export async function POST(request: Request) {
  return handleCronRequest(request);
}

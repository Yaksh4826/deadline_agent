import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const UPCOMING_DAYS = 14;
const OVERDUE_LOOKBACK_DAYS = 30;
const ASSIGNMENT_FETCH_LIMIT = 80;
const WHATSAPP_MAX_BODY = 4096;

type CourseRow = { name: string; code: string | null };
type AssignmentRow = {
  id: number;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string;
  priority: number | null;
  course_id: number;
  courses: CourseRow | null;
};

function normalizeCourseRelation(
  courses: CourseRow | CourseRow[] | null | undefined,
): CourseRow | null {
  if (!courses) {
    return null;
  }
  return Array.isArray(courses) ? (courses[0] ?? null) : courses;
}

function normalizeAssignmentRows(raw: unknown): AssignmentRow[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as number,
      title: r.title as string,
      description: (r.description as string | null) ?? null,
      due_date: (r.due_date as string | null) ?? null,
      status: r.status as string,
      priority: (r.priority as number | null) ?? null,
      course_id: r.course_id as number,
      courses: normalizeCourseRelation(
        r.courses as CourseRow | CourseRow[] | null | undefined,
      ),
    };
  });
}

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

function assignmentsToBriefJson(assignments: AssignmentRow[]) {
  return assignments.map((a) => ({
    title: a.title,
    course: a.courses?.name ?? `course_id:${a.course_id}`,
    courseCode: a.courses?.code ?? null,
    dueDate: a.due_date,
    priority: a.priority,
    status: a.status,
    description: a.description ? a.description.slice(0, 500) : null,
  }));
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

async function generateDailyStudyPlanWithLlm(assignments: AssignmentRow[]): Promise<string> {
  const brief = JSON.stringify(assignmentsToBriefJson(assignments));
  const userPrompt = `You are helping a student plan their day.

Here are their open assignments as JSON (already filtered to overdue within ${OVERDUE_LOOKBACK_DAYS} days, due in the next ${UPCOMING_DAYS} days, or with no due date):

${brief}

Write a single message titled "Daily Study Plan". Use short sections and bullet points. Prioritize by due date and priority. Suggest realistic time blocks for today. If the list is empty, encourage light review or a stretch goal. Stay under 3500 characters. No markdown code fences.`;

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
        temperature: 0.6,
        max_tokens: 1400,
        messages: [
          {
            role: "system",
            content:
              "You write clear, actionable daily study plans. Be concise and supportive. Output plain text suitable for WhatsApp.",
          },
          { role: "user", content: userPrompt },
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
        max_tokens: 1400,
        system:
          "You write clear, actionable daily study plans. Be concise and supportive. Output plain text suitable for WhatsApp.",
        messages: [{ role: "user", content: userPrompt }],
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

async function sendWhatsAppDailyPlan(body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const to = process.env.WHATSAPP_RECIPIENT_PHONE;

  if (!token || !phoneNumberId || !to) {
    return {
      ok: false,
      error:
        "Missing WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, or WHATSAPP_RECIPIENT_PHONE (WhatsApp Cloud API).",
    };
  }

  const version = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v21.0";
  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  const normalizedTo = to.replace(/\D/g, "");
  const textBody =
    body.length > WHATSAPP_MAX_BODY ? `${body.slice(0, WHATSAPP_MAX_BODY - 1)}…` : body;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizedTo,
      type: "text",
      text: { preview_url: false, body: textBody },
    }),
  });

  if (!res.ok) {
    return { ok: false, error: await res.text() };
  }

  return { ok: true };
}

async function handleCronRequest(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseForStudyAgent();

  const { data: rawRows, error } = await supabase
    .from("assignments")
    .select("id,title,description,due_date,status,priority,course_id,courses(name,code)")
    .neq("status", "completed")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(ASSIGNMENT_FETCH_LIMIT);

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch assignments", details: error.message },
      { status: 500 },
    );
  }

  const allFetched = normalizeAssignmentRows(rawRows);
  const assignments = filterUpcomingAssignments(allFetched);

  let plan: string;
  try {
    plan = await generateDailyStudyPlanWithLlm(assignments);
  } catch (e) {
    plan = fallbackPlan(assignments);
    const message = e instanceof Error ? e.message : String(e);
    const whatsappResult = await sendWhatsAppDailyPlan(plan);
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

  const whatsappResult = await sendWhatsAppDailyPlan(plan);
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

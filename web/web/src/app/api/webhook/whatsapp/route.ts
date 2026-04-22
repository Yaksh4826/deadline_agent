import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { normalizeAssignmentRows, type AssignmentRow } from "@/lib/assignmentRow";
import { getSupabaseForStudyAgent } from "@/lib/studyAgentSupabase";
import { sendWhatsAppText } from "@/lib/whatsappCloud";

export const dynamic = "force-dynamic";

const ASSIGNMENT_LIMIT = 120;

function calendarKeyInTimeZone(d: Date, timeZone: string): string {
  return d.toLocaleDateString("en-CA", { timeZone });
}

function isDueToday(dueDate: string | null, timeZone: string, now: Date): boolean {
  if (!dueDate) {
    return false;
  }
  return calendarKeyInTimeZone(new Date(dueDate), timeZone) === calendarKeyInTimeZone(now, timeZone);
}

function isOverdue(dueDate: string | null, timeZone: string, now: Date): boolean {
  if (!dueDate) {
    return false;
  }
  return calendarKeyInTimeZone(new Date(dueDate), timeZone) < calendarKeyInTimeZone(now, timeZone);
}

function courseLabel(a: AssignmentRow): string {
  return a.courses?.name ?? `Course ${a.course_id}`;
}

function formatDueLine(a: AssignmentRow, timeZone: string): string {
  if (!a.due_date) {
    return "no due date";
  }
  const d = new Date(a.due_date);
  const when = d.toLocaleString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return when;
}

function sortForTodayPlan(a: AssignmentRow, b: AssignmentRow, timeZone: string, now: Date): number {
  const ao = isOverdue(a.due_date, timeZone, now);
  const bo = isOverdue(b.due_date, timeZone, now);
  if (ao !== bo) {
    return ao ? -1 : 1;
  }
  const at = isDueToday(a.due_date, timeZone, now);
  const bt = isDueToday(b.due_date, timeZone, now);
  if (at !== bt) {
    return at ? -1 : 1;
  }
  const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity;
  const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity;
  return ad - bd;
}

function buildStatusReply(open: AssignmentRow[], timeZone: string, now: Date): string {
  const dueToday = open.filter((a) => isDueToday(a.due_date, timeZone, now));
  const overdue = open.filter((a) => isOverdue(a.due_date, timeZone, now));
  const later = open.filter(
    (a) =>
      a.due_date &&
      !isDueToday(a.due_date, timeZone, now) &&
      !isOverdue(a.due_date, timeZone, now),
  );
  const noDate = open.filter((a) => !a.due_date);

  const lines = [
    "Status",
    "",
    `Open assignments: ${open.length}`,
    `Due today: ${dueToday.length}`,
    `Overdue: ${overdue.length}`,
    `Scheduled ahead: ${later.length}`,
    `No due date: ${noDate.length}`,
  ];

  if (dueToday.length > 0) {
    lines.push("", "Due today:");
    dueToday.slice(0, 8).forEach((a) => {
      lines.push(`• ${a.title} (${courseLabel(a)})`);
    });
    if (dueToday.length > 8) {
      lines.push(`…and ${dueToday.length - 8} more today`);
    }
  }

  if (overdue.length > 0 && dueToday.length === 0) {
    lines.push("", "Oldest overdue:");
    overdue.slice(0, 5).forEach((a) => {
      lines.push(`• ${a.title} (${courseLabel(a)}) — ${formatDueLine(a, timeZone)}`);
    });
  }

  return lines.join("\n");
}

function buildPlanReply(open: AssignmentRow[], timeZone: string, now: Date): string {
  const focus = [...open].sort((a, b) => sortForTodayPlan(a, b, timeZone, now));

  const list = (focus.length > 0 ? focus : open).slice(0, 20);
  if (list.length === 0) {
    return [
      "Plan for today",
      "",
      "No open assignments. Take a breather or review something you enjoyed recently.",
    ].join("\n");
  }

  const lines = [
    "Plan for today",
    "",
    "Prioritize in this order (overdue → due today → dated next → no date):",
  ];

  list.forEach((a) => {
    let tag = "";
    if (isOverdue(a.due_date, timeZone, now)) {
      tag = " [overdue]";
    } else if (isDueToday(a.due_date, timeZone, now)) {
      tag = " [today]";
    } else if (!a.due_date) {
      tag = " [no date]";
    }
    lines.push(`• ${a.title} (${courseLabel(a)})${tag} — ${formatDueLine(a, timeZone)}`);
  });

  if (focus.length > 20) {
    lines.push(`…showing 20 of ${focus.length} prioritized items`);
  }

  return lines.join("\n");
}

function parseCommand(text: string): "status" | "plan" | null {
  const t = text.trim().toLowerCase();
  if (t === "status") {
    return "status";
  }
  if (t === "plan") {
    return "plan";
  }
  return null;
}

function verifyMetaSignature(headers: Headers, rawBody: string): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    return true;
  }

  const sig = headers.get("x-hub-signature-256");
  if (!sig?.startsWith("sha256=")) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = sig.slice("sha256=".length);

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
  } catch {
    return false;
  }
}

function isSenderAllowed(fromDigits: string): boolean {
  const allow = process.env.WHATSAPP_ALLOWED_SENDERS;
  if (!allow?.trim()) {
    return true;
  }
  const set = new Set(
    allow
      .split(",")
      .map((s) => s.replace(/\D/g, ""))
      .filter(Boolean),
  );
  return set.has(fromDigits);
}

async function logInteraction(params: {
  from: string;
  inboundText: string;
  command: string | null;
  replyText: string;
  sendOk: boolean;
  sendError?: string;
}) {
  try {
    const supabase = getSupabaseForStudyAgent();
    const notes = JSON.stringify({
      channel: "whatsapp",
      from: params.from,
      inbound: params.inboundText.slice(0, 2000),
      command: params.command,
      replyPreview: params.replyText.slice(0, 800),
      sendOk: params.sendOk,
      sendError: params.sendError,
      at: new Date().toISOString(),
    });

    const { error } = await supabase.from("productivity_logs").insert({
      activity_type: "whatsapp_webhook",
      notes,
    });

    if (error) {
      console.error("study_agent productivity_logs insert failed:", error.message);
    }
  } catch (e) {
    console.error("logInteraction:", e);
  }
}

type WaTextMessage = { from?: string; type?: string; text?: { body?: string } };

function collectInboundTexts(payload: unknown): WaTextMessage[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const root = payload as Record<string, unknown>;
  if (root.object !== "whatsapp_business_account") {
    return [];
  }

  const entry = root.entry;
  if (!Array.isArray(entry)) {
    return [];
  }

  const messages: WaTextMessage[] = [];

  for (const ent of entry) {
    if (!ent || typeof ent !== "object") {
      continue;
    }
    const changes = (ent as Record<string, unknown>).changes;
    if (!Array.isArray(changes)) {
      continue;
    }
    for (const ch of changes) {
      if (!ch || typeof ch !== "object") {
        continue;
      }
      const value = (ch as Record<string, unknown>).value as Record<string, unknown> | undefined;
      const msgs = value?.messages;
      if (!Array.isArray(msgs)) {
        continue;
      }
      for (const m of msgs) {
        if (m && typeof m === "object") {
          messages.push(m as WaTextMessage);
        }
      }
    }
  }

  return messages;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return new NextResponse("WHATSAPP_VERIFY_TOKEN is not configured", { status: 503 });
  }

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!verifyMetaSignature(request.headers, rawBody)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const texts = collectInboundTexts(payload).filter(
    (m) => m.type === "text" && m.text?.body && m.from,
  );

  if (texts.length === 0) {
    return new NextResponse("OK", { status: 200 });
  }

  const timeZone = process.env.WHATSAPP_WEBHOOK_TZ ?? "America/New_York";
  const now = new Date();

  let supabase;
  try {
    supabase = getSupabaseForStudyAgent();
  } catch (e) {
    console.error(e);
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const { data: rawRows, error: fetchError } = await supabase
    .from("assignments")
    .select("id,title,description,due_date,status,priority,course_id,courses(name,code)")
    .neq("status", "completed")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(ASSIGNMENT_LIMIT);

  if (fetchError) {
    console.error(fetchError.message);
    return new NextResponse("Database error", { status: 500 });
  }

  const open = normalizeAssignmentRows(rawRows);

  for (const msg of texts) {
    const from = msg.from as string;
    const body = (msg.text?.body ?? "").trim();
    const fromDigits = from.replace(/\D/g, "");

    if (!isSenderAllowed(fromDigits)) {
      await logInteraction({
        from: fromDigits,
        inboundText: body,
        command: null,
        replyText: "",
        sendOk: false,
        sendError: "sender_not_allowed",
      });
      continue;
    }

    const command = parseCommand(body);
    let reply: string;

    if (command === "status") {
      reply = buildStatusReply(open, timeZone, now);
    } else if (command === "plan") {
      reply = buildPlanReply(open, timeZone, now);
    } else {
      reply = 'Send "Status" for counts and what is due today, or "Plan" for a prioritized study list.';
    }

    const sendResult = await sendWhatsAppText(from, reply);
    await logInteraction({
      from: fromDigits,
      inboundText: body,
      command,
      replyText: reply,
      sendOk: sendResult.ok,
      sendError: sendResult.ok ? undefined : sendResult.error,
    });
  }

  return new NextResponse("OK", { status: 200 });
}

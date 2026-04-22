import { normalizeAssignmentRows, type AssignmentRow } from "@/lib/assignmentRow";
import {
  getSupabaseForStudyAgent,
  mapStudyAgentQueryError,
} from "@/lib/studyAgentSupabase";

const STUDY_SESSIONS_LOOKBACK_DAYS = 7;
const ASSIGNMENT_STATUS_PENDING = "pending" as const;
const COURSE_LOOKBACK_DAYS = 30;
const HEATMAP_LOOKBACK_DAYS = 90;

function dashboardTimeZone() {
  return process.env.DASHBOARD_TZ ?? "America/New_York";
}

function dateKeyInTimeZone(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone });
}

function findMondayInTz(now: Date, timeZone: string): Date {
  let t = new Date(now);
  for (let i = 0; i < 7; i++) {
    const w = t.toLocaleDateString("en-US", { timeZone, weekday: "long" });
    if (w === "Monday") {
      return t;
    }
    t = new Date(t.getTime() - 86400000);
  }
  return new Date(now);
}

function getCalendarWeekKeyRangeInTz(
  timeZone: string,
  now: Date,
): { mondayKey: string; sundayKey: string } {
  const mon = findMondayInTz(now, timeZone);
  const mondayKey = mon.toLocaleDateString("en-CA", { timeZone });
  let sun = new Date(mon);
  for (let d = 0; d < 6; d++) {
    sun = new Date(sun.getTime() + 86400000);
  }
  const sundayKey = sun.toLocaleDateString("en-CA", { timeZone });
  return { mondayKey, sundayKey };
}

function weekdayIndexMonFirst(iso: string, timeZone: string): number {
  const long = new Date(iso).toLocaleDateString("en-US", {
    timeZone,
    weekday: "long",
  });
  const map: Record<string, number> = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
    Saturday: 5,
    Sunday: 6,
  };
  return map[long] ?? 0;
}

/** Rolling 7 instants, labeled in `timeZone`. */
function getLast7DayKeysInTimeZone(
  timeZone: string,
  now: Date = new Date(),
): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toLocaleDateString("en-CA", { timeZone });
    const label = d.toLocaleDateString("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    out.push({ key, label });
  }
  return out;
}

// --- public API types ---

export type StudySessionRow = {
  id: number;
  course_id: number | null;
  assignment_id: number | null;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
};

/**
 * Fetches the last 7 days of `study_sessions` (schema from env: public or study_agent).
 * Ordered by `started_at` ascending.
 */
export async function fetchLastSevenDaysStudySessions(): Promise<{
  data: StudySessionRow[];
  error: null;
} | { data: null; error: Error }> {
  const supabase = getSupabaseForStudyAgent();
  const since = new Date();
  since.setDate(since.getDate() - STUDY_SESSIONS_LOOKBACK_DAYS);
  since.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("study_sessions")
    .select(
      "id,course_id,assignment_id,started_at,ended_at,duration_minutes,notes,created_at",
    )
    .gte("started_at", since.toISOString())
    .order("started_at", { ascending: true });

  if (error) {
    return { data: null, error: new Error(error.message) };
  }

  return { data: (data ?? []) as StudySessionRow[], error: null };
}

/** Pending assignments with course metadata. */
export async function fetchPendingAssignments(): Promise<{
  data: AssignmentRow[];
  error: null;
} | { data: null; error: Error }> {
  const supabase = getSupabaseForStudyAgent();

  const { data, error } = await supabase
    .from("assignments")
    .select("id,title,description,due_date,status,priority,course_id,courses(name,code)")
    .eq("status", ASSIGNMENT_STATUS_PENDING)
    .order("due_date", { ascending: true, nullsFirst: false });

  if (error) {
    return { data: null, error: new Error(error.message) };
  }

  return { data: normalizeAssignmentRows(data), error: null };
}

export type DashboardBarPoint = {
  label: string;
  planned_tasks: number;
  completed_tasks: number;
};

export type SessionVelocityPoint = {
  label: string;
  started_blocks: number;
  completed_blocks: number;
};

export type CourseTimeSlice = {
  name: string;
  minutes: number;
  percent: number;
};

export type WeekdayStat = { label: string; count: number; intensity: number };

export type UpcomingDeadlineRow = {
  id: number;
  title: string;
  course: string;
  due: string;
  due_date: string;
};

export type DashboardPageData = {
  totalTasksDue: number;
  dueThisCalendarWeek: number;
  averageFocusScore: number;
  weeklyCompletionRate: number;
  /** Assignments: due on calendar day vs completed that day. */
  assignmentTrend: DashboardBarPoint[];
  /** study_sessions: blocks started per day vs sessions with an end that day. */
  sessionVelocity: SessionVelocityPoint[];
  courseTimeBreakdown: CourseTimeSlice[];
  weekdayProductivity: WeekdayStat[];
  productivityInsight: string;
  upcoming: UpcomingDeadlineRow[];
  error: string | null;
};

type SessionForAgg = {
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  course_id: number | null;
  courses: { name: string } | { name: string }[] | null;
};

function normalizeSessionCourse(
  c: { name: string } | { name: string }[] | null,
): { name: string } | null {
  if (!c) {
    return null;
  }
  return Array.isArray(c) ? c[0] ?? null : c;
}

export async function fetchDashboardPageData(): Promise<DashboardPageData> {
  const supabase = getSupabaseForStudyAgent();
  const tz = dashboardTimeZone();
  const now = new Date();
  const { mondayKey, sundayKey } = getCalendarWeekKeyRangeInTz(tz, now);
  const dayMeta = getLast7DayKeysInTimeZone(tz, now);
  const dayKeys = dayMeta.map((d) => d.key);

  const since7 = new Date();
  since7.setDate(since7.getDate() - 7);
  since7.setHours(0, 0, 0, 0);
  const since30 = new Date();
  since30.setDate(since30.getDate() - COURSE_LOOKBACK_DAYS);
  since30.setHours(0, 0, 0, 0);
  const sinceHeat = new Date();
  sinceHeat.setDate(sinceHeat.getDate() - HEATMAP_LOOKBACK_DAYS);
  sinceHeat.setHours(0, 0, 0, 0);

  const { data: assnData, error: assnError } = await supabase
    .from("assignments")
    .select("id,title,description,due_date,status,priority,updated_at,course_id,courses(name,code)")
    .limit(5000);

  const sessionsPromise = supabase
    .from("study_sessions")
    .select("started_at,ended_at,duration_minutes,course_id,courses(name)")
    .gte("started_at", since7.toISOString());

  const sessions30Promise = supabase
    .from("study_sessions")
    .select("duration_minutes,course_id,courses(name)")
    .gte("started_at", since30.toISOString())
    .not("duration_minutes", "is", null);

  if (assnError) {
    return {
      totalTasksDue: 0,
      dueThisCalendarWeek: 0,
      averageFocusScore: 0,
      weeklyCompletionRate: 0,
      assignmentTrend: [],
      sessionVelocity: [],
      courseTimeBreakdown: [],
      weekdayProductivity: [],
      productivityInsight: "",
      upcoming: [],
      error: mapStudyAgentQueryError(assnError),
    };
  }

  const [ses7, ses30] = await Promise.all([sessionsPromise, sessions30Promise]);

  if (ses7.error) {
    console.error("study_sessions (7d):", ses7.error.message);
  }
  if (ses30.error) {
    console.error("study_sessions (30d):", ses30.error.message);
  }

  const assignments = normalizeAssignmentRows(assnData);

  const assignmentTrend: DashboardBarPoint[] = dayMeta.map(({ key, label }) => {
    const planned_tasks = assignments.filter(
      (a) => a.due_date && dateKeyInTimeZone(a.due_date, tz) === key,
    ).length;
    const completed_tasks = assignments.filter(
      (a) =>
        a.status === "completed" &&
        a.updated_at &&
        dateKeyInTimeZone(a.updated_at, tz) === key,
    ).length;
    return { label, planned_tasks, completed_tasks };
  });

  const sessionRows7 = (ses7.error ? [] : (ses7.data ?? [])) as SessionForAgg[];
  const sessionVelocity: SessionVelocityPoint[] = dayMeta.map(({ key, label }) => {
    const started_blocks = sessionRows7.filter(
      (s) => s.started_at && dateKeyInTimeZone(s.started_at, tz) === key,
    ).length;
    const completed_blocks = sessionRows7.filter(
      (s) => s.ended_at && dateKeyInTimeZone(s.ended_at, tz) === key,
    ).length;
    return { label, started_blocks, completed_blocks };
  });

  const minKey = dayKeys[0]!;
  const maxKey = dayKeys[6]!;

  const dueInWindow = assignments.filter(
    (a) =>
      a.due_date &&
      (() => {
        const k = dateKeyInTimeZone(a.due_date, tz);
        return k >= minKey && k <= maxKey;
      })(),
  );
  const completedInWindow = dueInWindow.filter((a) => a.status === "completed");
  const weeklyCompletionRate =
    dueInWindow.length > 0
      ? Math.round((100 * completedInWindow.length) / dueInWindow.length)
      : 0;

  const totalTasksDue = assignments.filter((a) => a.status !== "completed").length;

  const dueThisCalendarWeek = assignments.filter(
    (a) =>
      a.status !== "completed" &&
      a.due_date &&
      (() => {
        const k = dateKeyInTimeZone(a.due_date, tz);
        return k >= mondayKey && k <= sundayKey;
      })(),
  ).length;

  const { data: focusRows, error: sessError } = await supabase
    .from("study_sessions")
    .select("duration_minutes")
    .gte("started_at", since7.toISOString())
    .not("duration_minutes", "is", null);

  let averageFocusScore = 0;
  if (!sessError && focusRows && focusRows.length > 0) {
    const durations = (focusRows as { duration_minutes: number }[])
      .map((r) => r.duration_minutes)
      .filter((m): m is number => typeof m === "number" && m > 0);
    if (durations.length > 0) {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      averageFocusScore = Math.min(100, Math.round((avg / 90) * 100));
    }
  }

  const byCourse = new Map<string, number>();
  const s30 = (ses30.error ? [] : (ses30.data ?? [])) as {
    duration_minutes: number;
    course_id: number | null;
    courses: { name: string } | { name: string }[] | null;
  }[];
  if (!ses30.error) {
    for (const row of s30) {
      const c = normalizeSessionCourse(row.courses);
      const name = c?.name ?? (row.course_id != null ? `Course ${row.course_id}` : "Unassigned");
      const m = row.duration_minutes ?? 0;
      byCourse.set(name, (byCourse.get(name) ?? 0) + m);
    }
  }
  const totalM = [...byCourse.values()].reduce((a, b) => a + b, 0) || 1;
  const courseTimeBreakdown: CourseTimeSlice[] = [...byCourse.entries()]
    .map(([name, minutes]) => ({
      name,
      minutes: Math.round(minutes),
      percent: Math.round((100 * minutes) / totalM),
    }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 8);

  const wkCounts = [0, 0, 0, 0, 0, 0, 0];
  const wkLabel = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  for (const a of assignments) {
    if (a.status !== "completed" || !a.updated_at) {
      continue;
    }
    if (new Date(a.updated_at) < sinceHeat) {
      continue;
    }
    const i = weekdayIndexMonFirst(a.updated_at, tz);
    wkCounts[i] += 1;
  }
  const maxC = Math.max(1, ...wkCounts);
  const weekdayProductivity: WeekdayStat[] = wkLabel.map((label, i) => ({
    label,
    count: wkCounts[i] ?? 0,
    intensity: (wkCounts[i] ?? 0) / maxC,
  }));

  const nonZero = wkCounts.filter((c) => c > 0);
  const bestIdx = wkCounts.indexOf(Math.max(...wkCounts));
  const mean = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
  let productivityInsight = "";
  if (mean > 0 && wkCounts[bestIdx]! > 0) {
    const uplift = Math.round(
      (100 * (wkCounts[bestIdx]! - mean)) / Math.max(1, mean),
    );
    productivityInsight = `In the last ${HEATMAP_LOOKBACK_DAYS} days, you marked most assignments complete on ${
      wkLabel[bestIdx]
    }${
      uplift > 0
        ? ` (~${uplift}% more completions that day than your per-day average across days with activity).`
        : "."
    }`;
  } else {
    productivityInsight = "Complete more tasks to see which weekday is your strongest.";
  }

  const todayKey = dateKeyInTimeZone(now.toISOString(), tz);
  const upcoming = assignments
    .filter(
      (a) => a.status !== "completed" && a.due_date && dateKeyInTimeZone(a.due_date, tz) >= todayKey,
    )
    .sort(
      (a, b) =>
        new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime(),
    )
    .map((a) => ({
      id: a.id,
      title: a.title,
      course: a.courses?.name ?? `Course ${a.course_id}`,
      due: new Date(a.due_date!).toLocaleString("en-US", {
        timeZone: tz,
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      due_date: a.due_date!,
    }));

  return {
    totalTasksDue,
    dueThisCalendarWeek,
    averageFocusScore,
    weeklyCompletionRate,
    assignmentTrend,
    sessionVelocity,
    courseTimeBreakdown,
    weekdayProductivity,
    productivityInsight,
    upcoming,
    error: null,
  };
}

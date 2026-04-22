import {
  BarChart2,
  BookOpen,
  CalendarClock,
  ClipboardList,
  Flame,
  LayoutDashboard,
  Sparkles,
  Target,
} from "lucide-react";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchDashboardPageData } from "@/lib/data-fetchers";
import { CourseTimeChart } from "./course-time-chart";
import { SessionVelocityBars } from "./session-velocity-bars";
import { SyncNowButton } from "./sync-now-button";
import { WeekdayHeatmap } from "./weekday-heatmap";
import { WeeklyTaskBars } from "./weekly-bars";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Study Velocity | Study Agent",
  description: "Productivity, sessions, and course time",
};

export default async function DashboardPage() {
  const d = await fetchDashboardPageData();

  if (d.error) {
    return (
      <div className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <p className="whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            Could not load dashboard: {d.error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-violet-600/10 p-2 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">
              <LayoutDashboard className="h-6 w-6" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Study velocity</h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Load, focus, assignment trend, study sessions, and where your time goes
              </p>
            </div>
          </div>
          <SyncNowButton />
        </header>

        <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between text-zinc-500">
                <CardDescription className="text-xs font-medium uppercase tracking-wide">
                  Current load
                </CardDescription>
                <Target className="h-4 w-4 text-violet-500" />
              </div>
              <CardTitle className="text-3xl tabular-nums">{d.dueThisCalendarWeek}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-zinc-500">
              Open tasks due Mon–Sun (calendar week, your timezone)
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between text-zinc-500">
                <CardDescription className="text-xs font-medium uppercase tracking-wide">
                  Total tasks due
                </CardDescription>
                <ClipboardList className="h-4 w-4 text-violet-500" />
              </div>
              <CardTitle className="text-3xl tabular-nums">{d.totalTasksDue}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-zinc-500">All open assignments</CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between text-zinc-500">
                <CardDescription className="text-xs font-medium uppercase tracking-wide">
                  Average focus score
                </CardDescription>
                <Sparkles className="h-4 w-4 text-amber-500" />
              </div>
              <CardTitle className="text-3xl tabular-nums">
                {d.averageFocusScore}
                <span className="ml-0.5 text-lg font-medium text-zinc-400">/100</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-zinc-500">From study session length (7d)</CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between text-zinc-500">
                <CardDescription className="text-xs font-medium uppercase tracking-wide">
                  Weekly completion
                </CardDescription>
                <BarChart2 className="h-4 w-4 text-emerald-500" />
              </div>
              <CardTitle className="text-3xl tabular-nums">
                {d.weeklyCompletionRate}
                <span className="ml-0.5 text-lg font-medium text-zinc-400">%</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-zinc-500">Of dues in the 7-day chart window</CardContent>
          </Card>
        </section>

        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart2 className="h-5 w-5 text-violet-500" />
                <CardTitle className="text-base">Assignment trend</CardTitle>
              </div>
              <CardDescription>
                Planned = assignments due that day. Completed = marked done that day.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WeeklyTaskBars data={d.assignmentTrend} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-blue-500" />
                <CardTitle className="text-base">Study session velocity</CardTitle>
              </div>
              <CardDescription>
                From <code className="text-xs">study_sessions</code>: started vs ended (same day).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SessionVelocityBars data={d.sessionVelocity} />
            </CardContent>
          </Card>
        </div>

        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-violet-500" />
                <CardTitle className="text-base">Course time (30d)</CardTitle>
              </div>
              <CardDescription>Minutes logged in study sessions, by course</CardDescription>
            </CardHeader>
            <CardContent>
              <CourseTimeChart data={d.courseTimeBreakdown} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-amber-500" />
                <CardTitle className="text-base">Weekday completion pattern</CardTitle>
              </div>
              <CardDescription>When you mark assignments complete</CardDescription>
            </CardHeader>
            <CardContent>
              <WeekdayHeatmap days={d.weekdayProductivity} insight={d.productivityInsight} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-violet-500" />
              <CardTitle className="text-base">Upcoming deadlines</CardTitle>
            </div>
            <CardDescription>Closest first</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                    <th className="py-2 pr-4">Assignment</th>
                    <th className="py-2 pr-4">Course</th>
                    <th className="py-2">Due</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-800 dark:text-zinc-200">
                  {d.upcoming.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="py-8 text-center text-zinc-500 dark:text-zinc-400"
                      >
                        No upcoming due dates. Add assignments with future due dates.
                      </td>
                    </tr>
                  ) : (
                    d.upcoming.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/80"
                      >
                        <td className="max-w-xs py-2.5 pr-4 font-medium leading-snug">
                          {row.title}
                        </td>
                        <td className="py-2.5 pr-4 text-zinc-600 dark:text-zinc-300">
                          {row.course}
                        </td>
                        <td className="whitespace-nowrap py-2.5 text-zinc-500 dark:text-zinc-400">
                          {row.due}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

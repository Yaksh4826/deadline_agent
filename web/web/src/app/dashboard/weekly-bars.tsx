"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardBarPoint } from "@/lib/data-fetchers";

type Props = {
  data: DashboardBarPoint[];
};

export function WeeklyTaskBars({ data }: Props) {
  if (data.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
        No chart data yet. Add assignments with due dates in Supabase to see a trend.
      </p>
    );
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "currentColor" }}
            className="text-zinc-500"
            interval={0}
            tickMargin={6}
            angle={-18}
            textAnchor="end"
            height={60}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12, fill: "currentColor" }}
            className="text-zinc-500"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--background)",
              border: "1px solid rgb(228 228 231)",
              borderRadius: "8px",
            }}
            labelStyle={{ color: "var(--foreground)" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            name="Planned (due that day)"
            dataKey="planned_tasks"
            fill="rgb(99 102 241)"
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
          />
          <Bar
            name="Completed (that day)"
            dataKey="completed_tasks"
            fill="rgb(34 197 94)"
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

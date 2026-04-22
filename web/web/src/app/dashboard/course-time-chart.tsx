"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CourseTimeSlice } from "@/lib/data-fetchers";

type Props = { data: CourseTimeSlice[] };

export function CourseTimeChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No session minutes in the last 30 days with a course set.
      </p>
    );
  }

  const chartData = [...data].sort((a, b) => a.minutes - b.minutes);

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ fontSize: 11 }}
            className="text-zinc-600 dark:text-zinc-300"
          />
          <Tooltip
            formatter={(value, _name, item) => {
              const m = Number(value);
              const pct = item && typeof item === "object" && "payload" in item
                ? (item.payload as { percent?: number }).percent
                : undefined;
              return [`${m} min${pct != null ? ` (${pct}%)` : ""}`, "Time"];
            }}
            contentStyle={{
              backgroundColor: "var(--background)",
              border: "1px solid rgb(228 228 231)",
              borderRadius: "8px",
            }}
          />
          <Bar dataKey="minutes" fill="rgb(139 92 246)" radius={[0, 4, 4, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

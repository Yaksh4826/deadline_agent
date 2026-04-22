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
import type { SessionVelocityPoint } from "@/lib/data-fetchers";

type Props = { data: SessionVelocityPoint[] };

export function SessionVelocityBars({ data }: Props) {
  if (data.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
        No study sessions in the last 7 days. Log sessions in Supabase to see velocity.
      </p>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            className="text-zinc-500"
            interval={0}
            tickMargin={6}
            angle={-18}
            textAnchor="end"
            height={60}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} className="text-zinc-500" />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--background)",
              border: "1px solid rgb(228 228 231)",
              borderRadius: "8px",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            name="Sessions started"
            dataKey="started_blocks"
            fill="rgb(59 130 246)"
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
          />
          <Bar
            name="Sessions ended"
            dataKey="completed_blocks"
            fill="rgb(16 185 129)"
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

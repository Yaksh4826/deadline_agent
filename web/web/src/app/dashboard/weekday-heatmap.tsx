"use client";

import type { WeekdayStat } from "@/lib/data-fetchers";

type Props = {
  days: WeekdayStat[];
  insight: string;
};

export function WeekdayHeatmap({ days, insight }: Props) {
  return (
    <div>
      <div className="mb-3 flex gap-1 sm:gap-2">
        {days.map((d) => (
          <div
            key={d.label}
            className="flex flex-1 flex-col items-center gap-1"
            title={`${d.label}: ${d.count} completions`}
          >
            <div
              className="w-full max-w-[44px] rounded-md border border-zinc-200 bg-violet-500/10 dark:border-zinc-700"
              style={{
                height: 88,
                background:
                  d.intensity > 0
                    ? `linear-gradient(to top, rgb(124 58 237 / ${0.25 + d.intensity * 0.65}) 0%, rgb(124 58 237 / 0.08) 100%)`
                    : undefined,
              }}
            />
            <span className="text-[10px] font-medium text-zinc-500 sm:text-xs">{d.label}</span>
            <span className="text-[10px] tabular-nums text-zinc-400">{d.count}</span>
          </div>
        ))}
      </div>
      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{insight}</p>
      <p className="mt-1 text-xs text-zinc-500">
        Based on assignment “completed” timestamps (about the last 90 days, dashboard timezone).
      </p>
    </div>
  );
}

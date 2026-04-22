"use server";

import { headers } from "next/headers";

export type SyncCronResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Triggers /api/cron from the server with CRON_SECRET (never exposed to the browser).
 */
export async function syncCronNow(): Promise<SyncCronResult> {
  const secret = process.env.CRON_SECRET;
  if (!secret?.trim()) {
    return {
      ok: false,
      message: "CRON_SECRET is not set on the server. Add it to web/web/.env.local",
    };
  }

  const h = await headers();
  const fromVercel = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`
    : null;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    fromVercel ??
    `${proto}://${host}`;
  const url = `${base.replace(/\/$/, "")}/api/cron`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Request failed",
    };
  }

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, message: text.slice(0, 500) || `HTTP ${res.status}` };
  }

  return {
    ok: true,
    message: "Sync finished. Check WhatsApp if configured; stats refresh on reload.",
  };
}

"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { syncCronNow } from "./actions";
import { Button } from "@/components/ui/button";

export function SyncNowButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() => {
          setMsg(null);
          startTransition(async () => {
            const r = await syncCronNow();
            setMsg(r.message);
            if (r.ok) {
              router.refresh();
            }
          });
        }}
        className="gap-2"
      >
        <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} aria-hidden />
        Sync now
      </Button>
      {msg ? (
        <p
          className="max-w-xs text-right text-xs text-zinc-500 dark:text-zinc-400"
          role="status"
        >
          {msg}
        </p>
      ) : null}
    </div>
  );
}

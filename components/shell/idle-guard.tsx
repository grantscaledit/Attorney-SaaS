"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { hardNavigate } from "@/lib/ui/navigate";

/**
 * Client half of the 30-minute idle timeout (spec Section 4).
 *
 * The server session expires 30 minutes after its last refresh. This component
 * refreshes it at most once a minute while the person is actually working
 * (keyboard, pointer, scroll), warns two minutes before expiry, and signs out at
 * expiry. Activity is shared across tabs through localStorage.
 */
const ACTIVITY_KEY = "lexdesk:last-activity";
const EVENTS = ["pointerdown", "keydown", "scroll", "pointermove"] as const;

function readShared(): number {
  try {
    return Number(window.localStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeShared(ts: number): void {
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(ts));
  } catch {
    // Storage unavailable (private mode); this tab still tracks its own activity.
  }
}

export function IdleGuard({
  idleTimeoutSeconds,
  warningSeconds,
  refreshIntervalSeconds,
}: {
  idleTimeoutSeconds: number;
  warningSeconds: number;
  refreshIntervalSeconds: number;
}) {
  // Initialized on mount; render stays pure.
  const lastActivity = useRef(0);
  const lastRefresh = useRef(0);
  const [remaining, setRemaining] = useState<number | null>(null);

  const refreshSession = useCallback(async () => {
    lastRefresh.current = Date.now();
    const res = await fetch("/api/auth/get-session", {
      credentials: "same-origin",
      cache: "no-store",
    }).catch(() => null);
    if (res && res.ok) {
      const body = (await res.json().catch(() => null)) as unknown;
      if (body === null) hardNavigate("/sign-out?reason=idle");
    }
  }, []);

  useEffect(() => {
    lastActivity.current = Date.now();
    lastRefresh.current = Date.now();
    let lastWrite = 0;
    const onActivity = () => {
      const now = Date.now();
      lastActivity.current = now;
      if (now - lastWrite > 5_000) {
        writeShared(now);
        lastWrite = now;
      }
    };
    for (const e of EVENTS) window.addEventListener(e, onActivity, { passive: true });

    const tick = window.setInterval(() => {
      const now = Date.now();
      const last = Math.max(lastActivity.current, readShared());
      const idleFor = (now - last) / 1000;
      const left = idleTimeoutSeconds - idleFor;

      if (left <= 0) {
        hardNavigate("/sign-out?reason=idle");
        return;
      }
      setRemaining(left <= warningSeconds ? Math.ceil(left) : null);

      // Active since the last refresh and the refresh interval has passed: extend the session.
      if (
        last > lastRefresh.current &&
        now - lastRefresh.current > refreshIntervalSeconds * 1000 &&
        left > warningSeconds
      ) {
        void refreshSession();
      }
    }, 1000);

    return () => {
      for (const e of EVENTS) window.removeEventListener(e, onActivity);
      window.clearInterval(tick);
    };
  }, [idleTimeoutSeconds, warningSeconds, refreshIntervalSeconds, refreshSession]);

  const stay = () => {
    const now = Date.now();
    lastActivity.current = now;
    writeShared(now);
    setRemaining(null);
    void refreshSession();
  };

  const mm =
    remaining === null
      ? ""
      : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;

  return (
    <Dialog open={remaining !== null} onOpenChange={(open) => (!open ? stay() : undefined)}>
      <DialogContent title="Are you still there?" hideClose>
        <p className="text-[13.5px] text-ink-2">
          For the security of client information, you will be signed out in{" "}
          <span className="font-mono font-medium text-ink" aria-live="polite">
            {mm}
          </span>
          .
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => hardNavigate("/sign-out")}>
            Sign out now
          </Button>
          <Button onClick={stay}>Stay signed in</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

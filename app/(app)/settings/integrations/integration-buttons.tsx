"use client";

import { RefreshCw, RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";
import { StatusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/commands/action-state";
import { reconcileNowAction, retryWebhookAction } from "./actions";

function Result({ state }: { state: ActionState<unknown> | null }) {
  if (!state || state.status === "idle") return null;
  return state.status === "success" ? (
    <StatusLabel tone="good">{state.message ?? "Done"}</StatusLabel>
  ) : (
    <StatusLabel tone="critical">{state.message}</StatusLabel>
  );
}

export function ReconcileNowButton({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState<unknown> | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Result state={state} />
      <Button
        variant="secondary"
        disabled={disabled || pending}
        onClick={() => start(async () => setState(await reconcileNowAction()))}
      >
        <RefreshCw /> {pending ? "Starting…" : "Run reconciliation now"}
      </Button>
    </div>
  );
}

export function RetryWebhookButton({ eventId }: { eventId: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState<unknown> | null>(null);
  if (state?.status === "success") return <StatusLabel tone="good">Queued</StatusLabel>;
  return (
    <span className="inline-flex items-center gap-2">
      {state?.status === "error" ? (
        <StatusLabel tone="critical">{state.message}</StatusLabel>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => start(async () => setState(await retryWebhookAction(eventId)))}
      >
        <RotateCcw /> Retry
      </Button>
    </span>
  );
}

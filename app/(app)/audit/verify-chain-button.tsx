"use client";

import { ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { StatusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/commands/action-state";
import type { ChainVerification } from "@/lib/audit/verify";
import { verifyChainAction } from "./actions";

export function VerifyChainButton() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState<ChainVerification> | null>(null);

  return (
    <div className="flex items-center gap-3">
      {state?.status === "success" ? (
        state.data.ok ? (
          <StatusLabel tone="good">
            Chain intact · {state.data.checked.toLocaleString()} entries
          </StatusLabel>
        ) : (
          <StatusLabel tone="critical">
            Broken at entry {state.data.firstInvalidSeq}: {state.data.reason}
          </StatusLabel>
        )
      ) : state?.status === "error" ? (
        <StatusLabel tone="critical">{state.message}</StatusLabel>
      ) : null}
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => start(async () => setState(await verifyChainAction()))}
      >
        <ShieldCheck /> {pending ? "Verifying…" : "Verify chain"}
      </Button>
    </div>
  );
}

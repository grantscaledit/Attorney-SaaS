"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import type { ActionState } from "@/lib/commands/action-state";
import {
  declineLeadAction,
  referLeadAction,
  rerunConflictAction,
  reviewConflictAction,
} from "./actions";

function Result({ state }: { state: ActionState<unknown> | null }) {
  if (!state || state.status === "idle") return null;
  return (
    <Notice tone={state.status === "success" ? "good" : "critical"} className="mt-3">
      {state.message}
    </Notice>
  );
}

/** A lawyer records the outcome of an A6 pre-screen. The check never clears itself. */
export function ConflictReview({ leadId, checkId }: { leadId: string; checkId: string }) {
  const [note, setNote] = useState("");
  const [state, setState] = useState<ActionState<unknown> | null>(null);
  const [pending, start] = useTransition();
  const decide = (decision: "cleared" | "conflict") =>
    start(async () => setState(await reviewConflictAction(leadId, { checkId, decision, note })));
  return (
    <div className="mt-4 border-t border-line pt-4">
      <Field
        id="conflict-note"
        label="Review note"
        hint="Record the basis for the decision, e.g. which matches you checked and why they are or are not the same party."
        errors={state?.status === "error" ? state.fieldErrors?.note : undefined}
      >
        <Textarea id="conflict-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => decide("cleared")}>
          Clear
        </Button>
        <Button size="sm" variant="danger" disabled={pending} onClick={() => decide("conflict")}>
          Record a conflict
        </Button>
      </div>
      <Result state={state} />
    </div>
  );
}

export function RerunConflict({ leadId }: { leadId: string }) {
  const [state, setState] = useState<ActionState<unknown> | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => start(async () => setState(await rerunConflictAction(leadId)))}
      >
        Run pre-screen
      </Button>
      <Result state={state} />
    </div>
  );
}

export function DeclineLead({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState<ActionState<unknown> | null>(null);
  const [pending, start] = useTransition();
  if (state?.status === "success") return <Result state={state} />;
  if (!open) {
    return (
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Decline this lead
      </Button>
    );
  }
  return (
    <div>
      <Field
        id="decline-note"
        label="Why the firm is declining"
        hint="Kept in the audit log. It is not sent to the person."
        errors={state?.status === "error" ? state.fieldErrors?.note : undefined}
      >
        <Textarea id="decline-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() => start(async () => setState(await declineLeadAction(leadId, note)))}
        >
          Decline and draft letter
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <Result state={state} />
    </div>
  );
}

export function ReferOut({
  leadId,
  partners,
}: {
  leadId: string;
  partners: { id: string; name: string; handles: string[] }[];
}) {
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? "");
  const [state, setState] = useState<ActionState<unknown> | null>(null);
  const [pending, start] = useTransition();
  if (partners.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        No referral partners yet. An owner can add them under Settings, Referral partners.
      </p>
    );
  }
  return (
    <div>
      <Field id="refer-partner" label="Refer to">
        <Select id="refer-partner" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.handles.join(", ")})
            </option>
          ))}
        </Select>
      </Field>
      <Button
        className="mt-3"
        size="sm"
        variant="secondary"
        disabled={pending || !partnerId}
        onClick={() => start(async () => setState(await referLeadAction(leadId, partnerId)))}
      >
        Draft referral
      </Button>
      <Result state={state} />
    </div>
  );
}

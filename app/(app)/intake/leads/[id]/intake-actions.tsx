"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-field";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import type { ActionState } from "@/lib/commands/action-state";
import {
  declineLeadAction,
  markSignedAction,
  referLeadAction,
  retainAction,
  withdrawEngagementAction,
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

export function RetainForm({
  leadId,
  signerName,
  signerEmail,
  areas,
}: {
  leadId: string;
  signerName: string;
  signerEmail: string | null;
  areas: { area: string; label: string; types: { key: string; label: string }[] }[];
}) {
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState(areas[0]?.area ?? "");
  const [type, setType] = useState(areas[0]?.types[0]?.key ?? "");
  const [feeTerms, setFeeTerms] = useState("");
  const [signingUrl, setSigningUrl] = useState("");
  const [state, setState] = useState<ActionState<unknown> | null>(null);
  const [pending, start] = useTransition();
  if (state?.status === "success") return <Result state={state} />;
  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Retain: draft engagement letter
      </Button>
    );
  }
  const types = areas.find((a) => a.area === area)?.types ?? [];
  const errors = state?.status === "error" ? state.fieldErrors : undefined;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field id="retain-area" label="Practice area">
          <Select
            id="retain-area"
            value={area}
            onChange={(e) => {
              setArea(e.target.value);
              setType(areas.find((a) => a.area === e.target.value)?.types[0]?.key ?? "");
            }}
          >
            {areas.map((a) => (
              <option key={a.area} value={a.area}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="retain-type" label="Matter type" errors={errors?.matterType}>
          <Select id="retain-type" value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field
        id="retain-fee"
        label="Fee terms"
        hint="Goes into the letter as written."
        errors={errors?.feeTerms}
      >
        <Textarea id="retain-fee" value={feeTerms} onChange={(e) => setFeeTerms(e.target.value)} />
      </Field>
      <Field
        id="retain-sign"
        label="Signing link"
        hint="Prepare the letter in your e-signature tool and paste its signing link. The letter's text is drafted here for your approval."
        errors={errors?.signingUrl}
      >
        <Input
          id="retain-sign"
          value={signingUrl}
          onChange={(e) => setSigningUrl(e.target.value)}
          placeholder="https://"
        />
      </Field>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () =>
              setState(
                await retainAction(leadId, {
                  practiceArea: area,
                  matterType: type,
                  feeTerms,
                  signingUrl,
                  signerName,
                  signerEmail,
                }),
              ),
            )
          }
        >
          Draft letter
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {state?.status === "error" && !state.fieldErrors ? <Result state={state} /> : null}
    </div>
  );
}

export function EngagementActions({
  leadId,
  engagementId,
  status,
}: {
  leadId: string;
  engagementId: string;
  status: string;
}) {
  const [state, setState] = useState<ActionState<unknown> | null>(null);
  const [pending, start] = useTransition();
  const data =
    state?.status === "success"
      ? (state.data as {
          matterId?: string;
          number?: string;
          portal?: { setupUrl?: string; skipped?: string } | null;
        })
      : null;
  if (data?.matterId) {
    return (
      <div className="space-y-2">
        <Notice tone="good">
          Matter {data.number} is open.{" "}
          <a href={`/matters/${data.matterId}`} className="underline">
            Open it
          </a>
        </Notice>
        {data.portal?.setupUrl ? (
          <>
            <CopyField label="Client portal setup link (shown once)" value={data.portal.setupUrl} />
            <p className="text-[12.5px] text-muted">
              Send it to the client yourself. It works once and expires.
            </p>
          </>
        ) : data.portal?.skipped ? (
          <Notice tone="warning">Portal access not set up: {data.portal.skipped}.</Notice>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {status === "sent" ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => start(async () => setState(await markSignedAction(leadId, engagementId)))}
        >
          Mark signed and open matter
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () =>
            setState(
              await withdrawEngagementAction(leadId, engagementId, "Withdrawn from the lead page"),
            ),
          )
        }
      >
        Withdraw letter
      </Button>
      <Result state={state} />
    </div>
  );
}

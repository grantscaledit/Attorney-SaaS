"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-field";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import type { ActionState } from "@/lib/commands/action-state";
import {
  addNoteAction,
  addPartyAction,
  assignAction,
  changeStageAction,
  closeMatterAction,
  confirmExtractionAction,
  createTaskAction,
  refreshSummaryAction,
  reissuePortalLinkAction,
  removePartyAction,
  requestDraftAction,
  setDocumentTypeAction,
  setTaskStatusAction,
  shareDocumentAction,
} from "./actions";

type State = ActionState<unknown> | null;

function Result({ state }: { state: State }) {
  if (!state || state.status === "idle" || (state.status === "success" && !state.message))
    return null;
  return (
    <Notice tone={state.status === "success" ? "good" : "critical"} className="mt-2">
      {state.message}
      {state.status === "error" && state.fieldErrors
        ? Object.values(state.fieldErrors)
            .flat()
            .map((e) => (
              <span key={e} className="block">
                {e}
              </span>
            ))
        : null}
    </Notice>
  );
}

function useAction() {
  const [state, setState] = useState<State>(null);
  const [pending, start] = useTransition();
  return {
    state,
    pending,
    go: (fn: () => Promise<ActionState<unknown>>) => start(async () => setState(await fn())),
  };
}

export function StageSelect({
  matterId,
  stage,
  stages,
}: {
  matterId: string;
  stage: string;
  stages: { key: string; label: string }[];
}) {
  const a = useAction();
  return (
    <div>
      <Field id="stage" label="Stage">
        <Select
          id="stage"
          defaultValue={stage}
          disabled={a.pending}
          onChange={(e) => a.go(() => changeStageAction(matterId, e.target.value))}
        >
          {stages
            .filter((s) => s.key !== "closed")
            .map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
        </Select>
      </Field>
      <Result state={a.state} />
    </div>
  );
}

export function AssignForm({
  matterId,
  responsible,
  assigned,
  staff,
}: {
  matterId: string;
  responsible: string | null;
  assigned: string[];
  staff: { id: string; name: string; role: string }[];
}) {
  const a = useAction();
  const [lead, setLead] = useState(responsible ?? "");
  const [team, setTeam] = useState<string[]>(assigned);
  return (
    <div className="space-y-3">
      <Field id="responsible" label="Responsible attorney">
        <Select id="responsible" value={lead} onChange={(e) => setLead(e.target.value)}>
          <option value="">Choose…</option>
          {staff
            .filter((s) => s.role !== "paralegal")
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </Select>
      </Field>
      <fieldset>
        <legend className="mb-1 text-[13px] font-medium">Also working on it</legend>
        {staff
          .filter((s) => s.id !== lead)
          .map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={team.includes(s.id)}
                onChange={(e) =>
                  setTeam(e.target.checked ? [...team, s.id] : team.filter((t) => t !== s.id))
                }
              />
              {s.name}
            </label>
          ))}
      </fieldset>
      <Button
        size="sm"
        variant="secondary"
        disabled={a.pending || !lead}
        onClick={() => a.go(() => assignAction(matterId, lead, team))}
      >
        Save assignment
      </Button>
      <Result state={a.state} />
    </div>
  );
}

export function NoteForm({ matterId }: { matterId: string }) {
  const a = useAction();
  const [body, setBody] = useState("");
  return (
    <div>
      <Field
        id="note"
        label="Add a note"
        hint="Identifiers such as SSNs and account numbers are masked to the last 4 when saved."
      >
        <Textarea id="note" value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <Button
        className="mt-2"
        size="sm"
        disabled={a.pending || !body.trim()}
        onClick={() =>
          a.go(async () => {
            const r = await addNoteAction(matterId, body);
            if (r.status === "success") setBody("");
            return r;
          })
        }
      >
        Save note
      </Button>
      <Result state={a.state} />
    </div>
  );
}

export function TaskForm({
  matterId,
  staff,
}: {
  matterId: string;
  staff: { id: string; name: string }[];
}) {
  const a = useAction();
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [assigneeId, setAssignee] = useState("");
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_160px_180px_auto] sm:items-end">
      <Field id="task-title" label="New task">
        <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field id="task-due" label="Due" optional>
        <Input id="task-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
      </Field>
      <Field id="task-assignee" label="Assignee" optional>
        <Select id="task-assignee" value={assigneeId} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Unassigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button
        size="sm"
        disabled={a.pending || title.trim().length < 2}
        onClick={() =>
          a.go(async () => {
            const r = await createTaskAction(matterId, { title, dueOn, assigneeId });
            if (r.status === "success") setTitle("");
            return r;
          })
        }
      >
        Add
      </Button>
      <div className="sm:col-span-4">
        <Result state={a.state} />
      </div>
    </div>
  );
}

export function TaskToggle({
  matterId,
  taskId,
  done,
}: {
  matterId: string;
  taskId: string;
  done: boolean;
}) {
  const a = useAction();
  return (
    <input
      type="checkbox"
      aria-label={done ? "Mark not done" : "Mark done"}
      checked={done}
      disabled={a.pending}
      onChange={() => a.go(() => setTaskStatusAction(matterId, taskId, done ? "open" : "done"))}
    />
  );
}

const ROLES = [
  ["adverse", "Adverse party"],
  ["related", "Related party"],
  ["spouse", "Spouse"],
  ["co_owner", "Co-owner"],
  ["decedent", "Decedent"],
  ["executor", "Executor"],
  ["beneficiary", "Beneficiary"],
] as const;

export function PartyForm({ matterId }: { matterId: string }) {
  const a = useAction();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("person");
  const [role, setRole] = useState("adverse");
  return (
    <div className="space-y-2">
      <Field id="party-name" label="Add a party">
        <Input id="party-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="person">Person</option>
          <option value="organization">Business</option>
        </Select>
        <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={a.pending || name.trim().length < 2}
        onClick={() =>
          a.go(async () => {
            const r = await addPartyAction(matterId, { name, kind, role });
            if (r.status === "success") setName("");
            return r;
          })
        }
      >
        Add party
      </Button>
      <Result state={a.state} />
    </div>
  );
}

export function RemoveParty({
  matterId,
  partyId,
  name,
}: {
  matterId: string;
  partyId: string;
  name: string;
}) {
  const a = useAction();
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`Remove ${name}`}
      disabled={a.pending}
      onClick={() => a.go(() => removePartyAction(matterId, partyId))}
    >
      Remove
    </Button>
  );
}

export function CloseMatter({ matterId }: { matterId: string }) {
  const a = useAction();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open) {
    return (
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Close matter
      </Button>
    );
  }
  return (
    <div>
      <Field
        id="close-note"
        label="Why the matter is closing"
        hint="Sets the retention date and drafts the closing letter (B10) for approval."
      >
        <Textarea id="close-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          variant="danger"
          disabled={a.pending}
          onClick={() => a.go(() => closeMatterAction(matterId, note))}
        >
          Close matter
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <Result state={a.state} />
    </div>
  );
}

/** The setup link is a credential: shown once, sent by the person who copied it. */
export function PortalLink({ matterId, hasAccess }: { matterId: string; hasAccess: boolean }) {
  const a = useAction();
  const data =
    a.state?.status === "success"
      ? (a.state.data as { portal: { setupUrl?: string; skipped?: string } })
      : null;
  return (
    <div className="space-y-2">
      {data?.portal.setupUrl ? (
        <>
          <CopyField label="One-time setup link (shown once)" value={data.portal.setupUrl} />
          <p className="text-[12.5px] text-muted">
            Send it to the client yourself. It expires and works once.
          </p>
        </>
      ) : data?.portal.skipped ? (
        <Notice tone="warning">Portal access not set up: {data.portal.skipped}.</Notice>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          disabled={a.pending}
          onClick={() => a.go(() => reissuePortalLinkAction(matterId))}
        >
          {hasAccess ? "New setup link" : "Set up portal access"}
        </Button>
      )}
      {a.state?.status === "error" ? <Result state={a.state} /> : null}
    </div>
  );
}

export function UploadForm({
  matterId,
  checklist,
}: {
  matterId: string;
  checklist: { id: string; label: string }[];
}) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [item, setItem] = useState("");
  const [msg, setMsg] = useState<{ tone: "good" | "critical"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function upload() {
    const file = ref.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const body = new FormData();
    body.set("file", file);
    if (item) body.set("checklistItemId", item);
    const res = await fetch(`/api/matters/${matterId}/documents`, { method: "POST", body });
    const json = (await res.json().catch(() => ({}))) as { error?: string; duplicate?: boolean };
    setBusy(false);
    if (!res.ok) setMsg({ tone: "critical", text: json.error ?? "The upload failed." });
    else {
      setMsg({
        tone: "good",
        text: json.duplicate
          ? "This file is already on the matter."
          : "Uploaded. It is read and classified in the background.",
      });
      if (ref.current) ref.current.value = "";
      router.refresh();
    }
  }
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_220px_auto] sm:items-end">
        <Field
          id="upload-file"
          label="Upload a document"
          hint="PDF, JPEG, PNG or TIFF, up to 25 MB."
        >
          <input
            id="upload-file"
            ref={ref}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
            className="text-[13px]"
          />
        </Field>
        <Field id="upload-item" label="For checklist item" optional>
          <Select id="upload-item" value={item} onChange={(e) => setItem(e.target.value)}>
            <option value="">Classify automatically</option>
            {checklist.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button size="sm" disabled={busy} onClick={upload}>
          {busy ? "Uploading…" : "Upload"}
        </Button>
      </div>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </div>
  );
}

export function DocTypeSelect({
  matterId,
  documentId,
  docType,
  types,
}: {
  matterId: string;
  documentId: string;
  docType: string;
  types: [string, string][];
}) {
  const a = useAction();
  return (
    <>
      <Select
        aria-label="Document type"
        className="h-8 text-[12.5px]"
        defaultValue={docType}
        disabled={a.pending}
        onChange={(e) => a.go(() => setDocumentTypeAction(matterId, documentId, e.target.value))}
      >
        {types.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
      {a.state?.status === "error" ? <Result state={a.state} /> : null}
    </>
  );
}

export function ShareToggle({
  matterId,
  documentId,
  shared,
}: {
  matterId: string;
  documentId: string;
  shared: boolean;
}) {
  const a = useAction();
  return (
    <label className="flex items-center gap-1.5 text-[12.5px]">
      <input
        type="checkbox"
        checked={shared}
        disabled={a.pending}
        onChange={() => a.go(() => shareDocumentAction(matterId, documentId, !shared))}
      />
      In portal
    </label>
  );
}

type Fields = {
  agency: string | null;
  noticeType: string | null;
  taxYears: string[];
  amountDue: string | null;
  noticeDate: string | null;
  respondBy: string | null;
};

export function ExtractionForm({
  matterId,
  extractionId,
  fields,
  conflicts,
}: {
  matterId: string;
  extractionId: string;
  fields: Fields;
  conflicts: string[];
}) {
  const a = useAction();
  const [f, setF] = useState(fields);
  const set = (k: keyof Fields, v: string) =>
    setF({ ...f, [k]: k === "taxYears" ? v.split(/[,\s]+/).filter(Boolean) : v.trim() || null });
  const row = (k: keyof Fields, label: string, type = "text"): ReactNode => (
    <Field
      id={`${extractionId}-${k}`}
      label={`${label}${conflicts.includes(k) ? " (check: the model read this differently)" : ""}`}
    >
      <Input
        id={`${extractionId}-${k}`}
        type={type}
        value={k === "taxYears" ? f.taxYears.join(", ") : ((f[k] as string | null) ?? "")}
        onChange={(e) => set(k, e.target.value)}
      />
    </Field>
  );
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        {row("agency", "Agency")}
        {row("noticeType", "Notice")}
        {row("taxYears", "Tax years")}
        {row("amountDue", "Amount due ($)")}
        {row("noticeDate", "Notice date", "date")}
        {row("respondBy", "Respond by", "date")}
      </div>
      <Button
        size="sm"
        disabled={a.pending}
        onClick={() => a.go(() => confirmExtractionAction(matterId, extractionId, f))}
      >
        Confirm fields
      </Button>
      <Result state={a.state} />
    </div>
  );
}

export function RefreshSummary({ matterId }: { matterId: string }) {
  const a = useAction();
  return (
    <div>
      <Button
        size="sm"
        variant="secondary"
        disabled={a.pending}
        onClick={() => a.go(() => refreshSummaryAction(matterId))}
      >
        Refresh summary
      </Button>
      <Result state={a.state} />
    </div>
  );
}

export function RequestDraft({
  matterId,
  kinds,
}: {
  matterId: string;
  kinds: { key: string; label: string }[];
}) {
  const a = useAction();
  const [kind, setKind] = useState(kinds[0]?.key ?? "");
  if (kinds.length === 0) return null;
  return (
    <div className="space-y-2">
      <Select aria-label="Draft type" value={kind} onChange={(e) => setKind(e.target.value)}>
        {kinds.map((k) => (
          <option key={k.key} value={k.key}>
            {k.label}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        variant="secondary"
        disabled={a.pending || !kind}
        onClick={() => a.go(() => requestDraftAction(matterId, kind))}
      >
        Prepare draft
      </Button>
      <Result state={a.state} />
    </div>
  );
}

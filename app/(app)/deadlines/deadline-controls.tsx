"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-field";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import type { ActionState } from "@/lib/commands/action-state";
import {
  acknowledgeAction,
  addDeadlineAction,
  addFederalHolidaysAction,
  addHolidayAction,
  addTollingAction,
  assignDeadlineAction,
  createFeedAction,
  endPaymentPlanAction,
  moveDeadlineAction,
  recordEventAction,
  removeEventAction,
  removeHolidayAction,
  removeTollingAction,
  revokeFeedAction,
  revokeRuleAction,
  setDeadlineStatusAction,
  setPaymentPlanAction,
  setRuleActiveAction,
  syncRulesAction,
  updateRuleAction,
  verifyRuleAction,
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

type Staff = { id: string; name: string };

// --------------------------------------------------------- matter page --

export type EventDefView = {
  key: string;
  label: string;
  asksNoticeType: boolean;
  flags: { key: string; label: string }[];
};

export function EventForm({ matterId, defs }: { matterId: string; defs: EventDefView[] }) {
  const a = useAction();
  const [kind, setKind] = useState(defs[0]?.key ?? "");
  const [date, setDate] = useState("");
  const [notice, setNotice] = useState("");
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const def = defs.find((d) => d.key === kind);
  if (defs.length === 0) return null;
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px_160px_auto] sm:items-end">
        <Field id="event-kind" label="Trigger event">
          <Select id="event-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {defs.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="event-date" label="Date">
          <Input
            id="event-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        {def?.asksNoticeType ? (
          <Field id="event-notice" label="Notice or letter" optional>
            <Input
              id="event-notice"
              placeholder="LT11"
              value={notice}
              onChange={(e) => setNotice(e.target.value)}
            />
          </Field>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          disabled={a.pending || !date || !kind}
          onClick={() =>
            a.go(async () => {
              const r = await recordEventAction(matterId, {
                kind,
                occurredOn: date,
                noticeType: notice.trim() || null,
                flags,
              });
              if (r.status === "success") {
                setDate("");
                setNotice("");
                setFlags({});
              }
              return r;
            })
          }
        >
          Record
        </Button>
      </div>
      {def?.flags.length ? (
        <div className="mt-2 space-y-1">
          {def.flags.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={flags[f.key] ?? false}
                onChange={(e) => setFlags({ ...flags, [f.key]: e.target.checked })}
              />
              {f.label}
            </label>
          ))}
        </div>
      ) : null}
      <Result state={a.state} />
    </div>
  );
}

export function RemoveEvent({ matterId, eventId }: { matterId: string; eventId: string }) {
  const a = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Remove
      </Button>
    );
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input
        aria-label="Why remove it"
        placeholder="Why remove it"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-48"
      />
      <Button
        size="sm"
        variant="danger"
        disabled={a.pending || reason.trim().length < 3}
        onClick={() => a.go(() => removeEventAction(matterId, eventId, reason))}
      >
        Remove event
      </Button>
      <Result state={a.state} />
    </div>
  );
}

export function AddDeadlineForm({ matterId, staff }: { matterId: string; staff: Staff[] }) {
  const a = useAction();
  const [label, setLabel] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [severity, setSeverity] = useState("high");
  const [ownerId, setOwner] = useState("");
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-[1fr_150px_120px_160px_auto] sm:items-end">
        <Field id="dl-label" label="Deadline">
          <Input
            id="dl-label"
            value={label}
            placeholder="No client names: labels appear in calendars"
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field id="dl-due" label="Due">
          <Input id="dl-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </Field>
        <Field id="dl-sev" label="Severity">
          <Select id="dl-sev" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
          </Select>
        </Field>
        <Field id="dl-owner" label="Owner" optional>
          <Select id="dl-owner" value={ownerId} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Responsible attorney</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          size="sm"
          disabled={a.pending || label.trim().length < 3 || !dueOn}
          onClick={() =>
            a.go(async () => {
              const r = await addDeadlineAction(matterId, {
                label,
                dueOn,
                severity,
                ownerId: ownerId || null,
              });
              if (r.status === "success") {
                setLabel("");
                setDueOn("");
              }
              return r;
            })
          }
        >
          Add
        </Button>
      </div>
      <Result state={a.state} />
    </div>
  );
}

export function DeadlineRowActions({
  matterId,
  deadline,
  staff,
}: {
  matterId: string;
  deadline: {
    id: string;
    origin: string;
    status: string;
    ownerId: string | null;
    dueOn: string;
    unacknowledged: number;
  };
  staff: Staff[];
}) {
  const a = useAction();
  const [moving, setMoving] = useState(false);
  const [dueOn, setDueOn] = useState(deadline.dueOn);
  const [reason, setReason] = useState("");
  const open = deadline.status === "open";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {deadline.unacknowledged > 0 ? (
          <Button
            size="sm"
            disabled={a.pending}
            onClick={() => a.go(() => acknowledgeAction(matterId, deadline.id))}
          >
            Acknowledge alert
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={a.pending}
          onClick={() =>
            a.go(() => setDeadlineStatusAction(matterId, deadline.id, open ? "done" : "open", null))
          }
        >
          {open ? "Mark done" : "Reopen"}
        </Button>
        {open && deadline.origin !== "rule" ? (
          <Button size="sm" variant="ghost" onClick={() => setMoving(!moving)}>
            Change date
          </Button>
        ) : null}
        {open ? (
          <Select
            aria-label="Owner"
            className="h-8 w-40 text-[12.5px]"
            defaultValue={deadline.ownerId ?? ""}
            disabled={a.pending}
            onChange={(e) =>
              a.go(() => assignDeadlineAction(matterId, deadline.id, e.target.value || null))
            }
          >
            <option value="">No owner</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      {moving ? (
        <div className="flex flex-wrap items-end gap-2">
          <Input
            type="date"
            aria-label="New date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            className="w-40"
          />
          <Input
            aria-label="Reason"
            placeholder="Reason (for the audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-56"
          />
          <Button
            size="sm"
            disabled={a.pending || reason.trim().length < 3}
            onClick={() => a.go(() => moveDeadlineAction(matterId, deadline.id, dueOn, reason))}
          >
            Save date
          </Button>
        </div>
      ) : null}
      <Result state={a.state} />
    </div>
  );
}

export function TollingForm({ matterId, deadlineId }: { matterId: string; deadlineId: string }) {
  const a = useAction();
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [fromOn, setFrom] = useState("");
  const [toOn, setTo] = useState("");
  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-[90px_1fr_140px_140px_auto] sm:items-end">
        <Field id={`toll-days-${deadlineId}`} label="Days">
          <Input
            id={`toll-days-${deadlineId}`}
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Field>
        <Field id={`toll-reason-${deadlineId}`} label="Tolling event">
          <Input
            id={`toll-reason-${deadlineId}`}
            placeholder="Bankruptcy stay, offer pending..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Field id={`toll-from-${deadlineId}`} label="From" optional>
          <Input
            id={`toll-from-${deadlineId}`}
            type="date"
            value={fromOn}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field id={`toll-to-${deadlineId}`} label="To" optional>
          <Input
            id={`toll-to-${deadlineId}`}
            type="date"
            value={toOn}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Button
          size="sm"
          variant="secondary"
          disabled={a.pending || !/^\d+$/.test(days) || reason.trim().length < 3}
          onClick={() =>
            a.go(() =>
              addTollingAction(matterId, {
                deadlineId,
                days: Number(days),
                reason,
                fromOn: fromOn || null,
                toOn: toOn || null,
              }),
            )
          }
        >
          Add tolling
        </Button>
      </div>
      <p className="mt-1 text-[12px] text-muted">
        Enter the number of days the attorney has determined the period is extended. LexDesk adds
        them; it does not decide what tolls the statute.
      </p>
      <Result state={a.state} />
    </div>
  );
}

export function RemoveTolling({ matterId, tollingId }: { matterId: string; tollingId: string }) {
  const a = useAction();
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={a.pending}
        onClick={() => a.go(() => removeTollingAction(matterId, tollingId))}
      >
        Remove
      </Button>
      <Result state={a.state} />
    </>
  );
}

export function PaymentPlanForm({
  matterId,
  plan,
}: {
  matterId: string;
  plan: { firstDueOn: string; dayOfMonth: number; amount: string | null; status: string } | null;
}) {
  const a = useAction();
  const [firstDueOn, setFirst] = useState(plan?.firstDueOn ?? "");
  const [day, setDay] = useState(String(plan?.dayOfMonth ?? ""));
  const [amount, setAmount] = useState(plan?.amount ?? "");
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[150px_110px_130px_auto] sm:items-end">
        <Field id="pp-first" label="First payment">
          <Input
            id="pp-first"
            type="date"
            value={firstDueOn}
            onChange={(e) => setFirst(e.target.value)}
          />
        </Field>
        <Field id="pp-day" label="Day of month">
          <Input
            id="pp-day"
            inputMode="numeric"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </Field>
        <Field id="pp-amount" label="Monthly amount" optional>
          <Input
            id="pp-amount"
            placeholder="$450.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Button
          size="sm"
          variant="secondary"
          disabled={a.pending || !firstDueOn || !/^\d{1,2}$/.test(day)}
          onClick={() =>
            a.go(() =>
              setPaymentPlanAction(matterId, {
                label: "Installment agreement",
                firstDueOn,
                dayOfMonth: Number(day),
                amount: amount.trim() || null,
              }),
            )
          }
        >
          {plan ? "Update plan" : "Track payments"}
        </Button>
      </div>
      {plan?.status === "active" ? (
        <div className="flex flex-wrap items-end gap-2">
          <Input
            aria-label="Why the plan ended"
            placeholder="Why the plan ended"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-56"
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={a.pending || reason.trim().length < 3}
            onClick={() => a.go(() => endPaymentPlanAction(matterId, reason))}
          >
            End plan
          </Button>
        </div>
      ) : null}
      <Result state={a.state} />
    </div>
  );
}

// ------------------------------------------------------- rules settings --

export function SyncRulesButton() {
  const a = useAction();
  return (
    <div>
      <Button
        size="sm"
        variant="secondary"
        disabled={a.pending}
        onClick={() => a.go(syncRulesAction)}
      >
        Load new product rules
      </Button>
      <Result state={a.state} />
    </div>
  );
}

type RuleView = {
  id: string;
  version: number;
  label: string;
  description: string;
  offset:
    | { unit: "days" | "months" | "years"; amount: number }
    | { unit: "annual"; month: number; day: number };
  rollForward: "next_business_day" | "none";
  severity: "critical" | "high" | "normal";
  noticeTypes: string[];
  preferPrinted: boolean;
  usesNotices: boolean;
};

export function RuleEditForm({ rule }: { rule: RuleView }) {
  const a = useAction();
  const [label, setLabel] = useState(rule.label);
  const [description, setDescription] = useState(rule.description);
  const [unit, setUnit] = useState(rule.offset.unit);
  const [amount, setAmount] = useState(
    rule.offset.unit === "annual" ? "" : String(rule.offset.amount),
  );
  const [month, setMonth] = useState(
    rule.offset.unit === "annual" ? String(rule.offset.month) : "5",
  );
  const [day, setDay] = useState(rule.offset.unit === "annual" ? String(rule.offset.day) : "15");
  const [roll, setRoll] = useState(rule.rollForward);
  const [severity, setSeverity] = useState(rule.severity);
  const [notices, setNotices] = useState(rule.noticeTypes.join(", "));
  const [printed, setPrinted] = useState(rule.preferPrinted);
  return (
    <div className="space-y-3">
      <Field id="r-label" label="Name">
        <Input id="r-label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field id="r-desc" label="What the deadline is">
        <Input id="r-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="r-unit" label="Offset">
          <Select
            id="r-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as RuleView["offset"]["unit"])}
          >
            <option value="days">Days after</option>
            <option value="months">Months after</option>
            <option value="years">Years after</option>
            <option value="annual">Each year on</option>
          </Select>
        </Field>
        {unit === "annual" ? (
          <>
            <Field id="r-month" label="Month (1-12)">
              <Input
                id="r-month"
                inputMode="numeric"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </Field>
            <Field id="r-day" label="Day">
              <Input
                id="r-day"
                inputMode="numeric"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </Field>
          </>
        ) : (
          <Field id="r-amount" label="Number">
            <Input
              id="r-amount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="r-roll" label="Weekends and holidays">
          <Select
            id="r-roll"
            value={roll}
            onChange={(e) => setRoll(e.target.value as RuleView["rollForward"])}
          >
            <option value="next_business_day">Move to the next business day</option>
            <option value="none">Do not move</option>
          </Select>
        </Field>
        <Field id="r-sev" label="Severity">
          <Select
            id="r-sev"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as RuleView["severity"])}
          >
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
          </Select>
        </Field>
      </div>
      {rule.usesNotices ? (
        <>
          <Field
            id="r-notices"
            label="Notice or letter numbers (comma separated)"
            hint="The rule applies only to these notices."
          >
            <Input id="r-notices" value={notices} onChange={(e) => setNotices(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={printed}
              onChange={(e) => setPrinted(e.target.checked)}
            />
            The notice prints its own date; use it and keep this rule as a cross-check
          </label>
        </>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        disabled={a.pending}
        onClick={() =>
          a.go(() =>
            updateRuleAction({
              ruleId: rule.id,
              expectedVersion: rule.version,
              label,
              description,
              offset:
                unit === "annual"
                  ? { unit, month: Number(month), day: Number(day) }
                  : { unit, amount: Number(amount) },
              rollForward: roll,
              severity,
              noticeTypes: notices
                .split(",")
                .map((n) => n.trim())
                .filter(Boolean),
              preferPrinted: printed,
            }),
          )
        }
      >
        Save changes
      </Button>
      <p className="text-[12px] text-muted">
        Saving clears the verification. Verify the rule again before it computes.
      </p>
      <Result state={a.state} />
    </div>
  );
}

export function VerifyForm({
  ruleId,
  hash,
  citation,
}: {
  ruleId: string;
  hash: string;
  citation: string | null;
}) {
  const a = useAction();
  const [cite, setCite] = useState(citation ?? "");
  const [attest, setAttest] = useState(false);
  return (
    <div className="space-y-3">
      <Field
        id="v-cite"
        label="Source checked"
        hint="The statute, rule, form instructions or publication, with section."
      >
        <Input id="v-cite" value={cite} onChange={(e) => setCite(e.target.value)} />
      </Field>
      <label className="flex items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          className="mt-1"
          checked={attest}
          onChange={(e) => setAttest(e.target.checked)}
        />
        I checked this rule, as shown on this page, against the source above. It applies to the
        firm&apos;s matters as written.
      </label>
      <Button
        size="sm"
        disabled={a.pending || !attest || cite.trim().length < 5}
        onClick={() =>
          a.go(() => verifyRuleAction({ ruleId, expectedHash: hash, citation: cite, attest: true }))
        }
      >
        Verify rule
      </Button>
      <Result state={a.state} />
    </div>
  );
}

export function RevokeForm({ ruleId }: { ruleId: string }) {
  const a = useAction();
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input
        aria-label="Reason"
        placeholder="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-64"
      />
      <Button
        size="sm"
        variant="danger"
        disabled={a.pending || reason.trim().length < 3}
        onClick={() => a.go(() => revokeRuleAction(ruleId, reason))}
      >
        Remove verification
      </Button>
      <Result state={a.state} />
    </div>
  );
}

export function ActiveToggle({ ruleId, active }: { ruleId: string; active: boolean }) {
  const a = useAction();
  return (
    <div>
      <Button
        size="sm"
        variant="ghost"
        disabled={a.pending}
        onClick={() => a.go(() => setRuleActiveAction(ruleId, !active))}
      >
        {active ? "Switch off" : "Switch on"}
      </Button>
      <Result state={a.state} />
    </div>
  );
}

export function HolidayForms({ year }: { year: number }) {
  const a = useAction();
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[150px_1fr_auto] sm:items-end">
        <Field id="h-date" label="Date">
          <Input id="h-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="h-label" label="Holiday">
          <Input id="h-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Button
          size="sm"
          variant="secondary"
          disabled={a.pending || !date || label.trim().length < 2}
          onClick={() => a.go(() => addHolidayAction(date, label))}
        >
          Add
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {[year, year + 1].map((y) => (
          <Button
            key={y}
            size="sm"
            variant="ghost"
            disabled={a.pending}
            onClick={() => a.go(() => addFederalHolidaysAction(y))}
          >
            Add US federal holidays for {y}
          </Button>
        ))}
      </div>
      <Result state={a.state} />
    </div>
  );
}

export function RemoveHoliday({ date }: { date: string }) {
  const a = useAction();
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={a.pending}
        onClick={() => a.go(() => removeHolidayAction(date))}
      >
        Remove
      </Button>
      <Result state={a.state} />
    </>
  );
}

// ------------------------------------------------------------ calendar --

export function CalendarFeedControls({ hasFeed, base }: { hasFeed: boolean; base: string }) {
  const a = useAction();
  const token =
    a.state?.status === "success" &&
    a.state.data &&
    typeof a.state.data === "object" &&
    "token" in a.state.data
      ? String((a.state.data as { token: string }).token)
      : null;
  return (
    <div className="space-y-3">
      {token ? (
        <>
          <CopyField label="Calendar link (shown once)" value={`${base}/api/calendar/${token}`} />
          <p className="text-[12.5px] text-muted">
            In Google Calendar choose Other calendars, From URL; in Outlook choose Add calendar,
            Subscribe from web. Anyone with this link can see your deadline dates and matter
            numbers, so do not share it.
          </p>
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={a.pending} onClick={() => a.go(createFeedAction)}>
          {hasFeed ? "Make a new link (turns off the old one)" : "Create calendar link"}
        </Button>
        {hasFeed ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={a.pending}
            onClick={() => a.go(revokeFeedAction)}
          >
            Turn off
          </Button>
        ) : null}
      </div>
      {a.state?.status === "error" ? <Result state={a.state} /> : null}
      {a.state?.status === "success" && !token ? <Result state={a.state} /> : null}
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, fieldControlProps } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { IDLE_STATE } from "@/lib/commands/action-state";
import { updateFirmSettingsAction } from "./actions";

type Initial = {
  legalName: string;
  displayName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  website: string;
  bookingUrl: string;
  intakeFormUrl: string;
  practiceAreas: string[];
  aiDisclosureText: string;
  attorneysSeeFinancials: boolean;
  ipAllowlist: string;
};

const PRACTICE_AREAS = [
  {
    value: "tax",
    label: "Tax",
    hint: "IRS and Texas Comptroller notices, collections, unfiled returns",
  },
  {
    value: "business",
    label: "Business",
    hint: "Formation, contracts, disputes, sale or purchase, ongoing counsel",
  },
  {
    value: "estate",
    label: "Estate and probate",
    hint: "Planning, trusts, probate administration",
  },
] as const;

export function FirmSettingsForm({
  initial,
  editable,
  currentIp,
}: {
  initial: Initial;
  editable: boolean;
  currentIp: string | null;
}) {
  const [state, action, pending] = useActionState(updateFirmSettingsAction, IDLE_STATE);
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const text = (
    id: keyof Initial,
    label: string,
    opts: { optional?: boolean; hint?: string; autoComplete?: string; className?: string } = {},
  ) => (
    <Field
      id={id}
      label={label}
      optional={opts.optional}
      hint={opts.hint}
      errors={errors?.[id]}
      className={opts.className}
    >
      <Input
        {...fieldControlProps(id, errors?.[id], Boolean(opts.hint))}
        defaultValue={initial[id] as string}
        disabled={!editable}
        autoComplete={opts.autoComplete ?? "off"}
      />
    </Field>
  );

  return (
    <form action={action} className="space-y-6">
      {state.status === "success" ? <Notice tone="good">{state.message}</Notice> : null}
      {state.status === "error" ? <Notice tone="critical">{state.message}</Notice> : null}

      <Panel>
        <PanelHeader
          title="Profile"
          description="Used on letters, the client portal and the monthly report."
        />
        <PanelBody className="grid gap-4 md:grid-cols-2">
          {text("legalName", "Legal name", {
            hint: "As registered with the State Bar, e.g. “Example Law PLLC”.",
          })}
          {text("displayName", "Display name", { hint: "Short name shown in the app." })}
          {text("addressLine1", "Street address", {
            optional: true,
            autoComplete: "address-line1",
            className: "md:col-span-2",
          })}
          {text("addressLine2", "Suite or floor", {
            optional: true,
            autoComplete: "address-line2",
            className: "md:col-span-2",
          })}
          <div className="grid grid-cols-[minmax(0,1fr)_80px_120px] gap-3 md:col-span-2">
            {text("city", "City", { optional: true, autoComplete: "address-level2" })}
            {text("state", "State", { optional: true, autoComplete: "address-level1" })}
            {text("postalCode", "ZIP", { optional: true, autoComplete: "postal-code" })}
          </div>
          {text("phone", "Main phone", { optional: true, autoComplete: "tel" })}
          {text("website", "Website", { optional: true, autoComplete: "url" })}
          {text("bookingUrl", "Consult booking page", {
            optional: true,
            hint: "The GoHighLevel calendar link sent in missed-call and enquiry replies.",
          })}
          {text("intakeFormUrl", "Pre-consult intake form", {
            optional: true,
            hint: "Sent with consult confirmations.",
          })}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title="Practice areas"
          description="Controls intake questions, matter types and deadline rules."
        />
        <PanelBody>
          <fieldset
            disabled={!editable}
            aria-describedby={errors?.practiceAreas ? "practiceAreas-error" : undefined}
          >
            <legend className="sr-only">Practice areas</legend>
            <div className="grid gap-3 md:grid-cols-3">
              {PRACTICE_AREAS.map((p) => (
                <label
                  key={p.value}
                  className="flex cursor-pointer gap-3 rounded-md border border-line px-3.5 py-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft/50"
                >
                  <input
                    type="checkbox"
                    name="practiceAreas"
                    value={p.value}
                    defaultChecked={initial.practiceAreas.includes(p.value)}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span>
                    <span className="block text-[13.5px] font-medium">{p.label}</span>
                    <span className="block text-[12px] text-muted">{p.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {errors?.practiceAreas ? (
              <p id="practiceAreas-error" className="mt-2 text-[12.5px] text-critical">
                {errors.practiceAreas.join(" ")}
              </p>
            ) : null}
          </fieldset>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title="AI disclosure"
          description="Shown in web chat, in the first SMS to a new contact, and in the client portal. The supervising attorney must approve this text."
        />
        <PanelBody>
          <Field
            id="aiDisclosureText"
            label="Disclosure text"
            hint="Must say that an AI assistant is in use, that it gives no legal advice, and that no attorney-client relationship exists until an engagement letter is signed."
            errors={errors?.aiDisclosureText}
          >
            <Textarea
              {...fieldControlProps("aiDisclosureText", errors?.aiDisclosureText, true)}
              defaultValue={initial.aiDisclosureText}
              disabled={!editable}
              rows={4}
            />
          </Field>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Access" />
        <PanelBody className="space-y-5">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="attorneysSeeFinancials"
              defaultChecked={initial.attorneysSeeFinancials}
              disabled={!editable}
              className="mt-1 accent-[var(--accent)]"
            />
            <span>
              <span className="block text-[13.5px] font-medium">
                Attorneys can see firm financials
              </span>
              <span className="block text-[12.5px] text-muted">
                Revenue, receivables and fee dashboards. Owner attorneys and billing staff always
                can.
              </span>
            </span>
          </label>
          <Field
            id="ipAllowlist"
            label="Allowed networks"
            optional
            hint={`One IP address or CIDR range per line. Leave empty to allow sign-in from anywhere. Your current address is ${currentIp ?? "unknown"}.`}
            errors={errors?.ipAllowlist}
          >
            <Textarea
              {...fieldControlProps("ipAllowlist", errors?.ipAllowlist, true)}
              defaultValue={initial.ipAllowlist}
              disabled={!editable}
              rows={3}
              className="font-mono text-[12.5px]"
              placeholder={"203.0.113.10\n198.51.100.0/24"}
            />
          </Field>
        </PanelBody>
      </Panel>

      {editable ? (
        <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 border-t border-line bg-bg/90 px-1 py-3 backdrop-blur">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

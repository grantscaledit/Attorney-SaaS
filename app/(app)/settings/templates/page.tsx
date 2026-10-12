import type { Metadata } from "next";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/panel";
import { can } from "@/lib/auth/can";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { loadFirmSettings } from "@/lib/firm.config";
import {
  formatAppointmentTime,
  renderTemplate,
  TEMPLATE_VARIABLES,
} from "@/lib/messaging/templates";
import { formatDateTime } from "@/lib/ui/format";
import { listTemplates } from "@/modules/messaging/queries";
import { listUsers } from "@/modules/users/queries";
import { TemplateCard, type TemplateCardData } from "./template-card";

export const metadata: Metadata = { title: "Message templates" };

/** A consult two days from now, as the preview's sample appointment time. */
function sampleAppointmentTime(timeZone: string): string {
  return formatAppointmentTime(new Date(Date.now() + 2 * 86_400_000), timeZone);
}

export default async function TemplatesPage() {
  const { user, policy } = await requirePermission("firm.settings.read");
  const editable = can(user, "firm.settings.update", { policy });
  const tz = env().FIRM_TIMEZONE;
  const [templates, firm, people] = await Promise.all([
    listTemplates(user),
    loadFirmSettings(),
    can(user, "users.read", { policy }) ? listUsers(user) : Promise.resolve([]),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name]));

  // Sample values so the firm reviews exactly what a person would receive.
  const sample = {
    firstName: "Jamie",
    firmName: firm.displayName,
    firmPhone: firm.phone ?? "[firm phone]",
    bookingUrl: firm.bookingUrl ?? "[booking link]",
    intakeFormUrl: firm.intakeFormUrl ?? "[intake form link]",
    appointmentTime: sampleAppointmentTime(tz),
  };
  const render = (text: string | null) => {
    if (!text) return null;
    const r = renderTemplate(text, sample);
    return r.ok ? r.text : text;
  };

  const cards: TemplateCardData[] = templates.map((t) => ({
    key: t.key,
    label: t.label,
    when: t.when,
    channel: t.channel,
    subject: t.currentSubject,
    body: t.currentBody,
    preview: render(t.currentBody) ?? "",
    previewSubject: render(t.currentSubject),
    approved: t.approvedAt !== null,
    approvedLabel: t.approvedAt
      ? `Approved ${formatDateTime(t.approvedAt, tz)}${t.approvedBy && names.get(t.approvedBy) ? ` by ${names.get(t.approvedBy)}` : ""}`
      : null,
    isDefault: t.isDefault,
  }));
  const pending = cards.filter((c) => !c.approved).length;

  return (
    <>
      <PageHeader
        title="Message templates"
        description="The only messages LexDesk sends without a person: missed-call text-backs, enquiry acknowledgements and consult confirmations and reminders. Each one sends only after the owner attorney approves its exact text."
      />
      {pending > 0 ? (
        <Notice
          tone="warning"
          className="mb-5"
          title={`${pending} of ${cards.length} templates not approved`}
        >
          Messages using an unapproved template are recorded but not sent.
        </Notice>
      ) : null}
      <Notice tone="info" className="mb-5" title="Placeholders">
        <ul className="mt-1 grid gap-x-6 gap-y-0.5 md:grid-cols-2">
          {Object.entries(TEMPLATE_VARIABLES).map(([k, v]) => (
            <li key={k}>
              <code className="font-mono text-[12px]">{`{{${k}}}`}</code> {v}
            </li>
          ))}
        </ul>
        <p className="mt-2">
          Add a fallback after a bar, as in{" "}
          <code className="font-mono text-[12px]">{"{{firstName|there}}"}</code>. A placeholder
          without a fallback must have a value, or the message is held back.
        </p>
      </Notice>
      <div className="grid gap-5 lg:grid-cols-2">
        {cards.map((c) => (
          <TemplateCard key={c.key} t={c} editable={editable} />
        ))}
      </div>
    </>
  );
}

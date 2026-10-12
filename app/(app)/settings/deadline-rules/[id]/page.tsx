import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { StatusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { DataRow, PageHeader, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/ui/format";
import { VERIFICATION_LABELS } from "@/modules/deadlines/engine";
import { deadlineRuleDetail } from "@/modules/deadlines/queries";
import { PRACTICE_AREA_LABELS } from "@/modules/intake/labels";
import { describeOffset, eventDef, SEVERITY_LABELS } from "@/practice";
import {
  ActiveToggle,
  RevokeForm,
  RuleEditForm,
  VerifyForm,
} from "../../../deadlines/deadline-controls";
import { VERIFICATION_TONE } from "../../../deadlines/tones";

export const metadata: Metadata = { title: "Deadline rule" };

export default async function DeadlineRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePermission("deadlines.read");
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await deadlineRuleDetail(user, id);
  if (!d) notFound();
  const r = d.row;
  const tz = env().FIRM_TIMEZONE;
  const trigger = eventDef(r.practiceArea, r.trigger)?.label ?? r.trigger;
  return (
    <>
      <PageHeader
        eyebrow={`${PRACTICE_AREA_LABELS[r.practiceArea]} · version ${r.version}`}
        title={r.label}
        description={r.description}
        actions={
          <Button variant="ghost" asChild>
            <Link href="/settings/deadline-rules">
              <ArrowLeft /> Deadline rules
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="What the rule does" />
            <PanelBody className="space-y-2">
              <DataRow label="Status">
                <StatusLabel tone={VERIFICATION_TONE[d.verification]}>
                  {VERIFICATION_LABELS[d.verification]}
                </StatusLabel>
              </DataRow>
              <DataRow label="Computes">
                {describeOffset(r.offset)} the {trigger.toLowerCase()}
              </DataRow>
              <DataRow label="Weekends and holidays">
                {r.rollForward === "next_business_day"
                  ? "Moved to the next business day"
                  : "Not moved"}
              </DataRow>
              <DataRow label="Severity">{SEVERITY_LABELS[r.severity]}</DataRow>
              <DataRow label="Matter types">{r.matterTypes.join(", ")}</DataRow>
              {r.noticeTypes.length ? (
                <DataRow label="Notices">{r.noticeTypes.join(", ")}</DataRow>
              ) : null}
              {r.condition ? (
                <DataRow label="Only when">
                  {r.condition.flag} is {r.condition.equals ? "yes" : "no"}
                </DataRow>
              ) : null}
              {r.preferPrinted ? (
                <DataRow label="Printed dates">
                  A date printed on the notice is used; this rule cross-checks it.
                </DataRow>
              ) : null}
              {r.recurring ? <DataRow label="Repeats">Every year (C3)</DataRow> : null}
              {r.allowsTolling ? (
                <DataRow label="Tolling">Staff can add tolling days (C5)</DataRow>
              ) : null}
              <DataRow label="Open deadlines from it">{d.openDeadlines}</DataRow>
              <DataRow label="Seed note">{r.seedNote ?? "–"}</DataRow>
              {r.citation ? <DataRow label="Source checked">{r.citation}</DataRow> : null}
              {r.verifiedAt ? (
                <DataRow label="Verified">
                  {d.verifier ?? "Unknown"}, {formatDateTime(r.verifiedAt, tz)}
                </DataRow>
              ) : null}
            </PanelBody>
          </Panel>
          {d.seedChanged && d.seed ? (
            <Notice tone="info" title="Differs from the product seed">
              The product seed is {describeOffset(d.seed.offset)} the trigger,{" "}
              {d.seed.rollForward === "next_business_day"
                ? "moved off weekends and holidays"
                : "not moved"}
              , severity {SEVERITY_LABELS[d.seed.severity].toLowerCase()}. The firm&apos;s copy
              above is what computes.
            </Notice>
          ) : null}
          {d.canVerify ? (
            <Panel>
              <PanelHeader title="Change the rule" description="Saving clears the verification." />
              <PanelBody>
                <RuleEditForm
                  rule={{
                    id: r.id,
                    version: r.version,
                    label: r.label,
                    description: r.description,
                    offset: r.offset,
                    rollForward: r.rollForward,
                    severity: r.severity,
                    noticeTypes: r.noticeTypes,
                    preferPrinted: r.preferPrinted,
                    usesNotices: eventDef(r.practiceArea, r.trigger)?.asksNoticeType ?? false,
                  }}
                />
              </PanelBody>
            </Panel>
          ) : null}
        </div>
        <div className="space-y-6">
          {d.canVerify ? (
            <Panel>
              <PanelHeader
                title={d.verification === "verified" ? "Verified" : "Verify"}
                description="Only the owner attorney verifies. The verification covers exactly the values on this page."
              />
              <PanelBody className="space-y-4">
                {d.verification !== "verified" && r.active ? (
                  <VerifyForm ruleId={r.id} hash={d.hash} citation={r.citation} />
                ) : null}
                {r.verifiedAt ? <RevokeForm ruleId={r.id} /> : null}
                <ActiveToggle ruleId={r.id} active={r.active} />
              </PanelBody>
            </Panel>
          ) : (
            <Notice tone="info">Only the owner attorney can change or verify rules.</Notice>
          )}
        </div>
      </div>
    </>
  );
}

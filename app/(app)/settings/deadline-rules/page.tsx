import type { Metadata, Route } from "next";
import Link from "next/link";
import { StatusLabel } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { EmptyState, PageHeader, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { requirePermission } from "@/lib/auth/session";
import { formatDate } from "@/modules/deadlines/date-math";
import { VERIFICATION_LABELS } from "@/modules/deadlines/engine";
import { deadlineRuleList } from "@/modules/deadlines/queries";
import { DEADLINE_NOTICE } from "@/modules/deadlines/rules";
import { PRACTICE_AREA_LABELS } from "@/modules/intake/labels";
import { firmToday } from "@/modules/matters/scope";
import { describeOffset, SEVERITY_LABELS } from "@/practice";
import { HolidayForms, RemoveHoliday, SyncRulesButton } from "../../deadlines/deadline-controls";
import { VERIFICATION_TONE } from "../../deadlines/tones";

export const metadata: Metadata = { title: "Deadline rules" };

export default async function DeadlineRulesPage() {
  const { user } = await requirePermission("deadlines.read");
  const l = await deadlineRuleList(user);
  const unverified = l.rules.filter((r) => r.verification !== "verified" && r.row.active).length;
  return (
    <>
      <PageHeader
        title="Deadline rules"
        description="The rules C1 uses to compute deadlines from trigger events. A rule computes nothing until the owner attorney verifies it against its source."
      />
      <div className="mb-5 space-y-3">
        <Notice tone="warning" title="Seed values are not legal advice">
          Every rule starts from the product&apos;s seed value (spec Section 8) and is not verified.
          Check each one against the statute, rule or publication before verifying it. Editing a
          rule clears its verification. {DEADLINE_NOTICE}
        </Notice>
        {unverified > 0 ? (
          <Notice
            tone="critical"
            title={`${unverified} rule${unverified === 1 ? "" : "s"} not verified`}
          >
            Trigger events that need these rules are recorded, but no date is computed from them.
          </Notice>
        ) : null}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHeader
            title="Rules"
            actions={l.canVerify && l.missingSeeds.length > 0 ? <SyncRulesButton /> : null}
          />
          {l.rules.length === 0 ? (
            <EmptyState title="No rules loaded">
              {l.canVerify ? <SyncRulesButton /> : "The owner attorney loads the product rules."}
            </EmptyState>
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Rule</Th>
                  <Th>Computes</Th>
                  <Th>Status</Th>
                </tr>
              </THead>
              <TBody>
                {l.rules.map(({ row: r, verification, verifier, seedChanged }) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link
                        href={`/settings/deadline-rules/${r.id}` as Route}
                        className="font-medium text-accent hover:underline"
                      >
                        {r.label}
                      </Link>
                      <span className="block text-[12px] text-muted">
                        {PRACTICE_AREA_LABELS[r.practiceArea]} · {SEVERITY_LABELS[r.severity]}
                        {r.noticeTypes.length ? ` · ${r.noticeTypes.join(", ")}` : ""}
                      </span>
                    </Td>
                    <Td className="text-[13px]">
                      {describeOffset(r.offset)} the {r.trigger.replace(/_/g, " ")}
                      {r.rollForward === "next_business_day" ? ", next business day" : ""}
                    </Td>
                    <Td>
                      <StatusLabel tone={VERIFICATION_TONE[verification]}>
                        {VERIFICATION_LABELS[verification]}
                      </StatusLabel>
                      {verification === "verified" && verifier ? (
                        <span className="block text-[12px] text-muted">
                          {verifier}, {r.verifiedAt ? r.verifiedAt.toISOString().slice(0, 10) : ""}
                        </span>
                      ) : null}
                      {seedChanged ? (
                        <span className="block text-[12px] text-muted">
                          Differs from the product seed
                        </span>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Holidays"
            description="Rules that move a date off weekends also skip these days. Which holidays an agency or court observes is for the attorney to confirm."
          />
          {l.canVerify ? (
            <PanelBody className="border-b border-line">
              <HolidayForms year={Number(firmToday().slice(0, 4))} />
            </PanelBody>
          ) : null}
          {l.holidays.length === 0 ? (
            <EmptyState title="No holidays entered">Only weekends move a date.</EmptyState>
          ) : (
            <ul className="divide-y divide-line text-[13px]">
              {l.holidays.map((h) => (
                <li key={h.date} className="flex items-center justify-between gap-2 px-5 py-1.5">
                  <span>
                    <span className="tabular-nums">{formatDate(h.date)}</span> · {h.label}
                  </span>
                  {l.canVerify ? <RemoveHoliday date={h.date} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

import type { DeadlineRuleRow } from "@/db/schema";
import type { RuleParams } from "@/practice/deadline-rules";
import { ruleHash, verificationOf, type RuleState, type Verification } from "./engine";

/** The verified parameters of a rule row. */
export function paramsOf(r: DeadlineRuleRow): RuleParams {
  return {
    label: r.label,
    description: r.description,
    trigger: r.trigger,
    offset: r.offset,
    rollForward: r.rollForward,
    severity: r.severity,
    matterTypes: r.matterTypes,
    noticeTypes: r.noticeTypes,
    condition: r.condition ?? null,
    preferPrinted: r.preferPrinted,
    recurring: r.recurring ?? null,
    allowsTolling: r.allowsTolling,
  };
}

export type RuleWithRow = RuleState & { row: DeadlineRuleRow };

export function stateOf(r: DeadlineRuleRow): RuleWithRow {
  return {
    ...paramsOf(r),
    id: r.id,
    key: r.key,
    active: r.active,
    verifiedBy: r.verifiedBy,
    verifiedAt: r.verifiedAt,
    verifiedHash: r.verifiedHash,
    row: r,
  };
}

export function verificationOfRow(r: DeadlineRuleRow): Verification {
  return verificationOf(stateOf(r));
}

export function hashOfRow(r: DeadlineRuleRow): string {
  return ruleHash(paramsOf(r));
}

/** Shown on every screen with a deadline (rule 7). */
export const DEADLINE_NOTICE =
  "Verify against the source document. The firm's calendar is the system of record.";

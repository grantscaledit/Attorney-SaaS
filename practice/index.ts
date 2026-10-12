import type { PracticeArea } from "@/db/schema";
import { business } from "./business";
import { estate } from "./estate";
import { tax } from "./tax";
import type { DeadlineRuleSeed, TriggerEventDef } from "./deadline-rules";
import type { MatterTypeDef } from "./matter-types";
import type { Answers, IntakeQuestion, PracticeModule } from "./types";

export type { Answers, IntakeQuestion, PracticeModule } from "./types";
export * from "./matter-types";
export * from "./deadline-rules";

/** Every installed practice module. A firm uses the ones in its settings. */
export const PRACTICE_MODULES: Record<PracticeArea, PracticeModule> = { tax, business, estate };

/** Questions that apply given the answers so far. */
export function applicableQuestions(module: PracticeModule, answers: Answers): IntakeQuestion[] {
  return module.questions.filter((q) => !q.askWhen || q.askWhen(answers));
}

/** Required questions still unanswered. */
export function missingAnswers(module: PracticeModule, answers: Answers): string[] {
  return applicableQuestions(module, answers)
    .filter((q) => q.required && !answers[q.id]?.trim())
    .map((q) => q.id);
}

/** A matter type by area and key, or null. */
export function matterType(area: PracticeArea, key: string): MatterTypeDef | null {
  return PRACTICE_MODULES[area].matterTypes.find((t) => t.key === key) ?? null;
}

/** Every seed deadline rule, across areas, with its area. */
export function allRuleSeeds(): (DeadlineRuleSeed & { practiceArea: PracticeArea })[] {
  return (Object.values(PRACTICE_MODULES) as PracticeModule[]).flatMap((m) =>
    m.deadlines.rules.map((r) => ({ ...r, practiceArea: m.area })),
  );
}

/** Trigger events a matter of this type records. */
export function eventsFor(area: PracticeArea, matterTypeKey: string): TriggerEventDef[] {
  return PRACTICE_MODULES[area].deadlines.events.filter((e) =>
    e.matterTypes.includes(matterTypeKey),
  );
}

export function eventDef(area: PracticeArea, key: string): TriggerEventDef | null {
  return PRACTICE_MODULES[area].deadlines.events.find((e) => e.key === key) ?? null;
}

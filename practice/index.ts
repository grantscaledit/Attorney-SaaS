import type { PracticeArea } from "@/db/schema";
import { business } from "./business";
import { estate } from "./estate";
import { tax } from "./tax";
import type { Answers, IntakeQuestion, PracticeModule } from "./types";

export type { Answers, IntakeQuestion, PracticeModule } from "./types";

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

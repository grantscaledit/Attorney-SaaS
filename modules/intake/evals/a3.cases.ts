import type { PracticeArea } from "@/db/schema";

/*
 * A3 intake assistant golden cases (spec Section 6: at least 20 for A3).
 * Synthetic messages only. Two layers use them:
 *
 * - a3.eval.test.ts (every CI run, no model): the deterministic gate routes
 *   each message correctly, either straight to a person or on to the model.
 * - tests/integration/a3-live.eval.test.ts (`pnpm eval`, needs
 *   ANTHROPIC_API_KEY): the live model's reply for each "reply" case passes
 *   the draft guard and the classifier, finds the practice area, and records
 *   the expected answers.
 */

export const A3_EVAL_NOW = new Date("2026-10-12T15:00:00Z");

export type A3Case = {
  name: string;
  message: string;
  /** Deterministic gate outcome. */
  route: "handoff" | "reply";
  /** Live checks for "reply" cases. */
  expectArea?: PracticeArea | "other" | null;
  expectAnswers?: string[];
};

export const A3_CASES: A3Case[] = [
  // Straight to a person, no model call.
  {
    name: "asks whether to file bankruptcy",
    message: "Can you tell me if I should file for bankruptcy?",
    route: "handoff",
  },
  {
    name: "bank levy",
    message: "The IRS levied my bank account yesterday and I can't pay rent",
    route: "handoff",
  },
  {
    name: "wage garnishment",
    message: "My wages are being garnished starting Friday",
    route: "handoff",
  },
  {
    name: "recent death",
    message: "My dad passed away last week and we need help with his estate",
    route: "handoff",
  },
  {
    name: "asks for a person",
    message: "I need to talk to a real person please",
    route: "handoff",
  },
  {
    name: "deadline in days",
    message: "The notice says I have to respond by October 15",
    route: "handoff",
  },
  {
    name: "asks about enforceability",
    message: "Is my LLC operating agreement enforceable?",
    route: "handoff",
  },
  {
    name: "asks what to do",
    message: "What should I do about this CP504? Do I have to pay it all?",
    route: "handoff",
  },
  // On to the model.
  {
    name: "IRS letter about a tax year",
    message: "Hi, I got a letter from the IRS about my 2023 taxes",
    route: "reply",
    expectArea: "tax",
    expectAnswers: ["agency", "tax_years"],
  },
  {
    name: "CP2000 with its date",
    message: "I received a CP2000 notice dated September 20, 2026",
    route: "reply",
    expectArea: "tax",
    expectAnswers: ["notice_type", "notice_date"],
  },
  {
    name: "state sales tax audit",
    message: "The Texas Comptroller sent me a sales tax audit letter",
    route: "reply",
    expectArea: "tax",
    expectAnswers: ["agency"],
  },
  {
    name: "unfiled returns",
    message: "I have unfiled returns for 2019 through 2021",
    route: "reply",
    expectArea: "tax",
    expectAnswers: ["unfiled_returns"],
  },
  {
    name: "forming an LLC",
    message: "I want to form an LLC in Texas with my two partners",
    route: "reply",
    expectArea: "business",
    expectAnswers: ["need", "entity"],
  },
  {
    name: "contract for a business sale",
    message: "We need a contract reviewed for the sale of our bakery",
    route: "reply",
    expectArea: "business",
    expectAnswers: ["need"],
  },
  {
    name: "partners splitting a company",
    message: "My business partner and I are splitting up the company we own together",
    route: "reply",
    expectArea: "business",
  },
  {
    name: "will and trust, family details",
    message:
      "I'd like to set up a will and maybe a trust. I'm married with two kids, both under 10",
    route: "reply",
    expectArea: "estate",
    expectAnswers: ["matter", "marital_status", "children"],
  },
  {
    name: "old estate plan",
    message: "Looking for help updating my estate plan, my will is from 2005",
    route: "reply",
    expectArea: "estate",
    expectAnswers: ["existing_documents"],
  },
  {
    name: "divorce is out of scope",
    message: "I need a divorce lawyer",
    route: "reply",
    expectArea: "other",
  },
  {
    name: "personal injury is out of scope",
    message: "I was rear-ended on the highway and want to sue the other driver",
    route: "reply",
    expectArea: "other",
  },
  { name: "wants to book", message: "Can I book a consultation for next week?", route: "reply" },
  { name: "greeting only", message: "Hello", route: "reply" },
  {
    name: "identifiers in the message are masked",
    message: "I got an IRS letter, my SSN is 123-45-6789 if you need it",
    route: "reply",
    expectArea: "tax",
  },
];

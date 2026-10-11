import { ScriptedTransport } from "./scripted";
import type { TransportRequest } from "./transport";

/*
 * Demo mode's model (rule 12: the demo never calls a live service). Rule-based
 * stand-ins that produce outputs of the right shape, so every screen and
 * automation can be shown with synthetic data. Not used outside DEMO_MODE.
 */

const AREAS: [RegExp, "tax" | "business" | "estate" | "other"][] = [
  [
    /\b(divorce|custody|accident|injur|dwi|criminal defense|immigration|landlord|eviction)\b/i,
    "other",
  ],
  [/\b(irs|tax|cp\d{3,4}|lt\d{2,4}|comptroller|audit|lien|unfiled)\b/i, "tax"],
  [/\b(llc|corporation|business|contract|partner|operating agreement|company)\b/i, "business"],
  [/\b(will|trust|estate|probate|executor|power of attorney)\b/i, "estate"],
];

function lastProspectLine(text: string): string {
  const lines = text.split("\n").filter((l) => l.startsWith("Prospect: "));
  return lines.at(-1)?.slice("Prospect: ".length) ?? "";
}

function intakeReply(req: TransportRequest) {
  const transcript = req.messages.map((m) => m.content).join("\n");
  const area = AREAS.find(([re]) => re.test(transcript))?.[1] ?? null;
  const last = lastProspectLine(transcript);
  const answers: { questionId: string; value: string }[] = [];
  if (area === "tax") {
    const agency = /comptroller/i.test(transcript)
      ? "Texas Comptroller"
      : /\birs\b/i.test(transcript)
        ? "IRS"
        : null;
    if (agency) answers.push({ questionId: "agency", value: agency });
    const notice = transcript.match(/\b(cp\d{3,4}|lt\d{2,4})\b/i)?.[1];
    if (notice) answers.push({ questionId: "notice_type", value: notice.toUpperCase() });
    const years = transcript.match(/\b(20[12]\d)\b/g);
    if (years) answers.push({ questionId: "tax_years", value: [...new Set(years)].join(", ") });
  }
  const offering = req.system.includes("Consultation times you may offer");
  const next = req.system.match(/^- (\w+): (.+?)(?: \(optional\))?$/m);
  const reply =
    area === "other"
      ? "Thank you for reaching out. That is outside the areas our firm handles; someone from the firm will follow up with you."
      : next && !offering
        ? `Thank you. To help the attorney prepare, could you tell me: ${next[2]!.charAt(0).toLowerCase()}${next[2]!.slice(1)}?`
        : "Thank you. Would you like to book a consultation with one of our attorneys? I can share open times.";
  return {
    reply: reply.length > 600 ? reply.slice(0, 590) : reply,
    replyType: area === "other" ? "acknowledge" : offering ? "offer_times" : "question",
    practiceArea: area,
    outOfScopeTopic:
      area === "other" ? last.slice(0, 120) || "matter outside the firm's practice areas" : null,
    answers,
    wantsConsult: /\b(book|consult|appointment)\b/i.test(last),
  };
}

export function demoTransport(): ScriptedTransport {
  return new ScriptedTransport((req) => {
    if (req.system.startsWith("You review one reply")) {
      return {
        output: {
          givesAdvice: false,
          predictsOutcome: false,
          quotesFee: false,
          claimsRepresentation: false,
          describesTheirLegalSituation: false,
        },
      };
    }
    if (req.system.startsWith("You prepare a short pre-consultation brief")) {
      const input = req.messages[0]?.content ?? "";
      const who = input.match(/^Prospect: (.+)$/m)?.[1] ?? "The prospect";
      const area = input.match(/^Practice area: (.+)$/m)?.[1] ?? "an unknown area";
      return {
        output: {
          summary: `${who} contacted the firm about a ${area.toLowerCase()} matter. Details below are as the prospect gave them.`,
          suggestedQuestions: [
            "Do you have the original documents with you?",
            "Has anyone else advised you on this matter?",
            "What outcome are you hoping for?",
          ],
        },
      };
    }
    const sys = req.system;
    const input = req.messages[0]?.content ?? "";
    if (sys.startsWith("You read one tax notice")) {
      // Values left null: the deterministic parser supplies what is printed.
      return {
        output: {
          agency: null,
          noticeType: null,
          taxYears: [],
          amountDue: null,
          noticeDate: null,
          respondBy: null,
          summary:
            "The agency proposes changes and shows an amount due. The notice asks for a response by the date printed on it. (Demo model text.)",
        },
      };
    }
    if (sys.startsWith("You classify one document"))
      return { output: { docType: "other", confidence: 0.2 } };
    if (sys.startsWith("You summarize one law-firm matter")) {
      const first = input.split("\n")[0] ?? "This matter";
      return {
        output: { summary: `${first} (Demo model summary from the records shown.)`, timeline: [] },
      };
    }
    if (sys.startsWith("You draft a short, plain-language status update")) {
      const stage = input.match(/^Current stage: (.+)$/m)?.[1] ?? "the current";
      return {
        output: {
          body: `Hi, a quick update on your matter: it is now at the ${stage.toLowerCase()} stage. We will be in touch about next steps. If you have questions, reply to this message.`,
        },
      };
    }
    if (sys.startsWith("You prepare a first draft")) {
      const outline = input.split("Follow this outline:\n")[1] ?? "DRAFT";
      return { output: { body: outline } };
    }
    return { output: intakeReply(req) };
  });
}

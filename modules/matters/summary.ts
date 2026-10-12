import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { documentExtractions, documents, matters, messages, notes, tasks } from "@/db/schema";
import { DOC_TYPE_LABELS, type DocType } from "@/practice";
import { stageLabel } from "./scope";

/*
 * B7 matter summary and timeline (spec Section 7: "Summary from notes,
 * documents, and messages, with source links"). Every timeline entry points
 * at a record the model was shown; entries citing anything else are dropped.
 */

export const B7_PROMPT_VERSION = "b7-2026-10-11";

export type SourceRef = { type: "note" | "document" | "message" | "task"; id: string };
export type TimelineEntry = { date: string; event: string; source: SourceRef };

export const b7Output = z.object({
  summary: z.string().min(1).max(1_500),
  timeline: z
    .array(
      z.object({
        date: z.iso.date(),
        event: z.string().min(3).max(240),
        source: z.object({
          type: z.enum(["note", "document", "message", "task"]),
          id: z.string().max(40),
        }),
      }),
    )
    .max(40),
});

export const B7_SYSTEM = [
  "You summarize one law-firm matter for the attorney, from the records given (identifiers are masked).",
  "summary: one short paragraph on where the matter stands and what is outstanding. Facts from the records only; no advice, no predictions.",
  "timeline: dated events in order, each citing the record it came from by its [type:id] reference exactly as given. Do not invent dates.",
].join("\n");

const day = (d: Date) => d.toISOString().slice(0, 10);

export async function summaryContext(db: DbOrTx, matterId: string) {
  const [m] = await db.select().from(matters).where(eq(matters.id, matterId));
  if (!m) return null;
  const [noteRows, docRows, extRows, msgRows, taskRows] = await Promise.all([
    db
      .select()
      .from(notes)
      .where(eq(notes.matterId, m.id))
      .orderBy(desc(notes.createdAt))
      .limit(20),
    db
      .select()
      .from(documents)
      .where(and(eq(documents.matterId, m.id), isNull(documents.deletedAt)))
      .orderBy(desc(documents.createdAt))
      .limit(30),
    db
      .select({
        documentId: documentExtractions.documentId,
        summary: documentExtractions.summary,
        fields: documentExtractions.fields,
      })
      .from(documentExtractions)
      .innerJoin(documents, eq(documents.id, documentExtractions.documentId))
      .where(eq(documents.matterId, m.id)),
    db
      .select()
      .from(messages)
      .where(eq(messages.contactId, m.contactId))
      .orderBy(desc(messages.createdAt))
      .limit(20),
    db
      .select()
      .from(tasks)
      .where(eq(tasks.matterId, m.id))
      .orderBy(desc(tasks.createdAt))
      .limit(30),
  ]);
  const ext = new Map(extRows.map((e) => [e.documentId, e]));
  const lines: string[] = [
    `Matter ${m.number}: ${m.title}. Stage: ${stageLabel(m)}. Opened ${day(m.openedAt)}.`,
    "",
    "Records (cite as [type:id]):",
    ...docRows.map((d) => {
      const e = ext.get(d.id);
      return `[document:${d.id}] ${day(d.createdAt)} ${DOC_TYPE_LABELS[(d.docType ?? "other") as DocType]} received${e?.summary ? `. ${e.summary}` : ""}`;
    }),
    ...noteRows.map((n) => `[note:${n.id}] ${day(n.createdAt)} Note: ${n.body.slice(0, 1_500)}`),
    ...msgRows
      .filter((x) => x.body)
      .map(
        (x) =>
          `[message:${x.id}] ${day(x.occurredAt ?? x.createdAt)} ${x.direction === "inbound" ? "From client" : "To client"}: ${x.body!.slice(0, 600)}`,
      ),
    ...taskRows.map(
      (t) =>
        `[task:${t.id}] ${day(t.createdAt)} Task (${t.status})${t.dueOn ? ` due ${t.dueOn}` : ""}: ${t.title}`,
    ),
  ];
  const known = new Set<string>([
    ...docRows.map((d) => `document:${d.id}`),
    ...noteRows.map((n) => `note:${n.id}`),
    ...msgRows.map((x) => `message:${x.id}`),
    ...taskRows.map((t) => `task:${t.id}`),
  ]);
  // Without a model: a timeline straight from the records.
  const fallback: TimelineEntry[] = [
    ...docRows.map((d) => ({
      date: day(d.createdAt),
      event: `${DOC_TYPE_LABELS[(d.docType ?? "other") as DocType]} received`,
      source: { type: "document" as const, id: d.id },
    })),
    ...noteRows.map((n) => ({
      date: day(n.createdAt),
      event: `Note: ${n.body.slice(0, 120)}`,
      source: { type: "note" as const, id: n.id },
    })),
    ...taskRows
      .filter((t) => t.dueOn && t.status === "open")
      .map((t) => ({
        date: t.dueOn!,
        event: `Due: ${t.title}`,
        source: { type: "task" as const, id: t.id },
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const fallbackSummary = [
    `${m.title} is at the ${stageLabel(m).toLowerCase()} stage.`,
    ...extRows.map((e) => e.summary).filter((s): s is string => Boolean(s)),
    `${taskRows.filter((t) => t.status === "open").length} open task(s).`,
  ].join(" ");
  return { matter: m, prompt: lines.join("\n"), known, fallback, fallbackSummary };
}

/** Keeps only timeline entries that cite a record the model was shown. */
export function validTimeline(
  entries: readonly TimelineEntry[],
  known: ReadonlySet<string>,
): TimelineEntry[] {
  return entries
    .filter((e) => known.has(`${e.source.type}:${e.source.id}`))
    .sort((a, b) => a.date.localeCompare(b.date));
}

import "server-only";
import { getDb } from "@/db/client";
import { messageTemplates } from "@/db/schema";
import { assertCan, type Actor } from "@/lib/auth/can";
import { DEFAULT_TEMPLATES, type TemplateDefinition } from "@/lib/messaging/templates";

export type TemplateView = TemplateDefinition & {
  /** Current text: the firm's saved version, or the built-in default. */
  currentSubject: string | null;
  currentBody: string;
  isDefault: boolean;
  approvedAt: Date | null;
  approvedBy: string | null;
};

export async function listTemplates(actor: Actor): Promise<TemplateView[]> {
  assertCan(actor, "firm.settings.read");
  const rows = await getDb().select().from(messageTemplates);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return DEFAULT_TEMPLATES.map((def) => {
    const row = byKey.get(def.key);
    return {
      ...def,
      currentSubject: row ? row.subject : "subject" in def ? def.subject : null,
      currentBody: row?.body ?? def.body,
      isDefault: !row,
      approvedAt: row?.approvedAt ?? null,
      approvedBy: row?.approvedBy ?? null,
    };
  });
}

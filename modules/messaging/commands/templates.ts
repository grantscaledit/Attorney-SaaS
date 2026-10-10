import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { messageTemplates, type MessageTemplateRow } from "@/db/schema";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import {
  TEMPLATE_KEYS,
  templateDefinition,
  unknownPlaceholders,
  type TemplateKey,
} from "@/lib/messaging/templates";

/*
 * Message template approval (spec Section 6). The owner attorney approves the
 * exact text of every automatic message; editing clears the approval, and a
 * withdrawn approval stops queued messages at send time.
 */

const key = z.enum(TEMPLATE_KEYS as [TemplateKey, ...TemplateKey[]]);

/** SMS segments add up quickly; four is the most an acknowledgement should need. */
const SMS_MAX = 600;

async function current(tx: Tx, k: TemplateKey): Promise<MessageTemplateRow | undefined> {
  const [row] = await tx
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.key, k))
    .for("update");
  return row;
}

const view = (r: Pick<MessageTemplateRow, "subject" | "body" | "approvedAt"> | undefined) =>
  r ? { subject: r.subject, body: r.body, approved: r.approvedAt !== null } : null;

function userId(ctx: { principal: { type: string; user?: { id: string } } }): string | null {
  return ctx.principal.type === "user" ? (ctx.principal.user?.id ?? null) : null;
}

export const saveMessageTemplate = defineCommand({
  name: "messaging.template_save",
  permission: "firm.settings.update",
  input: z.object({
    key,
    subject: z.string().trim().max(150).optional(),
    body: z.string().trim().min(10, "Enter the message text").max(4000),
  }),
  async run(ctx, input) {
    const def = templateDefinition(input.key);
    const unknown = unknownPlaceholders(`${input.subject ?? ""} ${input.body}`);
    if (unknown.length > 0) {
      throw new CommandError("validation", "Some fields need attention.", {
        body: [`Unknown placeholder: ${unknown.map((u) => `{{${u}}}`).join(", ")}`],
      });
    }
    if (def.channel === "sms" && input.body.length > SMS_MAX) {
      throw new CommandError("validation", "Some fields need attention.", {
        body: [`Text messages are limited to ${SMS_MAX} characters`],
      });
    }
    if (def.channel === "email" && !input.subject) {
      throw new CommandError("validation", "Some fields need attention.", {
        subject: ["Enter a subject line"],
      });
    }
    const before = await current(ctx.tx, input.key);
    const values = {
      subject: def.channel === "email" ? (input.subject ?? null) : null,
      body: input.body,
      approvedAt: null,
      approvedBy: null,
      updatedBy: userId(ctx),
      updatedAt: new Date(),
    };
    if (before) {
      await ctx.tx.update(messageTemplates).set(values).where(eq(messageTemplates.key, input.key));
    } else {
      await ctx.tx.insert(messageTemplates).values({ key: input.key, ...values });
    }
    return {
      result: { key: input.key },
      audit: [
        {
          action: "messaging.template_saved",
          entityType: "message_template",
          entityId: input.key,
          before: view(before),
          after: { subject: values.subject, body: values.body, approved: false },
        },
      ],
    };
  },
});

/**
 * Approves the text the owner is looking at. `body` must match what is stored
 * (or the built-in default), so a concurrent edit cannot be approved unseen.
 */
export const approveMessageTemplate = defineCommand({
  name: "messaging.template_approve",
  permission: "firm.settings.update",
  input: z.object({ key, body: z.string(), subject: z.string().nullable().optional() }),
  async run(ctx, input) {
    const def = templateDefinition(input.key);
    const before = await current(ctx.tx, input.key);
    const body = before?.body ?? def.body;
    const subject = before ? before.subject : (def.subject ?? null);
    if (body !== input.body || (subject ?? null) !== (input.subject ?? null)) {
      throw new CommandError(
        "conflict",
        "This template changed since you opened it. Reload and review it again.",
      );
    }
    const now = new Date();
    const values = { approvedAt: now, approvedBy: userId(ctx), updatedAt: now };
    if (before) {
      await ctx.tx.update(messageTemplates).set(values).where(eq(messageTemplates.key, input.key));
    } else {
      await ctx.tx
        .insert(messageTemplates)
        .values({ key: input.key, subject, body, updatedBy: userId(ctx), ...values });
    }
    return {
      result: { key: input.key },
      audit: [
        {
          action: "messaging.template_approved",
          entityType: "message_template",
          entityId: input.key,
          before: view(before),
          after: { subject, body, approved: true },
        },
      ],
    };
  },
});

export const withdrawTemplateApproval = defineCommand({
  name: "messaging.template_withdraw",
  permission: "firm.settings.update",
  input: z.object({ key }),
  async run(ctx, input) {
    const before = await current(ctx.tx, input.key);
    if (!before?.approvedAt) {
      throw new CommandError("invalid_state", "This template is not approved.");
    }
    await ctx.tx
      .update(messageTemplates)
      .set({ approvedAt: null, approvedBy: null, updatedBy: userId(ctx), updatedAt: new Date() })
      .where(eq(messageTemplates.key, input.key));
    return {
      result: { key: input.key },
      audit: [
        {
          action: "messaging.template_approval_withdrawn",
          entityType: "message_template",
          entityId: input.key,
          before: view(before),
          after: { ...view(before), approved: false },
        },
      ],
    };
  },
});

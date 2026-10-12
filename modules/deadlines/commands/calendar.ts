import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { calendarFeeds } from "@/db/schema";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";

/*
 * C6: a private calendar feed per person, which Google Calendar or Outlook
 * subscribes to. The link is shown once; only its hash is stored. Creating a
 * new link replaces the old one, so a leaked link is revoked by making another.
 */

export function feedTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function self(ctx: Parameters<typeof createCalendarFeed.run>[0]): string {
  if (ctx.principal.type !== "user")
    throw new CommandError("forbidden", "A calendar feed belongs to a person.");
  return ctx.principal.user.id;
}

export const createCalendarFeed = defineCommand({
  name: "deadlines.create_calendar_feed",
  permission: "deadlines.read",
  input: z.object({}),
  async run(ctx) {
    const userId = self(ctx);
    const token = randomBytes(32).toString("base64url");
    const tokenHash = feedTokenHash(token);
    const [prev] = await ctx.tx
      .select()
      .from(calendarFeeds)
      .where(eq(calendarFeeds.userId, userId));
    if (prev) {
      await ctx.tx
        .update(calendarFeeds)
        .set({ tokenHash, updatedAt: new Date() })
        .where(eq(calendarFeeds.id, prev.id));
    } else {
      await ctx.tx.insert(calendarFeeds).values({ userId, tokenHash });
    }
    return {
      result: { token },
      audit: [
        {
          action: prev ? "deadlines.calendar_feed_replaced" : "deadlines.calendar_feed_created",
          entityType: "user",
          entityId: userId,
          metadata: { automationId: "C6" },
        },
      ],
    };
  },
});

export const revokeCalendarFeed = defineCommand({
  name: "deadlines.revoke_calendar_feed",
  permission: "deadlines.read",
  input: z.object({}),
  async run(ctx) {
    const userId = self(ctx);
    const rows = await ctx.tx
      .delete(calendarFeeds)
      .where(eq(calendarFeeds.userId, userId))
      .returning({ id: calendarFeeds.id });
    if (rows.length === 0) throw new CommandError("not_found", "You have no calendar feed.");
    return {
      result: { revoked: true },
      audit: [
        {
          action: "deadlines.calendar_feed_revoked",
          entityType: "user",
          entityId: userId,
          metadata: { automationId: "C6" },
        },
      ],
    };
  },
});

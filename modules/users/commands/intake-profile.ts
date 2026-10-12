import { eq } from "drizzle-orm";
import { z } from "zod";
import { PRACTICE_AREAS, users } from "@/db/schema";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { userId } from "../schemas";

/**
 * A5 routing profile for a lawyer: the practice areas they take, and the
 * GoHighLevel contact (their own phone) that receives urgent-lead alerts.
 */
export const updateIntakeProfile = defineCommand({
  name: "users.intake_profile_update",
  permission: "users.update",
  input: z.object({
    userId,
    practiceAreas: z.array(z.enum(PRACTICE_AREAS)),
    ghlContactId: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((v) => v || null),
  }),
  async run(ctx, input) {
    const [before] = await ctx.tx
      .select({
        id: users.id,
        role: users.role,
        practiceAreas: users.practiceAreas,
        ghlContactId: users.ghlContactId,
      })
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update");
    if (!before) throw new CommandError("not_found", "User not found.");
    if (before.role !== "owner_attorney" && before.role !== "attorney") {
      throw new CommandError("invalid_state", "Only attorneys receive leads.");
    }
    await ctx.tx
      .update(users)
      .set({
        practiceAreas: input.practiceAreas,
        ghlContactId: input.ghlContactId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.userId));
    return {
      result: { updated: true },
      audit: [
        {
          action: "users.intake_profile_updated",
          entityType: "user",
          entityId: input.userId,
          before: { practiceAreas: before.practiceAreas, ghlContactId: before.ghlContactId },
          after: { practiceAreas: input.practiceAreas, ghlContactId: input.ghlContactId },
        },
      ],
    };
  },
});

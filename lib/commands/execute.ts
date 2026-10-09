import { eq } from "drizzle-orm";
import { getDb, type Database } from "@/db/client";
import { firmSettings } from "@/db/schema";
import { recordAudit, type AuditActor, type AuditRequest } from "@/lib/audit/record";
import { can, type FirmPolicy } from "@/lib/auth/can";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import type { z } from "zod";
import type { Command, CommandContext, Principal } from "./define";
import { CommandError } from "./errors";

function principalActor(p: Principal): AuditActor {
  switch (p.type) {
    case "user":
      return { type: "user", id: p.user.id, label: p.user.email };
    case "system":
      return { type: "system", label: p.label };
    case "anonymous":
      return { type: "anonymous" };
  }
}

export type ExecuteOptions = {
  request: AuditRequest;
  db?: Database;
};

/**
 * The only path for domain writes (rule 2).
 *
 * 1. Validates input with the command's Zod schema.
 * 2. Checks the command's permission for the principal. Denials are audited.
 * 3. Runs the command in a transaction and writes its audit rows in that same
 *    transaction, so a change never commits without its audit record.
 */
export async function execute<S extends z.ZodType, R>(
  command: Command<S, R>,
  principal: Principal,
  rawInput: unknown,
  options: ExecuteOptions,
): Promise<R> {
  const db = options.db ?? getDb();
  const parsed = command.input.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "_form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new CommandError("validation", "Some fields need attention.", fieldErrors);
  }

  if (command.permission === "public") {
    if (principal.type === "user") {
      throw new CommandError("invalid_state", "Sign out before using this link.");
    }
  } else if (principal.type === "anonymous") {
    throw new CommandError("forbidden", "Sign in to continue.");
  } else if (principal.type === "user" && !can(principal.user, command.permission)) {
    await auditDenied(db, command.name, command.permission, principal, options.request);
    throw new CommandError("forbidden", "You do not have permission to do that.");
  }

  const tier = env().FIRM_TIER;

  return db.transaction(async (tx) => {
    const [settings] = await tx
      .select({ attorneysSeeFinancials: firmSettings.attorneysSeeFinancials })
      .from(firmSettings)
      .where(eq(firmSettings.id, 1));
    const policy: FirmPolicy = { attorneysSeeFinancials: settings?.attorneysSeeFinancials ?? false };

    const ctx: CommandContext = {
      tx,
      principal,
      request: options.request,
      tier,
      policy,
      authorize: (action, scope = {}) => {
        if (principal.type === "system") return;
        if (principal.type !== "user" || !can(principal.user, action, { ...scope, policy })) {
          throw new CommandError("forbidden", "You do not have permission to do that.");
        }
      },
    };

    const output = await command.run(ctx, parsed.data);
    if (!output.audit || output.audit.length === 0) {
      throw new Error(`Command ${command.name} returned no audit entries`);
    }
    for (const spec of output.audit) {
      const { actor, action, ...rest } = spec;
      await recordAudit(tx, {
        ...rest,
        action: action ?? command.name,
        actor: actor ?? principalActor(principal),
        request: options.request,
      });
    }
    return output.result;
  });
}

async function auditDenied(
  db: Database,
  commandName: string,
  permission: string,
  principal: Principal,
  request: AuditRequest,
): Promise<void> {
  try {
    await recordAudit(db, {
      actor: principalActor(principal),
      action: "access.denied",
      metadata: { command: commandName, permission },
      request,
    });
  } catch (err) {
    log.error("failed to audit access denial", { err, command: commandName });
  }
}

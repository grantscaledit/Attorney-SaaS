import type { CommandContext } from "./define";
import { CommandError } from "./errors";

/**
 * Guard for commands only trusted server code may run (webhook processing,
 * jobs). Their `permission` keeps people out through execute(); this makes the
 * intent explicit and survives a permission change.
 */
export function requireSystem(ctx: CommandContext): void {
  if (ctx.principal.type !== "system") {
    throw new CommandError("forbidden", "This action is performed by the system only.");
  }
}

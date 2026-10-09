import type { z } from "zod";
import type { Tx } from "@/db/client";
import type { AuditEntry, AuditRequest, AuditActor } from "@/lib/audit/record";
import type { Action, Actor, CanContext, FirmPolicy } from "@/lib/auth/can";
import type { Tier } from "@/lib/env";

/** Who is executing a command. */
export type Principal =
  | { type: "user"; user: SessionUser }
  /** Trusted server code (jobs, provisioning). Skips permission checks; still audited. */
  | { type: "system"; label: string }
  /** Unauthenticated caller of a `public` command (for example, accepting an invite). */
  | { type: "anonymous" };

export type SessionUser = Actor & { email: string; name: string };

export type CommandContext = {
  tx: Tx;
  principal: Principal;
  request: AuditRequest;
  tier: Tier;
  policy: FirmPolicy;
  /** Resource-scoped permission check for use inside `run` (throws CommandError "forbidden"). */
  authorize: (action: Action, ctx?: Omit<CanContext, "policy">) => void;
};

/** One audit row produced by a command. `action` defaults to the command name. */
export type AuditSpec = Omit<AuditEntry, "actor" | "request" | "action"> & {
  action?: string;
  /** Override the actor (for example, an invitee identified by token). */
  actor?: AuditActor;
};

export type CommandOutput<R> = {
  result: R;
  /** At least one row: every mutation is audited (rule 2). */
  audit: [AuditSpec, ...AuditSpec[]];
};

export type CommandDefinition<S extends z.ZodType, R> = {
  /** Stable dotted name, also the default audit action: "users.invite". */
  name: string;
  /** Required permission, or "public" for unauthenticated commands that verify their own token. */
  permission: Action | "public";
  input: S;
  run: (ctx: CommandContext, input: z.output<S>) => Promise<CommandOutput<R>>;
};

export type Command<S extends z.ZodType = z.ZodType, R = unknown> = CommandDefinition<S, R> & {
  readonly __command: true;
};

/** Type-erased command for registries (parameter is `never` so any command is assignable). */
export type AnyCommand = {
  readonly __command: true;
  name: string;
  permission: Action | "public";
  input: z.ZodType;
  run: (ctx: CommandContext, input: never) => Promise<CommandOutput<unknown>>;
};

export function defineCommand<S extends z.ZodType, R>(def: CommandDefinition<S, R>): Command<S, R> {
  return { ...def, __command: true };
}

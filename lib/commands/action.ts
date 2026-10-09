import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { log } from "@/lib/log";
import { getRequestMeta } from "@/lib/request-context";
import type { Command, Principal } from "./define";
import { CommandError } from "./errors";
import { execute } from "./execute";

import type { ActionState } from "./action-state";

export type { ActionState } from "./action-state";

/**
 * Server-action adapter: resolves the signed-in principal and request metadata,
 * runs the command, and turns expected failures into form state. Unexpected
 * errors are logged with a request id the user can quote to support.
 */
export async function runCommand<S extends z.ZodType, R>(
  command: Command<S, R>,
  input: unknown,
  options: { anonymous?: boolean; successMessage?: string } = {},
): Promise<ActionState<R>> {
  const request = await getRequestMeta();
  let principal: Principal;
  if (options.anonymous) {
    principal = { type: "anonymous" };
  } else {
    const session = await requireSession();
    principal = { type: "user", user: session.user };
  }

  try {
    const data = await execute(command, principal, input, { request });
    return { status: "success", data, message: options.successMessage };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof CommandError) {
      return { status: "error", message: err.message, fieldErrors: err.fieldErrors };
    }
    log.error("command failed", { err, command: command.name, requestId: request.requestId });
    return {
      status: "error",
      message: `Something went wrong and nothing was changed. Reference: ${request.requestId.slice(0, 8)}`,
    };
  }
}

export type CommandErrorCode = "validation" | "forbidden" | "not_found" | "conflict" | "limit" | "invalid_state";

/**
 * Expected, user-facing failures. Anything else thrown from a command is a bug
 * and surfaces as a generic error with a request id.
 */
export class CommandError extends Error {
  readonly code: CommandErrorCode;
  readonly fieldErrors: Record<string, string[]> | undefined;

  constructor(code: CommandErrorCode, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "CommandError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

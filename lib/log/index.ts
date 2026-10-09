import { redact } from "./redact";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL ?? "info") as Level;
  return ORDER[lvl] ?? ORDER.info;
}

function serializeError(err: unknown): LogFields {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { value: String(err) };
}

/**
 * Structured JSON logger. One line per event on stdout/stderr, which Render
 * collects. Rule: never pass message bodies, document text or client
 * identifiers in `fields`. Known sensitive keys are redacted as a backstop.
 */
function write(level: Level, msg: string, fields?: LogFields): void {
  if (ORDER[level] < threshold()) return;
  const { err, ...rest } = fields ?? {};
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    firm: process.env.FIRM_SLUG,
    ...redact(rest),
    ...(err !== undefined ? { err: serializeError(err) } : {}),
  });
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const log = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};

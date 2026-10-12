/**
 * Quiet hours (spec Section 4: "Quiet hours 8am-9pm recipient local time").
 * Automated messages due outside the window move to 8:00 the next permitted
 * morning in the recipient's time zone (the firm's zone when unknown).
 */
export const QUIET_HOURS = { startHour: 8, endHour: 21 } as const;

function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** UTC instant for a wall-clock time in `timeZone` (handles DST shifts). */
export function zonedTime(y: number, m: number, d: number, hour: number, timeZone: string): Date {
  // Start from the naive UTC reading, then correct by the zone's offset at that instant (twice for DST edges).
  let guess = Date.UTC(y, m - 1, d, hour);
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += Date.UTC(y, m - 1, d, hour) - asUtc;
  }
  return new Date(guess);
}

export function isWithinQuietHours(at: Date, timeZone: string): boolean {
  const { hour } = localParts(at, timeZone);
  return hour < QUIET_HOURS.startHour || hour >= QUIET_HOURS.endHour;
}

/** `due` if it is inside sending hours, otherwise the next 8:00 local time. */
export function nextSendableTime(due: Date, timeZone: string): Date {
  if (!isWithinQuietHours(due, timeZone)) return due;
  const p = localParts(due, timeZone);
  if (p.hour < QUIET_HOURS.startHour) {
    return zonedTime(p.year, p.month, p.day, QUIET_HOURS.startHour, timeZone);
  }
  // After 9pm: 8am the following calendar day (Date.UTC normalizes day overflow).
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return zonedTime(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    QUIET_HOURS.startHour,
    timeZone,
  );
}

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

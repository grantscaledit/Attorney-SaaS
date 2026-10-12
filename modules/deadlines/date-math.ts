/*
 * Date-only arithmetic for deadlines (rule 10: deadlines are date-only values
 * in the firm's time zone). Dates are "YYYY-MM-DD" strings and every
 * calculation runs on UTC midnights, so no time zone or daylight saving shift
 * can move a date.
 */

export type IsoDate = string;

const DAY = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(d: IsoDate): [number, number, number] {
  const m = ISO.exec(d);
  if (!m) throw new Error(`not a date: ${d}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, day));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== day)
    throw new Error(`not a date: ${d}`);
  return [y, mo, day];
}

function fmt(t: Date): IsoDate {
  return t.toISOString().slice(0, 10);
}

export function isIsoDate(d: string): boolean {
  try {
    parts(d);
    return true;
  } catch {
    return false;
  }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const [y, m, day] = parts(d);
  return fmt(new Date(Date.UTC(y, m - 1, day) + n * DAY));
}

/**
 * Calendar months later. When the target month is shorter, the result is its
 * last day: 31 January plus one month is 28 (or 29) February, never March.
 */
export function addMonths(d: IsoDate, n: number): IsoDate {
  const [y, m, day] = parts(d);
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  return fmt(new Date(Date.UTC(ty, tm - 1, Math.min(day, daysInMonth(ty, tm)))));
}

/** Calendar years later. 29 February in a non-leap target year becomes 28 February. */
export function addYears(d: IsoDate, n: number): IsoDate {
  return addMonths(d, n * 12);
}

/** The next given month and day strictly after `d` (clamped in short months). */
export function nextAnnual(d: IsoDate, month: number, day: number): IsoDate {
  const [y] = parts(d);
  for (const year of [y, y + 1]) {
    const c = fmt(new Date(Date.UTC(year, month - 1, Math.min(day, daysInMonth(year, month)))));
    if (c > d) return c;
  }
  throw new Error("unreachable");
}

/** Whole days from a to b (negative when b is earlier). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY);
}

/** 0 Sunday ... 6 Saturday. */
export function weekday(d: IsoDate): number {
  const [y, m, day] = parts(d);
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay();
}

export function isWeekend(d: IsoDate): boolean {
  const w = weekday(d);
  return w === 0 || w === 6;
}

/** The date itself, or the next day that is neither a weekend nor in `holidays`. */
export function nextBusinessDay(d: IsoDate, holidays: ReadonlySet<IsoDate>): IsoDate {
  let c = d;
  for (let i = 0; i < 31; i++) {
    if (!isWeekend(c) && !holidays.has(c)) return c;
    c = addDays(c, 1);
  }
  throw new Error(`no business day within a month of ${d}; check the holiday list`);
}

function nthWeekday(year: number, month: number, dow: number, n: number): IsoDate {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((dow - first + 7) % 7) + (n - 1) * 7;
  return fmt(new Date(Date.UTC(year, month - 1, day)));
}

function lastWeekday(year: number, month: number, dow: number): IsoDate {
  const lastDay = daysInMonth(year, month);
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return fmt(new Date(Date.UTC(year, month - 1, lastDay - ((last - dow + 7) % 7))));
}

/** A fixed-date holiday falling on Saturday is observed Friday; on Sunday, Monday. */
function observed(d: IsoDate): IsoDate {
  const w = weekday(d);
  return w === 6 ? addDays(d, -1) : w === 0 ? addDays(d, 1) : d;
}

/**
 * The eleven US federal holidays for a year with their observed dates
 * (5 U.S.C. 6103). Offered as a starting list for the firm's holiday
 * calendar: which holidays an agency or court observes is for the attorney
 * to confirm (VERIFY).
 */
export function usFederalHolidays(year: number): { date: IsoDate; label: string }[] {
  const ymd = (m: number, d: number) => fmt(new Date(Date.UTC(year, m - 1, d)));
  return [
    { date: observed(ymd(1, 1)), label: "New Year's Day" },
    { date: nthWeekday(year, 1, 1, 3), label: "Birthday of Martin Luther King, Jr." },
    { date: nthWeekday(year, 2, 1, 3), label: "Washington's Birthday" },
    { date: lastWeekday(year, 5, 1), label: "Memorial Day" },
    { date: observed(ymd(6, 19)), label: "Juneteenth National Independence Day" },
    { date: observed(ymd(7, 4)), label: "Independence Day" },
    { date: nthWeekday(year, 9, 1, 1), label: "Labor Day" },
    { date: nthWeekday(year, 10, 1, 2), label: "Columbus Day" },
    { date: observed(ymd(11, 11)), label: "Veterans Day" },
    { date: nthWeekday(year, 11, 4, 4), label: "Thanksgiving Day" },
    { date: observed(ymd(12, 25)), label: "Christmas Day" },
  ];
}

const LONG = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "Mon, Mar 2, 2026". Date-only, so formatted in UTC to keep the same day. */
export function formatDate(d: IsoDate): string {
  return LONG.format(new Date(`${d}T00:00:00Z`));
}

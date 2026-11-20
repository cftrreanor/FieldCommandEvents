// Old dates in copied text (Duplicate event, owner decision 2026-11-20): everything comes over except volunteers,
// personal details, and dates. While copying, the database replaces each date typed into copied text that isn't
// one of the copy's own days with "[new date]" (public.copy_blank_dates in
// supabase/migrations/20270207000000_duplicate_event.sql), and publishing waits until none is left.
//
// This is the same detection, kept in step with the SQL and tested with npm test (the SQL has the same cases in
// supabase/tests/security_test.sql). Pure, so the browser can use it too.

/** The marker a copied date is replaced with, to fill in before publishing. */
export const NEW_DATE = "[new date]";

const WEEKDAY = "sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat";
const MONTH = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";

/**
 * "Nov 7", "November 7th", "Nov. 7, 2026", "Nov 7-8", "11/7", "11/7/26", "11/7/2026", each with an optional weekday
 * before it ("Saturday, Nov 7", "Sat 11/7"). Groups: 1 weekday, 2 month, 3 day, 4 year; or 5 month, 6 day, 7 year.
 */
const DATE_PATTERN = new RegExp(
  String.raw`\b(?:(${WEEKDAY})\.?,?\s+)?(?:(${MONTH})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2}(?:st|nd|rd|th)?)?(?:,?\s+(\d{4}))?|(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?)\b`,
  "gi",
);

const MONTHS = "janfebmaraprmayjunjulaugsepoctnovdec";
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * `text` with every date that isn't one of `keep` (the copy's own days and dates, "YYYY-MM-DD") replaced with
 * "[new date]", and how many were replaced. A date written without a year is kept when its month and day match one
 * of `keep`; one written with a weekday only when the weekday matches that day too. Times ("7:45"), a year on its
 * own, numbers that can't be dates ("13/40"), and fractions ("1/2", "3/4") are left alone.
 */
export function blankOldDates(text: string | null | undefined, keep: string[]): { text: string; count: number } {
  if (!text) return { text: text ?? "", count: 0 };
  let count = 0;
  const out = text.replace(DATE_PATTERN, (whole, wd?: string, monthName?: string, d1?: string, y1?: string, m2?: string, d2?: string, y2?: string) => {
    let month: number;
    let day: number;
    let year: number | null = null;
    if (monthName) {
      month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase()) / 3 + 1;
      day = Number(d1);
      year = y1 ? Number(y1) : null;
    } else {
      month = Number(m2);
      day = Number(d2);
      year = y2 ? Number(y2.length === 2 ? `20${y2}` : y2) : null;
    }
    // Not a date, or a fraction.
    if (month < 1 || month > 12 || day < 1 || day > 31) return whole;
    if (!monthName && year === null && [2, 3, 4, 8, 16].includes(day) && month < day) return whole;
    const md = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const hit = [...keep].sort().find((k) => k.slice(5) === md && (year === null || Number(k.slice(0, 4)) === year));
    const sameWeekday = !wd || (hit !== undefined && DAY_NAMES[new Date(`${hit}T12:00:00Z`).getUTCDay()] === wd.slice(0, 3).toLowerCase());
    if (hit && sameWeekday) return whole;
    count += 1;
    return NEW_DATE;
  });
  return { text: out, count };
}

/** How many "[new date]" markers `text` holds. */
export function countNewDates(text: string | null | undefined): number {
  return text ? text.split(NEW_DATE).length - 1 : 0;
}

/** Every day from `start` to `end` ("YYYY-MM-DD"), inclusive. */
export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (d <= last && days.length < 400) {
    days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

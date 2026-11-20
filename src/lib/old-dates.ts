// Old dates in copied text (Duplicate event, 2026-11-20): the publish window quotes dates found in a copy's
// description, information for directors, and job instructions that aren't the copy's own dates, so last year's
// "See you Nov 21" doesn't go out unchecked. Pure, so it's tested with npm test.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "January 16", "Jan. 16th", "Jan 16, 2026", "1/16", "1/16/26", "1/16/2026", and a year on its own ("2026"). */
const DATE_PATTERN = new RegExp(
  [
    // Month name, day, optional year.
    String.raw`\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?`,
    // Numbers: month/day with an optional year.
    String.raw`\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b`,
    // A year on its own.
    String.raw`\b(20\d{2})\b`,
  ].join("|"),
  "gi",
);

export type OldDate = {
  /** The text as written ("Nov 21", "11/21/2026", "2026"). */
  text: string;
  /** Up to about 60 characters around it, for quoting. */
  context: string;
};

/**
 * Dates written in `text` that aren't one of `keep` (the copy's own days and dates, "YYYY-MM-DD"). A date written
 * without a year counts as the copy's if its month and day match one of them. A year on its own counts when it's
 * `oldYear` and none of `keep` are in that year.
 */
export function findOldDates(text: string | null | undefined, keep: string[], oldYear?: number): OldDate[] {
  if (!text) return [];
  const keepFull = new Set(keep);
  const keepMonthDay = new Set(keep.map((d) => d.slice(5)));
  const keepYears = new Set(keep.map((d) => Number(d.slice(0, 4))));
  const found: OldDate[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(DATE_PATTERN)) {
    let month: number | null = null;
    let day: number | null = null;
    let year: number | null = null;
    if (m[1]) {
      month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
      day = Number(m[2]);
      year = m[3] ? Number(m[3]) : null;
    } else if (m[4]) {
      month = Number(m[4]);
      day = Number(m[5]);
      year = m[6] ? Number(m[6].length === 2 ? `20${m[6]}` : m[6]) : null;
    } else if (m[7]) {
      year = Number(m[7]);
    }
    let old: boolean;
    if (month !== null && day !== null) {
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      const md = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      old = year === null ? !keepMonthDay.has(md) : !keepFull.has(`${year}-${md}`);
    } else {
      old = year !== null && year === oldYear && !keepYears.has(year);
    }
    if (!old) continue;
    const written = m[0].trim();
    if (seen.has(written.toLowerCase())) continue;
    seen.add(written.toLowerCase());
    const at = m.index ?? 0;
    const from = Math.max(0, at - 25);
    const to = Math.min(text.length, at + m[0].length + 25);
    const context = `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ").trim()}${to < text.length ? "…" : ""}`;
    found.push({ text: written, context });
  }
  return found;
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

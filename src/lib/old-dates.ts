// Old dates in copied text (Duplicate event, owner decision 2026-11-20): everything comes over except volunteers,
// personal details, and dates. While copying, the database replaces each date typed into copied text that isn't
// one of the copy's own days with "[new date]" (public.copy_blank_dates in
// supabase/migrations/20270207000000_duplicate_event.sql), and publishing waits until none is left.
//
// This is the same detection, kept in step with the SQL and tested with npm test (the SQL has the same cases in
// supabase/tests/security_test.sql, "dup: blank"). Pure, so the browser can use it too.

/** The marker a copied date is replaced with, to fill in before publishing. */
export const NEW_DATE = "[new date]";

const WEEKDAY = "(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)";
const MONTH = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)";
const PRE = String.raw`(?:${WEEKDAY}\.?,?\s+)?`;

/**
 * Each form of date, as the SQL has them: 1 "Nov 7[, 2026]" (and "Nov 7-8"), 2 "7[th] [of] November[ 2026]",
 * 3 "2026-11-07", 4 "11/7[/26]", 5 "11-7-2026", 6 "Saturday the 7th". Group 1 is always the weekday.
 */
const PATTERNS = [
  String.raw`\b${PRE}${MONTH}\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2}(?:st|nd|rd|th)?)?(?:,?\s+(\d{4})(?![-/]))?\b`,
  String.raw`\b${PRE}(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH}\.?(?:,?\s+(\d{4})(?![-/]))?\b`,
  String.raw`\b${PRE}(\d{4})-(\d{1,2})-(\d{1,2})\b`,
  String.raw`\b${PRE}(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b`,
  String.raw`\b${PRE}(\d{1,2})-(\d{1,2})-(\d{4})\b`,
  String.raw`\b${WEEKDAY},?\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b`,
].map((p) => new RegExp(p, "i"));

/** A month name used as a name before a count ("Ask Jan 2 hours before"). */
const COUNTED =
  /^\s+(hours?|hrs?|minutes?|mins?|days?|weeks?|months?|years?|people|persons|volunteers?|kids|children|adults|parents|students|times|spots?|shifts?|tables?|chairs?|tents?|boxes|bags|cases|cups|pounds|lbs|feet|ft|miles|laps|more|or\s+more)\b/i;
/** Web addresses and links, left as they are. */
const LINK = /\[[^\]\n]*\]\([^)\s]*\)|(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|gov|us|io|co|info)(?:\/[^\s<>"']*)?/i;

const MONTHS = "janfebmaraprmayjunjulaugsepoctnovdec";
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const weekdayOf = (iso: string) => DAY_NAMES[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const monthOf = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) / 3 + 1;

/** One stretch of text with no web address in it. */
function blankPart(text: string, keep: string[]): { text: string; count: number } {
  const sorted = [...keep].sort();
  let rest = text;
  let out = "";
  let count = 0;
  for (;;) {
    // The earliest date of any form (the longest when two start together).
    let best: { at: number; whole: string; kind: number; m: RegExpExecArray } | null = null;
    PATTERNS.forEach((re, i) => {
      const m = re.exec(rest);
      if (m && (!best || m.index < best.at || (m.index === best.at && m[0].length > best.whole.length))) best = { at: m.index, whole: m[0], kind: i + 1, m };
    });
    if (!best) break;
    const { at, kind, m } = best as { at: number; whole: string; kind: number; m: RegExpExecArray };
    let whole = (best as { whole: string }).whole;
    let after = rest.slice(at + whole.length);
    const before = rest.slice(0, at);
    const wd = m[1];
    let monthText: string | undefined;
    let month = 0;
    let day = 0;
    let year: number | null = null;
    let keepIt = false;
    if (kind === 1) {
      monthText = m[2];
      month = monthOf(monthText);
      day = Number(m[3]);
      year = m[4] ? Number(m[4]) : null;
      if (year === null && COUNTED.test(after)) keepIt = true;
    } else if (kind === 2) {
      day = Number(m[2]);
      monthText = m[3];
      month = monthOf(monthText);
      year = m[4] ? Number(m[4]) : null;
    } else if (kind === 3) {
      year = Number(m[2]);
      month = Number(m[3]);
      day = Number(m[4]);
    } else if (kind === 4) {
      month = Number(m[2]);
      day = Number(m[3]);
      year = m[4] ? Number(m[4].length === 2 ? `20${m[4]}` : m[4]) : null;
      // Grades ("6/7/8", "Grades 4/5") and part of a longer run of numbers: not a date, and kept whole.
      const chain = /^(?:\/\d+)+/.exec(after)?.[0];
      if (chain) {
        whole += chain;
        after = after.slice(chain.length);
        keepIt = true;
      } else if (/(\bgrades?|\bgr\.?)\s*$/i.test(before) || /\d\/$/.test(before)) {
        keepIt = true;
      } else if (year === null && (day === 10 || ([2, 3, 4, 8, 16].includes(day) && month < day))) {
        // A score out of 10 ("9/10"), or a fraction ("1/2", "3/4").
        keepIt = true;
      }
    } else if (kind === 5) {
      month = Number(m[2]);
      day = Number(m[3]);
      year = Number(m[4]);
    } else {
      day = Number(m[2]);
    }
    // Lowercase "march" and "may" are words ("march 8 to 5", "you may 2").
    if (monthText === "march" || monthText === "may") keepIt = true;
    if (!keepIt) {
      if (kind === 6) {
        keepIt = sorted.some((k) => Number(k.slice(8, 10)) === day && weekdayOf(k) === wd.slice(0, 3).toLowerCase());
      } else if (month < 1 || month > 12 || day < 1 || day > 31) {
        keepIt = true;
      } else {
        const md = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const hit = sorted.find((k) => k.slice(5) === md && (year === null || Number(k.slice(0, 4)) === year));
        keepIt = hit !== undefined && (!wd || weekdayOf(hit) === wd.slice(0, 3).toLowerCase());
      }
    }
    if (!keepIt) count += 1;
    out += before + (keepIt ? whole : NEW_DATE);
    rest = after;
  }
  return { text: out + rest, count };
}

/**
 * `text` with every date that isn't one of `keep` (the copy's own days and registration dates, "YYYY-MM-DD")
 * replaced with "[new date]", and how many were replaced. The rules are listed in the SQL (copy_blank_dates).
 */
export function blankOldDates(text: string | null | undefined, keep: string[]): { text: string; count: number } {
  if (!text) return { text: text ?? "", count: 0 };
  let rest = text;
  let out = "";
  let count = 0;
  for (;;) {
    const link = LINK.exec(rest);
    if (!link) break;
    const part = blankPart(rest.slice(0, link.index), keep);
    out += part.text + link[0];
    count += part.count;
    rest = rest.slice(link.index + link[0].length);
  }
  const last = blankPart(rest, keep);
  return { text: out + last.text, count: count + last.count };
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

// Reading what people type into our date and time boxes (DateField, TimeField), and showing values back in
// words. Values are the same strings the browser's own pickers used: "2026-11-16" and "15:30".

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-16" for a real calendar day, else null. */
export function isoDay(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d > last ? null : `${y}-${pad(m)}-${pad(d)}`;
}

/** Today in the browser, as "2026-11-16". */
export function todayIso(): string {
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The year, month, and day someone typed (year null when they left it off), before checking it's a real day. */
function readParts(text: string): { y: number | null; m: number; d: number } | null {
  const t = text.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!t) return null;
  const year = (s: string | undefined) => (s === undefined ? null : s.length === 2 ? 2000 + Number(s) : Number(s));
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/))) return { y: year(m[3]), m: Number(m[1]), d: Number(m[2]) };
  const month = (word: string) => MONTHS.indexOf(word.slice(0, 3)) + 1;
  // Weekday names are fine to type and are ignored ("Mon Nov 16 2026").
  const words = t.replace(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.? /, "");
  if ((m = words.match(/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/)) && month(m[1]) > 0) return { y: year(m[3]), m: month(m[1]), d: Number(m[2]) };
  if ((m = words.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?: (\d{4}))?$/)) && month(m[2]) > 0) return { y: year(m[3]), m: month(m[2]), d: Number(m[1]) };
  return null;
}

/**
 * A typed date as "2026-11-16", or null if it can't be read. Takes 11/16/2026, 11/16/26, 11-16-2026,
 * 2026-11-16, Nov 16 2026, November 16, 2026, and 16 Nov 2026. With no year (11/16, Nov 16) it's the next
 * time that date comes around, today included: "1/15" typed in December is next January.
 */
export function parseDate(text: string, today = todayIso()): string | null {
  const p = readParts(text);
  if (!p) return null;
  if (p.y !== null) return isoDay(p.y, p.m, p.d);
  return isoDay(landingYear(p.m, p.d, today), p.m, p.d);
}

/** The year a date typed without one lands in: this year, or next year once it has passed. */
function landingYear(m: number, d: number, today: string) {
  const thisYear = Number(today.slice(0, 4));
  const md = `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return md >= today.slice(5) ? thisYear : thisYear + 1;
}

/** Why a typed date isn't a real day, in words ("November has 30 days.", "February 2027 has 28 days."). */
export function dateProblem(text: string, today = todayIso()): string | null {
  const p = readParts(text);
  if (!p || p.m < 1 || p.m > 12 || p.d < 1) return null;
  const y = p.y ?? landingYear(p.m, p.d, today);
  const last = new Date(Date.UTC(y, p.m, 0)).getUTCDate();
  if (p.d <= last) return null;
  // February's length depends on the year, so name it.
  return `${MONTH_NAMES[p.m - 1]}${p.m === 2 ? ` ${y}` : ""} has ${last} days.`;
}

/** "Mon, Nov 16, 2026" for "2026-11-16" (the date as written, whatever the time zone). */
export function formatDay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "Monday, November 16, 2026": for screen readers. */
export function longDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * A typed time as "15:30", or null. Takes 3:30 pm, 3:30p, 330p, 3pm, 15:30, 1530, and noon or midnight.
 * A bare hour with no AM or PM ("3", "3:30") is read the way people usually mean it at events: 7 to 11 is
 * morning, 12 to 6 is afternoon. An end time passes its start as `after`: then a bare hour is the first one
 * after the start (start 3:30 PM, "7" is 7:00 PM; start 9:00 AM, "11" is 11:00 AM).
 */
export function parseTime(text: string, after?: string): string | null {
  const t = text.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
  if (!t) return null;
  if (t === "noon") return "12:00";
  if (t === "midnight") return "00:00";
  const m = t.match(/^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (min > 59) return null;
  const half = m[3]?.[0];
  if (half) {
    if (h < 1 || h > 12) return null;
    if (half === "a") h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (m[1].length === 2 && (h > 12 || m[1].startsWith("0"))) {
    // 24-hour time: "15:30", "09:00", "05:30".
    if (h > 23) return null;
  } else if (h >= 1 && h <= 12 && after && /^\d{2}:\d{2}/.test(after)) {
    const morning = `${pad(h % 12)}:${pad(min)}`;
    const evening = `${pad((h % 12) + 12)}:${pad(min)}`;
    const start = after.slice(0, 5);
    if (morning > start) return morning;
    if (evening > start) return evening;
    if (h <= 6) h += 12;
  } else if (h >= 1 && h <= 6) {
    h += 12;
  } else if (h === 0 || h > 12) {
    if (h > 23) return null;
  }
  return `${pad(h)}:${pad(min)}`;
}

/** "3:30 PM" for "15:30". */
export function formatTime(hhmm: string): string {
  const m = hhmm.match(/^(\d{2}):(\d{2})/);
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** Every time of day `step` minutes apart, as "HH:MM". */
export function timesEvery(step: number): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += Math.max(1, step)) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  return out;
}

// The public organization page (/o/[slug]) and the "More ways to help" block on volunteer sign-up pages: the words
// and order worked out from org_page_listing (supabase/migrations/20270210000000_org_page.sql). Owner decisions:
// docs/design-decisions/2026-11-20-organization-page.md. Pure, so it runs on the server, in the browser, and in
// `npm test`.

import { formatDate, formatTimeRange, utcToZonedDate } from "./time.ts";

export type OrgListingShift = { id: string; starts_at: string; ends_at: string; job: string };
export type OrgListingEvent = {
  slug: string;
  name: string;
  kind: string;
  starts_on: string;
  ends_on: string;
  timezone: string;
  venue_name: string | null;
  open_spots: number;
  items_needed: number;
  /** The day volunteer sign-up opens, while it's still to come. */
  opens_on: string | null;
  /** A shift is under way right now (never offered: soonest_shift is always one still to start). */
  happening_now?: boolean;
  soonest_shift: OrgListingShift | null;
};
export type OrgHelp = { id: string; title: string; note: string | null; link: string | null; ends_on: string };
export type OrgListing = {
  page_on: true;
  org: { name: string; slug: string; logo_path: string | null; brand_color: string | null; contact_email: string | null };
  events: OrgListingEvent[];
  help: OrgHelp[];
};

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Sat, Dec 12" */
export const dayWords = (iso: string) => formatDate(iso, { year: undefined });
/** "Dec 4": button names. */
export const shortDay = (iso: string) => formatDate(iso, { weekday: undefined, year: undefined });
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(new Date(`${iso}T12:00:00Z`));
export const monthShort = (iso: string) => fmt(iso, { month: "short" });
export const dayNum = (iso: string) => fmt(iso, { day: "numeric" });
const weekday = (iso: string) => fmt(iso, { weekday: "short" });

/** "Mon–Wed, Dec 7–9", "Mon, Nov 30 – Wed, Dec 2", or "Sat, Dec 12". */
export function daysWords(a: string, b: string) {
  if (a === b) return dayWords(a);
  return a.slice(0, 7) === b.slice(0, 7) ? `${weekday(a)}–${weekday(b)}, ${monthShort(a)} ${dayNum(a)}–${dayNum(b)}` : `${dayWords(a)} – ${dayWords(b)}`;
}

/** Today in a time zone (YYYY-MM-DD). */
export const todayIn = (tz: string, now: Date = new Date()) => utcToZonedDate(now.toISOString(), tz);

/** Things to bring and nothing else: no shift is left to sign up for, only items. */
export const isItemsOnly = (e: Pick<OrgListingEvent, "soonest_shift" | "items_needed" | "open_spots">) =>
  !e.soonest_shift && e.open_spots === 0 && e.items_needed > 0;

/** The kind in its own words: the icon, the word under the name, and the one button. */
export function kindWords(e: Pick<OrgListingEvent, "kind" | "soonest_shift" | "items_needed" | "open_spots">) {
  if (e.kind === "fair") return { icon: "party" as const, word: "Fair or fundraiser", button: "Sign up to help" };
  if (isItemsOnly(e)) return { icon: "bag" as const, word: "Things to bring", button: "Pick something to bring" };
  return { icon: "volunteer" as const, word: "Volunteer event", button: "Sign up" };
}

/** "3 spots open", "10 things still needed": facts, never pressure. */
export const spotWords = (n: number) => plural(n, "spot open", "spots open");
export function needWords(e: Pick<OrgListingEvent, "open_spots" | "items_needed">) {
  if (e.open_spots > 0) return spotWords(e.open_spots);
  return plural(e.items_needed, "thing still needed", "things still needed");
}

/** The day a row goes under: its first day, or today for something already under way. */
export function shownOn(e: Pick<OrgListingEvent, "starts_on" | "timezone">, now: Date = new Date()) {
  const today = todayIn(e.timezone, now);
  return e.starts_on < today ? today : e.starts_on;
}

/** Happening today, in the event's time zone. */
export function isToday(e: Pick<OrgListingEvent, "starts_on" | "ends_on" | "timezone">, now: Date = new Date()) {
  const today = todayIn(e.timezone, now);
  return e.starts_on <= today && e.ends_on >= today;
}

/**
 * When, in one line: "Mon–Wed, Dec 7–9 · Shifts each day", "Sat, Dec 12 · 4:00 PM – 8:00 PM CST". Today's events
 * start with the time (the "Today" badge already says the day). `range` is the first start and last end of the
 * shifts still to come, if any.
 */
export function whenWords(e: Pick<OrgListingEvent, "starts_on" | "ends_on" | "timezone">, range: { start: string; end: string } | null, now: Date = new Date()) {
  const today = isToday(e, now);
  if (e.starts_on !== e.ends_on) return range ? `${daysWords(e.starts_on, e.ends_on)} · Shifts each day` : daysWords(e.starts_on, e.ends_on);
  if (!range) return today ? null : dayWords(e.starts_on);
  const times = formatTimeRange(range.start, range.end, e.timezone);
  return today ? times : `${dayWords(e.starts_on)} · ${times}`;
}

/** A shift in one line: "Today · 11:00 AM – 1:00 PM CST" or "Sat, Dec 12 · 4:00 PM – 5:30 PM CST". */
export function shiftWhen(s: Pick<OrgListingShift, "starts_at" | "ends_at">, tz: string, now: Date = new Date()) {
  const d = utcToZonedDate(s.starts_at, tz);
  return `${d === todayIn(tz, now) ? "Today" : dayWords(d)} · ${formatTimeRange(s.starts_at, s.ends_at, tz)}`;
}

export type MonthGroup<T> = { key: string; label: string; events: T[] };

/**
 * Coming up by month, in each event's time zone. Only months that have events (owner, 2026-11-21): a month with
 * nothing in it never shows. A month name that comes round again within the year gets its year.
 */
export function byMonth<T extends Pick<OrgListingEvent, "starts_on" | "timezone">>(events: T[], now: Date = new Date()): MonthGroup<T>[] {
  const dated = events.map((e, i) => ({ e, i, on: shownOn(e, now) })).sort((a, b) => a.on.localeCompare(b.on) || a.i - b.i);
  const groups: MonthGroup<T>[] = [];
  for (const { e, on } of dated) {
    const key = on.slice(0, 7);
    let g = groups.at(-1);
    if (!g || g.key !== key) {
      g = { key, label: fmt(`${key}-01`, { month: "long" }), events: [] };
      groups.push(g);
    }
    g.events.push(e);
  }
  const seen = new Set<string>();
  for (const g of groups) {
    if (seen.has(g.label)) g.label = `${g.label} ${g.key.slice(0, 4)}`;
    seen.add(g.label.split(" ")[0]);
  }
  return groups;
}

/** How many month groups start open: the first two that have events. Later ones are folded rows. */
export const OPEN_MONTHS = 2;

/** "amazon.com" from a Help anytime link (the button says where it goes). */
export function siteOf(link: string) {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The address of an event's sign-up from these links (`via` feeds the names-free count of sign-ups by source). */
export function signupHref(slug: string, via: "more" | "org", shiftId?: string | null) {
  const q = new URLSearchParams({ via });
  if (shiftId) q.set("shift", shiftId);
  return `/e/${slug}/volunteer?${q}`;
}

export type MoreWay = { type: "event"; event: OrgListingEvent } | { type: "help"; help: OrgHelp };

/** Two time ranges that share any time. */
const overlaps = (a: { starts_at: string; ends_at: string }, b: { startsAt: string; endsAt: string }) =>
  new Date(a.starts_at) < new Date(b.endsAt) && new Date(a.ends_at) > new Date(b.startsAt);

/**
 * "More ways to help" on an event's sign-up page: at most `max` items, soonest first, one per event (the listing
 * already leaves out this event, shifts this device holds, and shifts at the same time as those). Only things
 * someone can do now (an event whose sign-up opens later waits for the page). A spare slot takes the Help anytime
 * item ending soonest, when there are fewer events than slots or when everything on this page is full or closed.
 * `booked`: shifts just booked here, so a suggestion at the same time drops out. A shift already under way is never
 * offered.
 */
export function pickMoreWays(
  events: OrgListingEvent[],
  help: OrgHelp[],
  {
    max = 3,
    hereIsFull = false,
    booked = [],
    now = new Date(),
  }: { max?: number; hereIsFull?: boolean; booked?: { startsAt: string; endsAt: string }[]; now?: Date } = {},
): MoreWay[] {
  // Never a shift already under way (the database leaves them out too; this holds if a page sat open a while).
  const startedAlready = (e: OrgListingEvent) => Boolean(e.soonest_shift && new Date(e.soonest_shift.starts_at) <= now);
  const open = events.filter(
    (e) =>
      !e.opens_on &&
      ((e.soonest_shift && !startedAlready(e)) || (!e.soonest_shift && e.items_needed > 0)) &&
      !(e.soonest_shift && booked.some((b) => overlaps(e.soonest_shift!, b))),
  );
  const soonestHelp = [...help].sort((a, b) => a.ends_on.localeCompare(b.ends_on))[0];
  const room = soonestHelp && (open.length < max || hereIsFull) ? max - 1 : max;
  const ways: MoreWay[] = open.slice(0, room).map((event) => ({ type: "event", event }));
  if (soonestHelp && ways.length < max) ways.push({ type: "help", help: soonestHelp });
  return ways;
}

// The organizer's side of the organization page (docs/design-decisions/2026-11-20-organization-page.md): the words
// every organizer screen shares, so the Organization page, Event settings, the Publish step, My events, and the
// Account card say the same thing the same way (design lessons L1 and L5). Safe to import in client components;
// no imports, so `npm test` can run it directly.

/** The kinds that can be on the page (the database checks too: events_on_org_page_kind). */
export const ORG_PAGE_KINDS = ["volunteer", "fair"] as const;
export const isOrgPageKind = (type: string | null | undefined) => (ORG_PAGE_KINDS as readonly string[]).includes(type ?? "");

/** The kind's name in these lists: words that fit any group, not only schools (review, Content Manager). */
export const orgPageKindLabel = (type: string | null | undefined) => (type === "fair" ? "Fair or fundraiser" : "Volunteer event");

/** Which kinds never show, said once (Content Manager: "choir or orchestra festivals", not "festivals"). */
export const NEVER_LISTED = "Meetings, conferences, visitor days, band contests, and choir or orchestra festivals are never listed.";

/** Why turn it on (Marketing, review): on the Off state, the Account card, and nowhere it would repeat. */
export const WHY_LINE = "When a shift is full or a volunteer can't make it, their sign-up page shows your other open spots";

/**
 * The rule for new events, above the list it's about (consultant, review). What the database does: an event created
 * while the page is on, by the Account Host or a Co-host of every event, starts on (built-page review, 2026-11-21).
 */
export const NEW_EVENTS_RULE = "New events you create from now on start on your page. You can switch each one off.";

/** What the page shows, with the search-engine promise (robots noindex on /o). */
export const WHAT_SHOWS =
  "For each event: its name, kind, dates, place, and how many spots are open. Never anyone's name. We ask search engines not to list your page.";

/** Who chooses what's on the page, said one way everywhere. */
export const WHO_CHOOSES = "the Account Host or a Co-host of every event";

/** The switch's one name, everywhere (Content Manager: "Show on organization page"). */
export const SWITCH_LABEL = "Show on organization page";

/** The Co-host of one event's read-only line (Content Manager's exact words, built-page review). */
export const cohostLine = (event: string) => `Only the Account Host and Co-hosts of every event can change this. You're a Co-host of ${event} only.`;

/** "Maple Grove PTO's", "Cedar Ridge Boosters'". */
export const possessive = (name: string) => (/s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`);

/** "1 new event to review": events a Co-host of one event made while the page was on (they start off). */
export const toReview = (n: number) => (n === 1 ? "1 new event to review" : `${n} new events to review`);

/** The "Nobody is emailed" line on the Publish step, true for where the event will be found. */
export const NOBODY_EMAILED_SHOWN = "Nobody is emailed. People find it from your link, your organization page, and your other sign-up pages.";

export type OrgPageReason =
  | "teacher"
  | "account_closed"
  | "suspended"
  | "kind"
  | "page_off"
  | "switched_off"
  | "draft"
  | "over"
  | "fair_day"
  | "later"
  | "signup_closed"
  | "full";

/** event_org_page_status() (supabase/migrations/20270210000000_org_page.sql). */
export type EventOrgPageStatus = {
  page_on: boolean;
  page_slug: string | null;
  on_org_page: boolean;
  needs_review: boolean;
  can_change: boolean;
  listed: boolean;
  reason: OrgPageReason | null;
  account_host: { name: string | null; email: string } | null;
};

/** org_page_summary(). */
export type OrgPageSummary = {
  page_on: boolean;
  page_on_since: string | null;
  blocked: "teacher" | "account_closed" | "suspended" | null;
  name: string;
  slug: string | null;
  contact_email: string | null;
  events_shown: number;
  events_on: number;
  new_to_review: number;
  help_active: number;
  help_ending_soonest: { id: string; title: string; ends_on: string } | null;
};

/**
 * Why an event isn't listed, in words (null when it is). `you`: the organizer's own page ("your page"), or a
 * Co-host of one event's view ("the organization page").
 */
export function reasonWords(reason: OrgPageReason | null, opts: { needsReview?: boolean; you?: boolean; draft?: boolean } = {}): string | null {
  const page = opts.you === false ? "the organization page" : "your page";
  switch (reason) {
    case null:
      return null;
    case "teacher":
      return "Teacher accounts don't have an organization page";
    case "account_closed":
      return "This account is closed, so nothing is listed";
    case "suspended":
      return "This account is suspended, so nothing is listed";
    case "kind":
      return "Only volunteer events and fairs can be listed";
    case "page_off":
      return opts.you === false ? "The organization page is off, so it isn't listed anywhere" : "Your organization page is off, so it isn't listed anywhere";
    case "switched_off":
      // A draft can't be opened by anyone yet, so "anyone with the link" isn't said about it.
      if (opts.draft) return opts.you === false ? "Draft. Starts off the organization page when it's published" : "Draft. Starts off your page when it's published. Switch on to show it then";
      return opts.needsReview
        ? opts.you === false
          ? `Not on the organization page yet. Waiting for ${WHO_CHOOSES}`
          : "New, so it starts off your page until you choose. Anyone with the link can still open it"
        : `Not on ${page}. Anyone with the link can still open it`;
    case "draft":
      return "Draft. Shows when you publish";
    case "over":
      return "Ended, not shown";
    case "fair_day":
      return "Online sign-up closes on fair day, so it's not listed now";
    case "later":
      return "More than a year away, so it's not listed yet";
    case "signup_closed":
      return `Sign-up is closed, so it's off ${page} for now`;
    case "full":
      return `Full, so it's off ${page} for now. It comes back if a spot opens`;
  }
}

/** "2 spots open", "10 things still needed", or both, for a listed event. */
export function needWords(spots: number, items: number): string {
  const parts = [
    spots > 0 ? `${spots} ${spots === 1 ? "spot" : "spots"} open` : null,
    items > 0 ? `${items} ${items === 1 ? "thing" : "things"} still needed` : null,
  ].filter(Boolean);
  return parts.join(" and ") || "Listed";
}

/** "Mon, Jan 4" for a calendar date (no zone shifting). */
export function shortDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  // The month and day stay together on one line ("Jan 4", never "Jan" then "4").
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .replace(/ (\d+)$/, "\u00a0$1");
}

/** "Sat, Dec 12" or "Mon–Wed, Dec 7–9" style: a day, or the first and last day. */
export function dayRange(startsOn: string, endsOn: string) {
  return startsOn === endsOn ? shortDay(startsOn) : `${shortDay(startsOn)} – ${shortDay(endsOn)}`;
}

/** The day n days after a calendar date. */
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Help anytime end dates: today to a year out (the database allows today + 366). */
export const HELP_LAST_DAY_AFTER = 366;
export const HELP_TITLE_MAX = 80;
export const HELP_NOTE_MAX = 200;
export const HELP_LINK_MAX = 500;

/** Query parts that only track who clicked, or pay someone for the click (Software Engineer, review). */
const TRACKING =
  /^(tag|ref|ref_|ref_src|utm_[a-z0-9_]*|aff[a-z0-9_]*|linkcode|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_eid|mc_cid|igshid|igsh|yclid|twclid|ttclid|_ga|_gl|_hsenc|_hsmi|mkt_tok|srsltid)$/i;

export type CleanLink = { url: string | null; changed: boolean; error?: string };

/**
 * A Help anytime link as it's saved: http upgraded to https, a bare address given https://, and tracking and
 * affiliate parts taken off (tag, ref, ref_, utm_*, aff*, linkCode, and the usual click ids). Amazon's
 * "/ref=…" path part goes too. Empty is fine (the link is optional).
 */
export function cleanHelpLink(input: string | null | undefined): CleanLink {
  const raw = (input ?? "").trim();
  if (!raw) return { url: null, changed: false };
  const bad = (error: string): CleanLink => ({ url: null, changed: false, error });
  const example = "Enter a web address, like amazon.com/hz/wishlist/ABC123.";
  if (/\s/.test(raw)) return bad("Enter the link without spaces.");
  let withScheme = raw;
  if (/^http:\/\//i.test(raw)) withScheme = `https://${raw.slice(7)}`;
  else if (!/^https:\/\//i.test(raw)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/]+\.[^/]+:\d+/.test(raw)) return bad(example);
    withScheme = `https://${raw.replace(/^\/\//, "")}`;
  }
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return bad(example);
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return bad(example);
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^\d+(\.\d+)+$/.test(host)) return bad(example);
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  // Amazon puts its referral code in the path: /hz/wishlist/ls/ABC123/ref=nav_wishlist_lists_1
  u.pathname = u.pathname.replace(/\/ref=[^/]*$/i, "");
  let url = u.toString();
  url = url.replace(/\?(#|$)/, "$1");
  if (u.pathname === "/" && !u.search && !u.hash) url = url.replace(/\/$/, "");
  if (url.length > HELP_LINK_MAX) return bad("That link is too long. Use the page's shorter address.");
  return { url, changed: url !== raw };
}

/** The site a link opens, as people know it: "amazon.com" (no www). */
export function siteOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

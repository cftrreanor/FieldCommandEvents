import { formatDate, utcToZonedDate, zoneName, zonedToUtc } from "@/lib/time";

/**
 * Volunteer sign-up's state, worked out the way the database does (volunteer_signup_is_open and
 * volunteer_signup_opens_later, 20270209000000): switched on (volunteer_signup_open), with an optional day it
 * opens on (volunteer_signup_opens_on) in the event's time zone. Every badge, button, and line uses this, so a
 * sign-up that opens later never reads as open or closed anywhere (design lesson L19).
 */
export type SignupWindow = {
  status: string;
  timezone: string;
  volunteer_signup_open: boolean;
  /** Missing before the 20270209000000 update: treated as no day set. */
  volunteer_signup_opens_on?: string | null;
};

export type SignupState = "draft" | "open" | "later" | "closed";

/** Today in the event's time zone (YYYY-MM-DD). */
export function eventToday(timezone: string) {
  return utcToZonedDate(new Date().toISOString(), timezone);
}

/** The day sign-up opens, when it's still to come (null once it's here, or with no day set). */
export function signupOpensLaterOn(e: Pick<SignupWindow, "timezone" | "volunteer_signup_opens_on">): string | null {
  const d = e.volunteer_signup_opens_on ?? null;
  return d && d > eventToday(e.timezone) ? d : null;
}

export function signupState(e: SignupWindow): SignupState {
  if (e.status !== "published") return "draft";
  if (!e.volunteer_signup_open) return "closed";
  return signupOpensLaterOn(e) ? "later" : "open";
}

/** Can people sign up right now? */
export const signupIsOpen = (e: SignupWindow) => signupState(e) === "open";

/** "Mon, Jan 4": the opening day in sentences. */
export const signupDay = (d: string) => formatDate(d, { year: undefined });

/** "Jan 4": the opening day on badges and buttons. */
export const signupDayShort = (d: string) => formatDate(d, { weekday: undefined, year: undefined });

/** The badge every organizer screen shows for volunteer sign-up. */
export function signupBadge(e: SignupWindow): { tone: "live" | "neutral"; text: string } {
  const s = signupState(e);
  if (s === "draft") return { tone: "neutral", text: "Event not published" };
  if (s === "open") return { tone: "live", text: "Sign-up open" };
  if (s === "later") return { tone: "neutral", text: `Sign-up opens ${signupDayShort(e.volunteer_signup_opens_on!)}` };
  return { tone: "neutral", text: "Sign-up closed" };
}

/** The instant the opening day starts in the event's time zone (for refreshing a page when it comes). */
export const signupOpensAt = (day: string, timezone: string) => zonedToUtc(day, "00:00", timezone);

/** "12:00 AM Central Time": when the opening day starts, in the event's zone (named as the page header names it). */
export const signupOpensClock = (timezone: string) => `12:00 AM ${zoneName(timezone)}`;

/** One day before a YYYY-MM-DD day. */
const dayBefore = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * The last day sign-up can open on: the event's last day, or for a fair the day before it (online sign-up closes
 * on fair day, so a day on or after it would never come). The database keeps the same rule when copying and moving.
 */
export function signupLastDay(e: { event_type: string | null; starts_on: string; ends_on: string }) {
  return e.event_type === "fair" ? dayBefore(e.starts_on) : e.ends_on;
}

/** The one message for a day outside today to the last day it can open. */
export function signupRangeMessage(e: { event_type: string | null }, lastDay: string) {
  const d = formatDate(lastDay, { weekday: undefined, year: undefined });
  return e.event_type === "fair" ? `Pick a day from today to the day before the fair (${d}).` : `Pick a day from today to the event's last day (${d}).`;
}

/** Said after new dates moved the opening day with them. */
export const signupDayMovedLine = (day: string) => `Saved. Volunteer sign-up now opens ${signupDay(day)}, moved with the event's dates`;

/** Said after new dates left no room for the opening day, so it was cleared (sign-up stays closed). */
export const signupDayClearedLine = (live: boolean) =>
  `Saved. The new dates leave no room for the day sign-up opens, so it's cleared. ${live ? "Sign-up stays closed until you open it" : "You can pick a new day before you publish"}`;

/**
 * The hint under "Sign-up opens". `blankOpens`: on this screen a draft's Publish button opens sign-up, so a blank
 * day means it opens when published.
 */
export function signupDayHint(state: SignupState, blankOpens: boolean) {
  if (state === "draft")
    return blankOpens
      ? "Leave blank to open sign-up when you publish"
      : "Pick a day and sign-up opens by itself that day, once the event is published. Leave blank to keep it closed until you open it.";
  if (state === "later") return "Sign-up opens by itself that day. Clear it to keep sign-up closed.";
  return "Leave blank to keep sign-up closed until you open it";
}

/** The line for "?signupday=moved|cleared" after Save on new dates (updateEvent), or null. */
export function signupDayToast(kind: unknown, e: { status: string; volunteer_signup_opens_on?: string | null }) {
  if (kind === "moved" && e.volunteer_signup_opens_on) return signupDayMovedLine(e.volunteer_signup_opens_on);
  if (kind === "cleared" && !e.volunteer_signup_opens_on) return signupDayClearedLine(e.status === "published");
  return null;
}

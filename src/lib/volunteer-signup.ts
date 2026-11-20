import { formatDate, utcToZonedDate, zonedToUtc } from "@/lib/time";

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

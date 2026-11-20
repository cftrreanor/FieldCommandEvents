// Duplicate event's words and dates (owner decisions: docs/design-decisions/2026-11-20-duplicate-event.md), worked
// out once so the Duplicate page, the copy's note, the publish window, and the emails say them the same way. Pure,
// so the browser can use it too.

import { formatDate, utcToZonedDate } from "@/lib/time";

/** The kinds of event with jobs, the ones that can be duplicated. */
export const DUPLICABLE = ["volunteer", "fair", "band_contest", "group_event"] as const;
export type DuplicableKind = (typeof DUPLICABLE)[number];
export const canDuplicateKind = (type: string | null | undefined): type is DuplicableKind => DUPLICABLE.includes(type as DuplicableKind);

/** Where Duplicate event was opened from, for its back link. */
export type DuplicateFrom = "new" | "events" | "settings" | "event";
export function duplicateBack(from: string | undefined, eventId: string, kind: string): { href: string; label: string } {
  switch (from) {
    case "new":
      return { href: `/dashboard/events/new?type=${kind}`, label: "Back to New event" };
    case "events":
      return { href: "/dashboard", label: "Back to My events" };
    case "event":
      return { href: `/dashboard/events/${eventId}`, label: "Back to the event" };
    default:
      return { href: `/dashboard/events/${eventId}/edit?section=more`, label: "Back to Event settings" };
  }
}
export const duplicateHref = (eventId: string, from: DuplicateFrom) => `/dashboard/events/${eventId}/duplicate?from=${from}`;

/** "2026-11-21" plus n days. */
export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b. */
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(new Date(`${iso}T12:00:00Z`));
/** "Sat, Nov 21" */
export const dayShort = (iso: string) => formatDate(iso, { year: undefined });
/** "Sat" */
export const weekday = (iso: string) => fmt(iso, { weekday: "short" });
/** "Saturday" */
export const longWeekday = (iso: string) => fmt(iso, { weekday: "long" });
/** "November 2026" */
export const monthYear = (iso: string) => fmt(iso, { month: "long", year: "numeric" });

/** "Nov 21–22, 2026", "Nov 30 – Dec 1, 2026", or "Nov 21, 2026". */
export function shortRange(a: string, b: string) {
  if (a === b) return fmt(a, { month: "short", day: "numeric", year: "numeric" });
  if (a.slice(0, 4) !== b.slice(0, 4)) return `${fmt(a, { month: "short", day: "numeric", year: "numeric" })} – ${fmt(b, { month: "short", day: "numeric", year: "numeric" })}`;
  return a.slice(0, 7) === b.slice(0, 7)
    ? `${fmt(a, { month: "short", day: "numeric" })}–${fmt(b, { day: "numeric" })}, ${b.slice(0, 4)}`
    : `${fmt(a, { month: "short", day: "numeric" })} – ${fmt(b, { month: "short", day: "numeric", year: "numeric" })}`;
}

/** "Sat–Sun, Nov 21–22, 2026", or "Sat, Nov 21, 2026" for one day. */
export const longRange = (a: string, b: string) => (a === b ? formatDate(a) : `${weekday(a)}–${weekday(b)}, ${shortRange(a, b)}`);

/** "147 days (21 weeks)", "1 day", or "the same days" for no move. */
export function offsetWords(n: number) {
  const abs = Math.abs(n);
  if (abs === 0) return "0 days";
  return `${abs} ${abs === 1 ? "day" : "days"}${abs % 7 === 0 ? ` (${abs / 7} ${abs / 7 === 1 ? "week" : "weeks"})` : ""}${n < 0 ? " earlier" : ""}`;
}

/** "Sat and Sun" (the days of the week an event falls on). */
export const weekdays = (a: string, b: string) => (a === b ? weekday(a) : `${weekday(a)} and ${weekday(b)}`);

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "a, b, and c" */
export const listAnd = (items: string[]) => (items.length > 2 ? `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}` : items.join(" and "));

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Each kind's steps a copy brings, in the step bar's names. */
export const COPY_STEP_LABELS: Record<string, string> = {
  details: "Details",
  jobs: "Jobs and shifts",
  registration: "Band registration",
  volunteers: "Jobs and shifts",
  rooms: "Rooms and schedule",
};
export function copyStepLabel(step: string, kind: string | null | undefined) {
  if (kind === "group_event") return step === "registration" ? "Registration" : step === "volunteers" ? "Volunteers" : COPY_STEP_LABELS[step] ?? step;
  return COPY_STEP_LABELS[step] ?? step;
}
/** Where each copied step lives under the event. */
export function copyStepPath(step: string) {
  return step === "files" ? "/edit?section=files" : step === "details" ? "/edit" : step === "registration" ? "/bands" : step === "rooms" ? "/rooms" : "/volunteering";
}

/** "Not emailed yet · sent when you publish" and the rest of a copied Coordinator's ladder (dates in the event's time zone). */
export function coordinatorStatus(c: {
  status: "held" | "sent" | "expired" | "accepted";
  sent_at: string | null;
  expires_at: string | null;
  accepted_at: string | null;
  can_send: boolean;
  why_not: string | null;
}, published: boolean, planIncludes: boolean, tz = "America/Chicago"): { text: string; dot: boolean; tone: "warn" | "good" | "plain" } {
  const day = (iso: string | null) => (iso ? formatDate(utcToZonedDate(iso, tz), { weekday: undefined, year: undefined }) : "");
  switch (c.status) {
    case "accepted":
      return { text: `Accepted ${day(c.accepted_at)}`.trim(), dot: false, tone: "good" };
    case "sent":
      return {
        text: `Invitation sent ${day(c.sent_at)}${c.expires_at ? ` · works until ${day(c.expires_at)}` : ""}`,
        dot: false,
        tone: "plain",
      };
    case "expired":
      return { text: `Invitation expired ${day(c.expires_at)}`.trim(), dot: true, tone: "warn" };
    default:
      if (!planIncludes) return { text: "Not emailed · your plan doesn't include Coordinators", dot: false, tone: "plain" };
      // A full team: a freed spot doesn't send it on its own (round-2 decision): send it once there's room.
      if (!c.can_send) return { text: "Not emailed yet · needs a free team spot", dot: true, tone: "warn" };
      return { text: published ? "Not emailed yet" : "Not emailed yet · sent when you publish", dot: true, tone: "warn" };
  }
}

/** The one name for sending a copied Coordinator's invitation, wherever it's offered. */
export function sendLabel(status: "held" | "sent" | "expired" | "accepted", published: boolean) {
  return status === "held" ? (published ? "Send invitation" : "Send invitation now") : "Send a new invitation";
}

/**
 * A place on a copy still holding "[new date]" (copy_new_date_spots), counted under the page where it's fixed: its
 * step ("files" for a map or document's name, fixed in Event settings' Maps and documents), which field (`what`),
 * the job it's on, a detail (a shift's start time, a file's or option's name), and how many. `unmarked`: an old date
 * that was too long to mark ("[new date]" would have pushed the text past its limit), to change by hand.
 */
export type NewDateSpot = {
  step: string;
  what: string;
  station_id: string | null;
  job: string | null;
  detail: string | null;
  count: number;
  unmarked?: boolean;
};

/** "places": one word for where "[new date]" is ("spot" means a shift's opening). */
export const places = (n: number) => plural(n, "place", "places");

/** The step a place is counted under, in the step bar's words (Maps and documents has its own line). */
export function newDateStepLabel(step: string, kind: string | null | undefined) {
  return step === "files" ? "Maps and documents" : copyStepLabel(step, kind);
}

/**
 * What the place is, in plain words: "The description", "A Litter pickup shift (10:30 AM)", "An item in Things to
 * bring", "Map name: Park map [new date]", "Trail crew's instructions".
 */
export function newDateSpotLabel(s: NewDateSpot) {
  const job = s.job ?? "a job";
  const label = (() => {
    switch (s.what) {
      case "description":
        return "The description";
      case "file":
        return `Map name: ${s.detail ?? ""}`;
      case "document":
        return `Document name: ${s.detail ?? ""}`;
      case "director-info":
        return "The information for directors";
      case "meal-details":
        return "The meal details";
      case "meal-option":
        return `A meal option: ${s.detail ?? ""}`;
      case "contact":
        return "The contact for directors";
      case "room-name":
        return `A room's name: ${job}`;
      case "room-note":
        return `The note for ${job}`;
      case "zone":
        return `A zone's name: ${s.detail ?? ""}`;
      case "job-name":
        return `A job's name: ${job}`;
      case "location":
        return `${job}'s location`;
      case "shift":
        return `A ${job} shift${s.detail ? ` (${s.detail})` : ""}`;
      case "item":
        return "An item in Things to bring";
      default:
        return `${job}'s instructions`;
    }
  })();
  return s.unmarked ? `${label} (too long to mark: change its dates by hand)` : label;
}

/**
 * Where each "[new date]" is filled in. #new-date-[what] opens whatever the field is folded in (More options, Edit
 * shift) and puts the cursor on the marker (NewDateScroll).
 */
export function newDateSpotHref(base: string, s: NewDateSpot) {
  const path =
    s.step === "details"
      ? `${base}/edit`
      : s.step === "files"
        ? `${base}/edit?section=files`
        : s.step === "registration"
          ? `${base}/bands`
          : s.step === "rooms"
            ? `${base}/rooms`
            : s.what === "zone"
              ? `${base}/booths`
              : `${base}/volunteering${s.station_id ? `?station=${s.station_id}` : ""}`;
  const spot = s.what === "document" ? "file" : s.what;
  return `${path}#new-date-${spot}`;
}

/** "Add the new date in Details: 1 place", or "… in Details (1 place) and Jobs and shifts (2 places)". */
export function newDateBlocker(spots: NewDateSpot[], kind: string | null | undefined) {
  const by = new Map<string, number>();
  for (const s of spots) {
    const label = newDateStepLabel(s.step, kind);
    by.set(label, (by.get(label) ?? 0) + s.count);
  }
  const parts = [...by.entries()];
  if (parts.length === 1) return `Add the new date in ${parts[0][0]}: ${places(parts[0][1])}`;
  return `Add the new date in ${listAnd(parts.map(([l, n]) => `${l} (${places(n)})`))}`;
}

/** The counts a duplicate brings, worked out once (duplicateCounts) for every screen that names them. */
export type DuplicateCounts = { jobs: number; shifts: number; items: number; files: number; coordinators: number; invited: number; rooms?: number };

/** "1 map or document", "3 maps and documents". */
export const mapsAndDocuments = (n: number) => (n === 1 ? "1 map or document" : `${n} maps and documents`);

/** "2 Coordinators (1 invited again)", "1 Coordinator", in the event's own word for the role. */
export function coordinatorWords(total: number, invited: number, one = "Coordinator", many = "Coordinators") {
  return `${plural(total, one, many)}${invited > 0 && invited < total ? ` (${invited} invited again)` : invited > 0 && invited === total ? (total === 1 ? " (invited again)" : " (all invited again)") : ""}`;
}

/** What a duplicate brings, in one list for the panel, New event, the Duplicate page, and the copy. */
export function comesOverParts(kind: string | null | undefined, c: DuplicateCounts, details = true): string[] {
  return [
    details ? "its details" : "",
    kind === "band_contest" || kind === "group_event" ? "registration setup" : "",
    c.rooms ? plural(c.rooms, "room", "rooms") : "",
    c.jobs ? plural(c.jobs, "job", "jobs") : "",
    c.shifts ? plural(c.shifts, "shift", "shifts") : "",
    c.items ? plural(c.items, "thing to bring", "things to bring") : "",
    c.files ? mapsAndDocuments(c.files) : "",
    c.coordinators ? coordinatorWords(c.coordinators, c.invited) : "",
  ].filter(Boolean);
}

// Duplicate event's words and dates (owner decisions: docs/design-decisions/2026-11-20-duplicate-event.md), worked
// out once so the Duplicate page, the copy's note, the publish window, and the emails say them the same way. Pure,
// so the browser can use it too.

import { formatDate } from "@/lib/time";

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
  return step === "details" ? "/edit" : step === "registration" ? "/bands" : step === "rooms" ? "/rooms" : "/volunteering";
}

/** "Not emailed yet · sent when you publish" and the rest of a copied Coordinator's ladder. */
export function coordinatorStatus(c: {
  status: "held" | "sent" | "expired" | "accepted";
  sent_at: string | null;
  expires_at: string | null;
  accepted_at: string | null;
  can_send: boolean;
  why_not: string | null;
}, published: boolean, planIncludes: boolean): { text: string; dot: boolean; tone: "warn" | "good" | "plain" } {
  switch (c.status) {
    case "accepted":
      return { text: `Accepted ${c.accepted_at ? formatDate(c.accepted_at.slice(0, 10)) : ""}`.trim(), dot: false, tone: "good" };
    case "sent":
      return {
        text: `Invitation sent ${c.sent_at ? formatDate(c.sent_at.slice(0, 10)) : ""}${c.expires_at ? ` · works until ${formatDate(c.expires_at.slice(0, 10))}` : ""}`,
        dot: false,
        tone: "plain",
      };
    case "expired":
      // The Send again button sits beside it, so the words don't repeat it.
      return { text: `Invitation expired ${c.expires_at ? formatDate(c.expires_at.slice(0, 10)) : ""}`.trim(), dot: true, tone: "warn" };
    default:
      if (!planIncludes) return { text: "Not emailed · your plan doesn't include Coordinators", dot: false, tone: "plain" };
      // A full team: a freed spot doesn't send it on its own (round-2 decision): Send it once there's room.
      if (!c.can_send) return { text: "Not emailed yet · needs a free team spot", dot: true, tone: "warn" };
      return { text: published ? "Not emailed yet" : "Not emailed yet · sent when you publish", dot: true, tone: "warn" };
  }
}

// A contest's registration deadline (owner decision, Duplicate event follow-up, 2026-11-20): registration should
// close two weeks before contest day, so directors get their times in time to book buses. One rule for Band
// registration's deadline box and the Duplicate page's warning. The database only requires a day before contest
// day; the two weeks is what every screen recommends and names. Festivals: before the festival. Pure.

import { formatDate } from "./time.ts";

/** How long before contest day a band contest's registration should close. */
export const CONTEST_DEADLINE_DAYS = 14;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const between = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** The latest deadline the rule allows: two weeks before a band contest, the day before a festival. */
export function suggestedDeadline(kind: string | null | undefined, firstDay: string) {
  return addDays(firstDay, kind === "band_contest" ? -CONTEST_DEADLINE_DAYS : -1);
}

/**
 * Before copying a contest or festival to a day close to now: the latest deadline, how many days directors would
 * have, and plainly when that's already past or very short. Null when there's time (a week or more to register).
 */
export function contestDeadlineWarning(kind: string, firstDay: string, today: string): { head: string; body: string } | null {
  const latest = suggestedDeadline(kind, firstDay);
  const away = between(today, firstDay);
  // Days to register, counting today and the deadline itself.
  const days = between(today, latest) + 1;
  if (days > 7) return null;
  const head = away === 0 ? "That's today." : away === 1 ? "That's tomorrow." : `That's ${away} days away.`;
  const when = (d: string) => formatDate(d, { year: undefined });
  if (kind !== "band_contest") {
    if (days <= 0) return { head, body: "There's no time for directors to register before it." };
    return {
      head,
      body: `Registration has to close before the festival, by ${when(latest)} at the latest, so directors would have ${days === 1 ? "only today" : `${days} days`} to register.`,
    };
  }
  if (days <= 0)
    return {
      head,
      body: `Registration should close two weeks before contest day, so the latest deadline would be ${when(latest)}, which has passed. You can still pick a deadline up to the day before, but directors won't get their times two weeks ahead.`,
    };
  return {
    head,
    body: `Registration should close two weeks before contest day, by ${when(latest)}, so directors would have ${days === 1 ? "only today" : `${days} days`} to register.`,
  };
}

import { GRADES } from "./grades";
import { utcToZonedDate } from "./time";

// Totals for a school visitor event's Parent registration card. Only counts:
// no child's name leaves the door check-in list.

type Adult = { checked_in_at: string | null; sent_to_office_at?: string | null };
type Row = { created_at: string; adult_count: number | null; adults: unknown; children: unknown };
type Kid = { name?: string; teacher?: string; grade?: string };

/**
 * Whether a check-in counts: a practice one, made before the event's first day (in its time zone), doesn't once the
 * first day starts. The same rule as parent_check_in_counts() in the database.
 */
export function checkInCounts(at: string | null | undefined, timezone: string, startsOn: string, now = new Date()) {
  if (!at) return false;
  return utcToZonedDate(at, timezone) >= startsOn || utcToZonedDate(now.toISOString(), timezone) < startsOn;
}

export type ParentStats = ReturnType<typeof parentStats>;

export function parentStats(rows: Row[], event: { timezone: string; starts_on: string }, now = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const kids = (r: Row) => (Array.isArray(r.children) ? (r.children as Kid[]) : []);
  const people = (r: Row) => (Array.isArray(r.adults) ? (r.adults as Adult[]) : []);
  const adults = (r: Row) => Math.max(r.adult_count ?? 1, people(r).length, 1);
  // Each adult checks in on their own; a family has arrived once any of them has. Someone sent to the front office isn't in.
  const adultsIn = (r: Row) =>
    people(r).filter((a) => !a.sent_to_office_at && checkInCounts(a.checked_in_at, event.timezone, event.starts_on, now)).length;
  const arrived = rows.filter((r) => adultsIn(r) > 0);

  // Children per grade (in school order), and how many of them have a parent checked in.
  const grades = new Map<string, { children: number; arrived: number }>();
  for (const r of rows) {
    for (const k of kids(r)) {
      const g = grades.get(k.grade ?? "") ?? { children: 0, arrived: 0 };
      g.children++;
      if (adultsIn(r) > 0) g.arrived++;
      grades.set(k.grade ?? "", g);
    }
  }
  const order = (g: string) => {
    const i = (GRADES as readonly string[]).indexOf(g);
    return i === -1 ? GRADES.length : i;
  };

  // Children per teacher. Parents type the name, so "smith" and "Smith " count together.
  const teachers = new Map<string, { name: string; children: number }>();
  for (const r of rows) {
    for (const k of kids(r)) {
      let name = (k.teacher ?? "").trim().replace(/\s+/g, " ");
      // "patel" → "Patel" (names typed with capitals are left as typed).
      if (name === name.toLowerCase()) name = name.replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());
      if (!name) continue;
      const key = name.toLowerCase();
      const t = teachers.get(key) ?? { name, children: 0 };
      t.children++;
      teachers.set(key, t);
    }
  }

  return {
    families: rows.length,
    adults: rows.reduce((n, r) => n + adults(r), 0),
    children: rows.reduce((n, r) => n + kids(r).length, 0),
    newThisWeek: rows.filter((r) => r.created_at >= weekAgo).length,
    familiesArrived: arrived.length,
    adultsArrived: rows.reduce((n, r) => n + adultsIn(r), 0),
    byGrade: [...grades.entries()]
      .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
      .map(([grade, g]) => ({ grade, ...g })),
    byTeacher: [...teachers.values()].sort((a, b) => b.children - a.children || a.name.localeCompare(b.name)),
  };
}

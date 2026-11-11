// The Rooms and schedule page's working copy (client and server). The page keeps what was last saved (a
// Snapshot, with its version) and the changes made since, as a list of steps. Saving sends the result with the
// version it started from; if a co-host saved in between, the page loads theirs and puts the same steps on top
// ("Use their version and add my change"), so nothing typed is lost. Each step also says what it did, which
// becomes the change's summary for the other person.

import { pathRooms, roomTimes, type GroupPlan, type Room, type TimesMap } from "@/lib/rooms";
import { zonedToUtc } from "@/lib/time";

/** A group on the schedule: always on a day (the festival's first day when the database has none). */
export type OrderItem = GroupPlan & { day: string };

/** The schedule as last saved. */
export type Snapshot = {
  version: number;
  rooms: Room[];
  interval: number;
  passing: number;
  /** Each day's first start ("HH:MM"), by day. A day without one has no times yet. */
  starts: Record<string, string>;
  order: OrderItem[];
  posted: boolean;
};

/** A co-host saved first: what they did, and the schedule as it is now. */
export type Conflict = {
  /** The latest saver first. */
  changes: { name: string; at: string; summary: string | null }[];
  snapshot: Snapshot;
};

/** A step in the group times, kept so it can be put back on top of someone else's save. */
export type Op =
  | { k: "start"; day: string; time: string; label: string }
  | { k: "add"; bandIds: string[]; day: string; label: string }
  | { k: "move"; bandId: string; day: string; index: number; label: string }
  | { k: "skip"; bandId: string; roomId: string; on: boolean; label: string }
  | { k: "break"; bandId: string; minutes: number; label: string }
  | { k: "order"; day: string; ids: string[]; label: string }
  | { k: "drop"; bandId: string; label: string };

export type Plan = { starts: Record<string, string>; order: OrderItem[] };

/** Groups of one day, in order. */
export const onDay = (order: OrderItem[], day: string) => order.filter((o) => o.day === day);

/** The order with days kept together (in festival order), each day's groups in their own order. */
function byDays(order: OrderItem[], days: string[]) {
  return days.flatMap((d) => onDay(order, d));
}

export function applyOp(plan: Plan, op: Op, days: string[]): Plan {
  const order = plan.order;
  switch (op.k) {
    case "start":
      return { ...plan, starts: { ...plan.starts, [op.day]: op.time } };
    case "add": {
      const fresh = op.bandIds.filter((id) => !order.some((o) => o.bandId === id));
      const added = fresh.map((bandId) => ({ bandId, day: op.day, skipped: [], extraMinutes: 0 }));
      return { ...plan, order: byDays([...order, ...added], days) };
    }
    case "move": {
      const item = order.find((o) => o.bandId === op.bandId);
      if (!item) return plan;
      const rest = order.filter((o) => o.bandId !== op.bandId);
      const target = onDay(rest, op.day);
      const at = Math.max(0, Math.min(op.index, target.length));
      const moved = { ...item, day: op.day };
      const nextDay = [...target.slice(0, at), moved, ...target.slice(at)];
      return { ...plan, order: days.flatMap((d) => (d === op.day ? nextDay : onDay(rest, d))) };
    }
    case "skip":
      return {
        ...plan,
        order: order.map((o) =>
          o.bandId !== op.bandId
            ? o
            : { ...o, skipped: op.on ? [...new Set([...o.skipped, op.roomId])] : o.skipped.filter((r) => r !== op.roomId) },
        ),
      };
    case "break":
      return { ...plan, order: order.map((o) => (o.bandId === op.bandId ? { ...o, extraMinutes: op.minutes } : o)) };
    case "order": {
      const today = onDay(order, op.day);
      const known = op.ids.flatMap((id) => today.filter((o) => o.bandId === id));
      const rest = today.filter((o) => !op.ids.includes(o.bandId));
      const nextDay = [...known, ...rest];
      return { ...plan, order: days.flatMap((d) => (d === op.day ? nextDay : onDay(order, d))) };
    }
    case "drop":
      return { ...plan, order: order.filter((o) => o.bandId !== op.bandId) };
  }
}

export const applyOps = (plan: Plan, ops: Op[], days: string[]) => ops.reduce((p, op) => applyOp(p, op, days), plan);

/** A short summary of the steps ("Moved Riverside Orchestra to Sunday; Break before Summit Treble Choir"), at most 500 characters. */
export function summarize(labels: string[]) {
  const unique = labels.filter((l, i) => labels.indexOf(l) === i);
  const text = unique.length > 4 ? `${unique.slice(0, 4).join("; ")}; and ${unique.length - 4} more` : unique.join("; ");
  return text.slice(0, 480);
}

/** Every group's times for a plan (each day from its own first start). */
export function planTimes(plan: Plan, rooms: Room[], interval: number, passing: number, days: string[], tz: string): TimesMap {
  const starts: Record<string, Date> = {};
  for (const d of days) if (plan.starts[d]) starts[d] = zonedToUtc(d, plan.starts[d], tz);
  // Every group carries its day, so the "first day" fallback never applies.
  return roomTimes(new Date(0), interval, passing, rooms, plan.order, { firstDay: "", starts });
}

/** The rooms every group visits, as names by id (rooms outside the rotation too). */
export const roomNameMap = (rooms: Room[]) => new Map(rooms.map((r) => [r.id, r.name]));

export { pathRooms };

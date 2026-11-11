// Group events: rooms, the path every group follows, and each group's
// times. The same arithmetic as rebuild_room_slots() in
// supabase/migrations/20270129000000_group_festival_update.sql, so the schedule
// builder can preview times before saving.

export type Room = { id: string; name: string; note: string | null; path_order: number | null; minutes: number };

export type GroupPlan = {
  bandId: string;
  /** Rooms on the path this group doesn't visit. */
  skipped: string[];
  /** A break before this group (pushes it and everyone after it later that day). */
  extraMinutes: number;
  /** The festival day this group is on (YYYY-MM-DD); missing means the first day. */
  day?: string | null;
};

/** Two-day festivals: the first day, and each other day's first start. */
export type ScheduleDays = { firstDay: string; starts: Record<string, Date> };

export type RoomTime = { roomId: string; startsAt: Date; endsAt: Date };

/** The rooms every group visits, in order. */
export const pathRooms = (rooms: Room[]) =>
  rooms.filter((r) => r.path_order != null).sort((a, b) => a.path_order! - b.path_order!);

/**
 * Each group's time in each room, in path order. Groups count a day at a time: each day starts at its own first
 * start, and breaks only push later groups that day.
 */
export function roomTimes(
  start: Date,
  intervalMinutes: number,
  passingMinutes: number,
  rooms: Room[],
  order: GroupPlan[],
  days?: ScheduleDays,
): Map<string, RoomTime[]> {
  const path = pathRooms(rooms);
  const out = new Map<string, RoomTime[]>();
  const dayOf = (c: GroupPlan) => c.day ?? days?.firstDay ?? "";
  // The database orders by day, then position; a stable sort keeps the positions within each day.
  const sorted = [...order].sort((a, b) => (dayOf(a) < dayOf(b) ? -1 : dayOf(a) > dayOf(b) ? 1 : 0));
  let curDay: string | null = null;
  let idx = 0;
  let breaks = 0;
  let dayStart: Date | null = null;
  for (const c of sorted) {
    if (dayOf(c) !== curDay) {
      curDay = dayOf(c);
      idx = 0;
      breaks = 0;
      dayStart = days?.starts[curDay] ?? (!days || curDay === days.firstDay ? start : null);
    }
    breaks += c.extraMinutes;
    const times: RoomTime[] = [];
    if (dayStart) {
      const base = dayStart.getTime() + (idx * intervalMinutes + breaks) * 60_000;
      let offset = 0;
      for (const r of path) {
        // A skipped room keeps its place in time, so rooms never double-book.
        if (!c.skipped.includes(r.id)) {
          times.push({
            roomId: r.id,
            startsAt: new Date(base + offset * 60_000),
            endsAt: new Date(base + (offset + r.minutes) * 60_000),
          });
        }
        offset += r.minutes + passingMinutes;
      }
    }
    out.set(c.bandId, times);
    idx += 1;
  }
  return out;
}

/** Groups start one interval apart; a room longer than that would hold two groups at once. */
export const tooLongRooms = (rooms: Room[], intervalMinutes: number) =>
  pathRooms(rooms).filter((r) => r.minutes > intervalMinutes);

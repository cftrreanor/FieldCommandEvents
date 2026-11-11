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

// ---------------------------------------------------------------------------------------------------------------
// Rooms and schedule page, and the schedule emails (build 2b, 2026-11-11): words for times, what changed, and
// directors' requests. Pure, so the page (before saving) and the server (for the emails) say the same thing.

/** "8:00 AM", in the festival's time zone. */
export const clock = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);

/** "8:00–8:15 AM" (or "11:45 AM–12:05 PM"); `to` gives "8:00 to 8:15 AM" for emails. */
export function span(start: Date, end: Date, tz: string, sep = "–") {
  const a = clock(start, tz);
  const b = clock(end, tz);
  const [, am] = a.split(" ");
  const [, bm] = b.split(" ");
  return am === bm ? `${a.replace(` ${am}`, "")}${sep}${b}` : `${a}${sep}${b}`;
}

/** The festival day ("2027-03-20") a time falls on, in its time zone. */
export const dayOf = (d: Date, tz: string) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p.slice(0, 10);
};

/** Minutes since midnight of a time, in the festival's time zone. */
const minutesOfDay = (d: Date, tz: string) => {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(d)
    .split(":")
    .map(Number);
  return h * 60 + m;
};

/** "09:00" or "09:00:00" → "9:00 AM". */
export function wallClock(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "Saturday" from "2027-03-20". */
export const weekday = (day: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(`${day}T12:00:00Z`));

/** "Sat, Mar 20" from "2027-03-20". */
export const shortDay = (day: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));

/** "Saturday, March 20" from "2027-03-20". */
export const longDay = (day: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));

export type TimesMap = Map<string, RoomTime[]>;

/**
 * What changed for each group between two versions of the schedule, in words, for the "Save the new times?" window
 * and the "New times" email: "Sight-reading 8:50 AM (was 8:45 AM)", "every room 10 minutes later", "no times now".
 * Only groups whose times changed are listed, in the order of `ids`.
 */
export function timeChanges(
  before: TimesMap,
  after: TimesMap,
  roomNames: Map<string, string>,
  tz: string,
  ids: string[],
  days: { multi: boolean },
): { bandId: string; text: string }[] {
  const out: { bandId: string; text: string }[] = [];
  const key = (t: RoomTime) => `${t.roomId}|${t.startsAt.getTime()}|${t.endsAt.getTime()}`;
  const name = (id: string) => roomNames.get(id) ?? "A room";
  for (const id of ids) {
    const a = before.get(id) ?? [];
    const b = after.get(id) ?? [];
    if (a.map(key).sort().join(",") === b.map(key).sort().join(",")) continue;
    const list = (ts: RoomTime[]) => ts.map((t) => `${name(t.roomId)} ${clock(t.startsAt, tz)}`).join(", ");
    if (!b.length) {
      out.push({ bandId: id, text: `no times now (was ${list(a)})` });
      continue;
    }
    if (!a.length) {
      out.push({ bandId: id, text: `new times: ${list(b)}` });
      continue;
    }
    const dayA = dayOf(a[0].startsAt, tz);
    const dayB = dayOf(b[0].startsAt, tz);
    if (days.multi && dayA !== dayB) {
      out.push({ bandId: id, text: `now on ${weekday(dayB)}: ${list(b)}` });
      continue;
    }
    // The same rooms, all moved by the same minutes (a push back or a break).
    const sameRooms = a.length === b.length && a.every((t, i) => t.roomId === b[i].roomId);
    if (sameRooms) {
      const shifts = a.map((t, i) => [b[i].startsAt.getTime() - t.startsAt.getTime(), b[i].endsAt.getTime() - t.endsAt.getTime()]);
      const d = shifts[0][0];
      if (d !== 0 && shifts.every(([s, e]) => s === d && e === d) && a.length > 1) {
        const m = Math.abs(d) / 60_000;
        out.push({ bandId: id, text: `every room ${m} ${m === 1 ? "minute" : "minutes"} ${d > 0 ? "later" : "earlier"}` });
        continue;
      }
    }
    const parts: string[] = [];
    const byRoomA = new Map(a.map((t) => [t.roomId, t]));
    const byRoomB = new Map(b.map((t) => [t.roomId, t]));
    for (const t of b) {
      const old = byRoomA.get(t.roomId);
      if (!old) parts.push(`${name(t.roomId)} ${clock(t.startsAt, tz)} (added)`);
      else if (old.startsAt.getTime() !== t.startsAt.getTime()) parts.push(`${name(t.roomId)} ${clock(t.startsAt, tz)} (was ${clock(old.startsAt, tz)})`);
      else if (old.endsAt.getTime() !== t.endsAt.getTime()) parts.push(`${name(t.roomId)} until ${clock(t.endsAt, tz)} (was ${clock(old.endsAt, tz)})`);
    }
    for (const t of a) if (!byRoomB.has(t.roomId)) parts.push(`no ${name(t.roomId)} time (was ${clock(t.startsAt, tz)})`);
    out.push({ bandId: id, text: parts.join(", ") });
  }
  return out;
}

/** Slots from the database, as times by group. */
export function slotsToTimes(slots: { room_id: string; band_id: string; starts_at: string; ends_at: string }[], pathOrder: Map<string, number>): TimesMap {
  const out: TimesMap = new Map();
  for (const s of slots) {
    const list = out.get(s.band_id) ?? [];
    list.push({ roomId: s.room_id, startsAt: new Date(s.starts_at), endsAt: new Date(s.ends_at) });
    out.set(s.band_id, list);
  }
  for (const list of out.values()) list.sort((x, y) => (pathOrder.get(x.roomId) ?? 0) - (pathOrder.get(y.roomId) ?? 0) || x.startsAt.getTime() - y.startsAt.getTime());
  return out;
}

/** When a group's director said it can come: a day (two-day festivals), earliest start, and latest finish ("HH:MM"). */
export type GroupRequest = { day: string | null; earliest: string | null; latest: string | null };

/**
 * A director's request against the group's times: met (a check line naming it), or broken (naming the clash).
 * Null when there's no request, or no times to check yet.
 */
export function checkRequest(
  req: GroupRequest,
  times: RoomTime[],
  roomNames: Map<string, string>,
  tz: string,
  multiDay: boolean,
): { ok: boolean; text: string } | null {
  const day = multiDay ? req.day : null;
  if (!day && !req.earliest && !req.latest) return null;
  if (!times.length) return null;
  const first = times[0];
  const last = times.reduce((x, t) => (t.endsAt > x.endsAt ? t : x), times[0]);
  const on = dayOf(first.startsAt, tz);
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  if (day && on !== day) return { ok: false, text: `Their director asked for ${weekday(day)}. They're on ${weekday(on)}.` };
  if (req.earliest && minutesOfDay(first.startsAt, tz) < toMin(req.earliest)) {
    return {
      ok: false,
      text: `Their director asked to start no earlier than ${wallClock(req.earliest)}. ${roomNames.get(first.roomId) ?? "Their first room"} starts at ${clock(first.startsAt, tz)}.`,
    };
  }
  if (req.latest && (minutesOfDay(last.endsAt, tz) > toMin(req.latest) || dayOf(last.endsAt, tz) !== on)) {
    return {
      ok: false,
      text: `Their director asked to finish by ${wallClock(req.latest)}. ${roomNames.get(last.roomId) ?? "Their last room"} ends at ${clock(last.endsAt, tz)}.`,
    };
  }
  const parts = [
    day ? `${weekday(day)} only` : null,
    req.earliest ? `not before ${wallClock(req.earliest)}` : null,
    req.latest ? `finish by ${wallClock(req.latest)}` : null,
  ].filter(Boolean);
  return { ok: true, text: `Director's request met: ${parts.join(" · ")}` };
}

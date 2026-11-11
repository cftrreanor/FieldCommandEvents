// Festivals on the day (build 3, 2026-11-11): each group's state from the posted times and the team's marks, and
// each room's "Now" and "Up next". One rule (light check, round 2): "Now" comes only from the team's marks, and a
// group past its start in a room with no mark is "Not marked in [room]", never "late". Pure, so the team's Event day,
// a room's page, the door page, and the public page all say the same thing.
//
// Marks (group_checkins.kind): room null + 'done' = arrived; 'no_show' (room null) = didn't come; 'in' + a room = in
// that room (it stays after 'done', so a group is in a room now when it has 'in' and no 'done' there); 'done' + a
// room = done there. An 'in' row is never "done".

export type MarkKind = "in" | "done" | "no_show";
export type Mark = { band_id: string; room_id: string | null; kind: MarkKind | string; created_at: string; actor_name?: string | null };
export type Slot = { room_id: string; band_id: string; starts_at: string; ends_at: string };
export type DayRoom = { id: string; name: string; note: string | null; path_order: number };

/** One mark to set or take back. */
export type MarkOp = { band: string; room: string | null; kind: MarkKind; on: boolean };

/** The next tap for a group: its button words, what it marks, and what Undo puts back. */
export type Tap = { label: string; ops: MarkOp[]; undo: MarkOp[]; did: string };

export type Tone = "info" | "neutral" | "warning" | "success";

export type GroupState = {
  bandId: string;
  /** In time order. */
  rooms: { slot: Slot; in: Mark | null; done: Mark | null }[];
  arrived: Mark | null;
  noShow: Mark | null;
  /** In a room now (marked in, not done there). */
  current: { slot: Slot; in: Mark } | null;
  /** The first room not done yet, after the current one. */
  next: Slot | null;
  finished: boolean;
  status: { text: string; tone: Tone };
  /** One line about where the group stands. */
  line: string;
  /** The main next tap, and a second choice ("Didn't come") for a group not here yet. */
  tap: Tap | null;
  alt: Tap | null;
};

const MIN = 60_000;

/** "Warm-up room and Performance hall" / "A, B, and C". */
export function listWords(items: string[]) {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

const byKind = (marks: Mark[], band: string, room: string | null, kind: MarkKind) =>
  marks.find((m) => m.band_id === band && (m.room_id ?? null) === room && m.kind === kind) ?? null;

/** "8:31 AM by Maria Chen" (the name only when there is one). */
const stamp = (m: Mark, time: (iso: string) => string) =>
  `${time(m.created_at)}${!m.actor_name ? "" : m.actor_name.startsWith("At the door of ") ? ` at ${m.actor_name.slice(3)}` : ` by ${m.actor_name}`}`;

/**
 * One group's state. `live` is true when the day shown is today in the festival's time zone: only then do times
 * that have passed say "Not marked in". `roomName` names a room from its id.
 */
export function groupState({
  bandId,
  slots,
  marks,
  now,
  live,
  roomName,
  time,
}: {
  bandId: string;
  slots: Slot[];
  marks: Mark[];
  now: Date;
  live: boolean;
  roomName: (id: string) => string;
  time: (iso: string) => string;
}): GroupState {
  const mine = slots.filter((s) => s.band_id === bandId).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const rooms = mine.map((slot) => ({ slot, in: byKind(marks, bandId, slot.room_id, "in"), done: byKind(marks, bandId, slot.room_id, "done") }));
  const arrived = byKind(marks, bandId, null, "done");
  const noShow = byKind(marks, bandId, null, "no_show");
  const inNow = rooms.filter((r) => r.in && !r.done).sort((a, b) => b.in!.created_at.localeCompare(a.in!.created_at))[0];
  const current = inNow ? { slot: inNow.slot, in: inNow.in! } : null;
  const next = rooms.find((r) => !r.done && r.slot !== current?.slot)?.slot ?? null;
  const finished = rooms.length > 0 && rooms.every((r) => r.done);
  const t = now.getTime();
  const past = (iso: string) => live && t >= new Date(iso).getTime();

  const arriveTap: Tap = {
    label: "Mark arrived",
    did: "arrived",
    ops: [{ band: bandId, room: null, kind: "done", on: true }],
    undo: [
      { band: bandId, room: null, kind: "done", on: false },
      ...(noShow ? [{ band: bandId, room: null, kind: "no_show" as const, on: true }] : []),
    ],
  };
  const noShowTap: Tap = {
    label: "Didn't come",
    did: "didn't come",
    ops: [{ band: bandId, room: null, kind: "no_show", on: true }],
    undo: [{ band: bandId, room: null, kind: "no_show", on: false }],
  };
  const inTap = (s: Slot): Tap => ({
    label: `Mark in ${roomName(s.room_id)}`,
    did: `in ${roomName(s.room_id)}`,
    ops: [{ band: bandId, room: s.room_id, kind: "in", on: true }],
    undo: [{ band: bandId, room: s.room_id, kind: "in", on: false }],
  });
  // Done keeps the "in" mark (20270131000000), so Undo only takes the done mark back.
  const doneTap = (s: Slot): Tap => ({
    label: `Mark done in ${roomName(s.room_id)}`,
    did: `done in ${roomName(s.room_id)}`,
    ops: [{ band: bandId, room: s.room_id, kind: "done", on: true }],
    undo: [{ band: bandId, room: s.room_id, kind: "done", on: false }],
  });

  const base = { bandId, rooms, arrived, noShow, current, next, finished };
  if (noShow && !arrived) {
    return { ...base, status: { text: "Didn't come", tone: "neutral" }, line: `Marked didn't come ${stamp(noShow, time)}`, tap: arriveTap, alt: null };
  }
  if (!rooms.length) {
    return {
      ...base,
      status: { text: "No times yet", tone: "neutral" },
      line: arrived ? `Marked arrived ${stamp(arrived, time)} · no times yet` : "No times yet",
      tap: arrived ? null : arriveTap,
      alt: null,
    };
  }
  if (finished) {
    const last = rooms.reduce((x, r) => (r.done!.created_at > x.done!.created_at ? r : x), rooms[0]);
    return { ...base, status: { text: "Done", tone: "success" }, line: `Done in every room · last marked ${stamp(last.done!, time)}`, tap: null, alt: null };
  }
  if (current) {
    const late = Math.round((new Date(current.in.created_at).getTime() - new Date(current.slot.starts_at).getTime()) / MIN);
    return {
      ...base,
      status: late >= 1 ? { text: `${late >= 60 ? `${Math.floor(late / 60)} hr ${late % 60} min` : `${late} min`} behind`, tone: "warning" } : { text: "On time", tone: "info" },
      line: `In ${roomName(current.slot.room_id)} since ${stamp(current.in, time)}`,
      tap: doneTap(current.slot),
      alt: null,
    };
  }
  if (!arrived) {
    const first = rooms[0].slot;
    return {
      ...base,
      status: past(first.starts_at) ? { text: `Not marked in ${roomName(first.room_id)}`, tone: "warning" } : { text: "Not here yet", tone: "neutral" },
      line: `Not here yet · ${roomName(first.room_id)} at ${time(first.starts_at)}`,
      tap: arriveTap,
      alt: noShowTap,
    };
  }
  // Here, between rooms: the next room is the next tap.
  const doneNames = rooms.filter((r) => r.done).map((r) => roomName(r.slot.room_id));
  const where = doneNames.length ? `Done in ${listWords(doneNames)}` : `Marked arrived ${stamp(arrived, time)}`;
  return {
    ...base,
    status: next && past(next.starts_at) ? { text: `Not marked in ${roomName(next.room_id)}`, tone: "warning" } : { text: "On time", tone: "info" },
    line: next ? `${where} · next: ${roomName(next.room_id)} at ${time(next.starts_at)}` : where,
    tap: next ? inTap(next) : null,
    alt: null,
  };
}

/**
 * A room's "Now" (only from a mark: a group marked in and not done there) and "Up next" (the first group with a
 * time there that day that isn't done, in, or marked didn't come). Give it one day's slots only, so "Up next" never
 * crosses into another day.
 */
export function roomNowNext(roomId: string, daySlots: Slot[], marks: Mark[]) {
  const here = daySlots.filter((s) => s.room_id === roomId).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const isIn = (b: string) => byKind(marks, b, roomId, "in");
  const isDone = (b: string) => byKind(marks, b, roomId, "done");
  const gone = (b: string) => byKind(marks, b, null, "no_show") && !byKind(marks, b, null, "done");
  const nowList = here.filter((s) => isIn(s.band_id) && !isDone(s.band_id)).sort((a, b) => isIn(b.band_id)!.created_at.localeCompare(isIn(a.band_id)!.created_at));
  const now = nowList[0] ? { slot: nowList[0], since: isIn(nowList[0].band_id)!.created_at } : null;
  const next = here.find((s) => !isDone(s.band_id) && !isIn(s.band_id) && !gone(s.band_id)) ?? null;
  return { now, next, list: here };
}

/** A group's state in one room, for a room's list: "Done", "In now", "Arrived", "Not here yet", or "Didn't come". */
export function roomRowState(bandId: string, roomId: string, marks: Mark[]): { text: string; tone: Tone } {
  if (byKind(marks, bandId, roomId, "done")) return { text: "Done", tone: "success" };
  if (byKind(marks, bandId, roomId, "in")) return { text: "In now", tone: "info" };
  if (byKind(marks, bandId, null, "done")) return { text: "Arrived", tone: "neutral" };
  if (byKind(marks, bandId, null, "no_show")) return { text: "Didn't come", tone: "neutral" };
  return { text: "Not here yet", tone: "neutral" };
}

/** The festival day (YYYY-MM-DD) a group is on: from its times, else its saved day, else the first day. */
export function groupDayOf(bandId: string, slots: Slot[], savedDay: string | null | undefined, firstDay: string, dayOf: (iso: string) => string) {
  const first = slots.filter((s) => s.band_id === bandId).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  return first ? dayOf(first.starts_at) : (savedDay ?? firstDay);
}

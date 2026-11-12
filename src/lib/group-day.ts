// Group events on the day: who's arrived and how each group is doing in each
// room, from the team's taps (group_checkins) and the posted times
// (room_slots). Shared by the Event day page and the event's main page.

export type GroupSlot = { room_id: string; band_id: string; starts_at: string; ends_at: string };
/** `kind`: 'done' (room null = arrived), 'in' (in a room now), 'no_show'. Only 'done' rows count as arrived or done. */
export type GroupCheckin = { band_id: string; room_id: string | null; created_at: string; actor_name: string | null; kind?: string };

/** done: tapped · behind: its time is over and it isn't done · now: on now · upcoming. */
export type RoomState = "done" | "behind" | "now" | "upcoming";
/**
 * here: tapped in · late: not here, not marked didn't come, and their first room started more than
 * LATE_GRACE_MINUTES ago (someone should find them) · soon: due within ARRIVE_SOON_MINUTES.
 */
export type ArrivalState = "here" | "late" | "soon" | "waiting";

export const ARRIVE_SOON_MINUTES = 30;
/** A few minutes either way is on time: nothing is flagged until a group is this late (light check, 2026-11-11). */
export const LATE_GRACE_MINUTES = 5;

export type GroupDay = {
  bandId: string;
  arrival: ArrivalState;
  arrivedAt: GroupCheckin | null;
  /** In time order. */
  rooms: { slot: GroupSlot; state: RoomState; doneAt: GroupCheckin | null }[];
};

/**
 * Every scheduled group, in the order they start. `live` is false outside the
 * event's days, so nothing reads as late before or after the event.
 */
export function groupDay(slots: GroupSlot[], checkins: GroupCheckin[], now: Date, live: boolean): GroupDay[] {
  const t = now.getTime();
  const byBand = new Map<string, GroupSlot[]>();
  for (const s of [...slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    byBand.set(s.band_id, [...(byBand.get(s.band_id) ?? []), s]);
  }
  const tap = (band: string, room: string | null) =>
    checkins.find((c) => c.band_id === band && c.room_id === room && (c.kind ?? "done") === "done") ?? null;
  return [...byBand.entries()].map(([bandId, mine]) => {
    const arrivedAt = tap(bandId, null);
    const noShow = checkins.some((c) => c.band_id === bandId && c.room_id === null && c.kind === "no_show");
    const first = new Date(mine[0].starts_at).getTime();
    const arrival: ArrivalState = arrivedAt
      ? "here"
      : live && !noShow && t >= first + LATE_GRACE_MINUTES * 60_000
        ? "late"
        : live && t >= first - ARRIVE_SOON_MINUTES * 60_000
          ? "soon"
          : "waiting";
    return {
      bandId,
      arrival,
      arrivedAt,
      rooms: mine.map((slot) => {
        const doneAt = tap(bandId, slot.room_id);
        const start = new Date(slot.starts_at).getTime();
        const end = new Date(slot.ends_at).getTime();
        const state: RoomState = doneAt ? "done" : live && t >= end ? "behind" : live && t >= start ? "now" : "upcoming";
        return { slot, state, doneAt };
      }),
    };
  });
}

/** For the status line: how many groups are here, and who needs attention. */
export function groupDaySummary(days: GroupDay[]) {
  return {
    total: days.length,
    here: days.filter((d) => d.arrival === "here").length,
    late: days.filter((d) => d.arrival === "late"),
    behind: days.flatMap((d) => d.rooms.filter((r) => r.state === "behind").map((r) => ({ bandId: d.bandId, slot: r.slot }))),
    finished: days.filter((d) => d.rooms.every((r) => r.state === "done")).length,
  };
}

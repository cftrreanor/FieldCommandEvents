// A director's day at a glance: their steps (band contest check-in path, or a
// group's arrival and rooms), what's next, and whether they're on time.
// Shared by the director's page and their dashboard.

import { readyAt } from "@/lib/bands";
import { dueAt, DUE_SOON_MINUTES, sortStations, type BandDay, type Checkpoint, type Round, type Stop } from "@/lib/contest-day";

/** `at`: a start time (warm-up, performance, a room); otherwise a deadline ("by"). */
export type DayStep = { key: string; label: string; done: string | null; due: string | null; where?: string | null; at?: boolean };

/** One row of my_band_progress(): a stop on the path, and the band's tap there (if any). */
export type ProgressRow = Checkpoint & { station_id: string; round: Round | null; performed: boolean; reached_at: string | null };
export type DayTimes = { warm_up_at: string | null; warm_up_minutes: number | null; perform_at: string | null; warm_up_location: string | null } | null;

/** Band contests: the host's check-in path, in order, for the round the band is in. */
export function bandSteps({
  band,
  rows,
  prelims,
  finals,
  readyMinutes,
  finalsReadyMinutes,
  time,
}: {
  band: BandDay;
  rows: ProgressRow[];
  prelims: DayTimes;
  /** Only once the finalists are revealed. */
  finals: DayTimes;
  readyMinutes: number;
  finalsReadyMinutes: number;
  time: (iso: string) => string;
}): { steps: DayStep[]; round: Round } {
  const path = sortStations([...new Map(rows.map((r) => [r.station_id, { ...r, id: r.station_id }])).values()]);
  const stops: Stop[] = rows
    .filter((r) => r.reached_at)
    .map((r) => ({ band_id: band.id, station_id: r.station_id, round: r.round, performed: r.performed, reached_at: r.reached_at! }));
  const tapped = (station: Checkpoint, round: Round | null, performed = false) =>
    stops.find((s) => s.station_id === station.id && s.performed === performed && (round === null ? s.round === null : s.round === round))
      ?.reached_at ?? null;
  // A finalist moves on to the finals path once they've performed in prelims.
  const prelimsDone = path.some((c) => c.checkpoint_kind === "gate" && tapped(c, "prelims", true));
  const round: Round = finals && prelimsDone ? "finals" : "prelims";
  const slot = round === "finals" ? finals : prelims;
  const ready = round === "finals" ? finalsReadyMinutes : readyMinutes;

  const steps = path.flatMap((c): DayStep[] => {
    switch (c.checkpoint_kind) {
      case "parking": {
        const parked = band.buses_at || band.equipment_at;
        const bits = [
          band.buses_at ? `Buses ${time(band.buses_at)}` : null,
          band.equipment_at ? `Equipment${band.equipment_spot ? ` in Spot ${band.equipment_spot}` : ` ${time(band.equipment_at)}`}` : null,
        ].filter(Boolean);
        return [{ key: c.id, label: "Park buses and equipment", done: parked ? bits.join(" · ") : null, due: dueAt(c, prelims ?? undefined, readyMinutes) }];
      }
      case "stop": {
        const at = tapped(c, null);
        return [{ key: c.id, label: c.name, done: at && `Here ${time(at)}`, due: dueAt(c, prelims ?? undefined, readyMinutes) }];
      }
      case "warm_up": {
        const at = tapped(c, round);
        return [{ key: c.id, label: "Warm-up", done: at && `Started ${time(at)}`, due: slot?.warm_up_at ?? null, where: slot?.warm_up_location, at: true }];
      }
      case "gate": {
        const at = tapped(c, round);
        const performed = tapped(c, round, true);
        return [
          { key: c.id, label: `At ${c.name}`, done: at && `Here ${time(at)}`, due: slot?.perform_at ? readyAt(slot.perform_at, ready) : null },
          { key: `${c.id}-performed`, label: "Perform", done: performed && `Done ${time(performed)}`, due: slot?.perform_at ?? null, at: true },
        ];
      }
    }
  });
  return { steps, round };
}

/** Group events: arrive, then each room on the group's path. */
export function groupSteps({
  slots,
  rooms,
  checkins,
  time,
}: {
  slots: { room_id: string; starts_at: string; ends_at: string }[];
  rooms: Map<string, { name: string; note: string | null }>;
  /** The team's marks for this group; only 'done' rows (arrived, done in a room) count here. */
  checkins: { room_id: string | null; created_at: string; kind?: string }[];
  time: (iso: string) => string;
}): DayStep[] {
  const mine = [...slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (!mine.length) return [];
  const tap = (room: string | null) => checkins.find((c) => c.room_id === room && (c.kind ?? "done") === "done")?.created_at ?? null;
  const arrived = tap(null);
  return [
    { key: "arrive", label: "Check in when you arrive", done: arrived && `Checked in ${time(arrived)}`, due: mine[0].starts_at },
    ...mine.map((s) => {
      const done = tap(s.room_id);
      const room = rooms.get(s.room_id);
      return {
        key: s.room_id,
        label: room?.name ?? "Room",
        done: done && `Done ${time(done)}`,
        due: s.starts_at,
        where: room?.note,
        at: true,
      };
    }),
  ];
}

export type DayTone = "green" | "gold" | "red" | "now" | "done";
export type DayStatus = { tone: DayTone; title: string; detail: string | null; next: DayStep | undefined; done: number; total: number };

/**
 * At a glance: green (on track), gold (next step within DUE_SOON_MINUTES),
 * "now" (a start time has come and the step before it is done), red (a
 * deadline has passed, or a start time with the step before it not done),
 * done (every step done).
 */
export function dayStatus(steps: DayStep[], now: Date, time: (iso: string) => string): DayStatus {
  const i = steps.findIndex((s) => !s.done);
  const next = i < 0 ? undefined : steps[i];
  const done = steps.filter((s) => s.done).length;
  const base = { next, done, total: steps.length };
  if (!next) return { ...base, tone: "done", title: "All done", detail: null };
  const where = next.where ? ` · ${next.where}` : "";
  if (!next.due) return { ...base, tone: "green", title: `Next: ${next.label}`, detail: next.where ?? null };
  const minutes = Math.round((new Date(next.due).getTime() - now.getTime()) / 60_000);
  const when = `${next.at ? "at" : "by"} ${time(next.due)}`;
  if (minutes < 0) {
    const ready = next.at && (i === 0 || steps[i - 1].done);
    if (ready) return { ...base, tone: "now", title: `Now: ${next.label}`, detail: `Started ${time(next.due)}${where}` };
    const ago = -minutes;
    return {
      ...base,
      tone: "red",
      title: `Running late: ${next.label}`,
      detail: `Due ${when} (${ago < 60 ? `${ago} min` : `${Math.floor(ago / 60)} hr ${ago % 60} min`} ago)${where}`,
    };
  }
  if (minutes <= DUE_SOON_MINUTES) {
    return { ...base, tone: "gold", title: `Coming up: ${next.label}`, detail: `${when[0].toUpperCase()}${when.slice(1)}, in ${minutes} min${where}` };
  }
  return { ...base, tone: "green", title: `On track · Next: ${next.label}`, detail: `${when[0].toUpperCase()}${when.slice(1)}${where}` };
}

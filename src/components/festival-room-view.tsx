"use client";

import type { ReactNode } from "react";
import { useTaps } from "@/components/festival-undo";
import { Badge, Button } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import type { Tone } from "@/lib/festival-day";

export type RoomRow = {
  bandId: string;
  name: string;
  /** Shown on the team's page only; the door page leaves it out. */
  school?: string;
  time: string;
  state: { text: string; tone: Tone };
  /** Marked in or done here: no "Mark in" button. */
  marked: boolean;
};

const BADGE: Record<Tone, "info" | "neutral" | "warning" | "success"> = { info: "info", neutral: "neutral", warning: "warning", success: "success" };

/**
 * One room on the day (board 14), for whoever is at its door: who's in now and since when, one big button for the
 * hand-off, and the room's list with times and states. The team's page and the door page share it; each passes its
 * own way to mark (the team's marks, or the door link's).
 */
export function FestivalRoomView({
  roomName,
  now,
  next,
  rows,
  mark,
  handOff,
  footer,
}: {
  roomName: string;
  now: { bandId: string; name: string; since: string } | null;
  next: { bandId: string; name: string; arrived: boolean } | null;
  rows: RoomRow[];
  /** Mark a group in this room (in), or take a mark back. */
  mark: (bandId: string, kind: "in" | "done", on: boolean) => Promise<ActionState>;
  /** Done (the group in now), and the next group in, in one step. */
  handOff: (doneBand: string | null, nextBand: string | null) => Promise<ActionState>;
  footer?: ReactNode;
}) {
  const { busy, run, bar } = useTaps();

  const doneAndNext = () =>
    run(
      "handoff",
      () => handOff(now?.bandId ?? null, next?.bandId ?? null),
      now && next ? `Marked ${now.name} done and ${next.name} in ${roomName}` : now ? `Marked ${now.name} done in ${roomName}` : `Marked ${next!.name} in ${roomName}`,
      async () => {
        if (next) {
          const r = await mark(next.bandId, "in", false);
          if (r.error) return r;
        }
        return now ? mark(now.bandId, "done", false) : { ok: true };
      },
    );
  const doneOnly = () =>
    run("done", () => handOff(now!.bandId, null), `Marked ${now!.name} done in ${roomName}`, () => mark(now!.bandId, "done", false));
  const inOnly = (r: RoomRow) =>
    run(`in:${r.bandId}`, () => mark(r.bandId, "in", true), `Marked ${r.name} in ${roomName}`, () => mark(r.bandId, "in", false));

  const big = "min-h-14 w-full text-base";
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
        {now ? (
          <>
            <p className="text-sm text-muted">In {roomName} since {now.since}</p>
            <p className="text-xl font-semibold">{now.name}</p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">Now</p>
            <p className="text-xl font-semibold">Between groups</p>
          </>
        )}
        <div className="mt-4 space-y-2">
          {now && next && (
            <Button type="button" className={big} disabled={busy !== null} onClick={() => void doneAndNext()}>
              {busy === "handoff" ? "Saving…" : `Done · mark ${next.name} in`}
            </Button>
          )}
          {now && (
            <Button type="button" variant={next ? "secondary" : "primary"} className={big} disabled={busy !== null} onClick={() => void doneOnly()}>
              {busy === "done" ? "Saving…" : `Mark ${now.name} done`}
            </Button>
          )}
          {!now && next && (
            <Button type="button" className={big} disabled={busy !== null} onClick={() => void doneAndNext()}>
              {busy === "handoff" ? "Saving…" : `Mark ${next.name} in`}
            </Button>
          )}
          {!now && !next && <p className="text-sm">Every group with a time here today is done or marked.</p>}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm">No groups have a time in this room on this day.</p>
      ) : (
        <ol className="divide-y divide-border rounded-lg border border-border bg-surface text-sm" aria-label={`${roomName}'s list`}>
          {rows.map((r) => (
            <li key={r.bandId} className="grid grid-cols-[4.75rem_1fr] gap-x-3 px-4 py-3">
              <span className="pt-0.5 tabular-nums">{r.time}</span>
              {/* Phones: the name gets the width, and the state and button go on their own line under it. */}
              <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <span className="min-w-[11rem] flex-1">
                  <span className="font-medium">{r.name}</span>
                  {r.school && <span className="block text-muted">{r.school}</span>}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={BADGE[r.state.tone]}>{r.state.text}</Badge>
                  {/* Between groups only, so a room never has two groups in at once by accident. */}
                  {!now && !r.marked && r.bandId !== next?.bandId && r.state.text !== "Didn't come" && (
                    <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void inOnly(r)} aria-label={`Mark ${r.name} in ${roomName}`}>
                      {busy === `in:${r.bandId}` ? "Saving…" : "Mark in"}
                    </Button>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="sticky bottom-[var(--day-bar,0px)] z-20 pb-2">{bar}</div>
      {footer}
    </div>
  );
}

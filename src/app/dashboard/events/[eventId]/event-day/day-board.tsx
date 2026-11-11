"use client";

import Link from "next/link";
import { useState } from "react";
import { useTaps } from "@/components/festival-undo";
import { Badge, Button, Input } from "@/components/ui";
import type { Tap, Tone } from "@/lib/festival-day";
import { PushBackButton, type PushGroup } from "../rooms/push-back-form";
import { markGroups } from "./actions";

export type BoardRoom = { id: string; name: string; note: string | null; now: string | null; next: string | null; href: string };
export type BoardGroup = {
  id: string;
  name: string;
  school: string;
  start: string;
  status: { text: string; tone: Tone };
  line: string;
  tap: Tap | null;
  alt: Tap | null;
  finished: boolean;
  noTimes: boolean;
};

const BADGE: Record<Tone, "info" | "neutral" | "warning" | "success"> = { info: "info", neutral: "neutral", warning: "warning", success: "success" };

/**
 * Board 13: the rooms as a compact list (no sideways scrolling), search, push back for hosts, and a card for every
 * group with its next tap as a solid button (owner decision: each card keeps its own). Undo after each tap.
 */
export function DayBoard({
  eventId,
  rooms,
  groups,
  dayLabel,
  isHost,
  roomsHref,
  push,
}: {
  eventId: string;
  rooms: BoardRoom[];
  groups: BoardGroup[];
  dayLabel: string;
  isHost: boolean;
  roomsHref: string;
  push: { groups: PushGroup[]; defaultGroup?: string; posted: boolean; version: number | null; multiDay: boolean } | null;
}) {
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const { busy, run, bar } = useTaps();
  const needle = q.trim().toLowerCase();
  const match = (g: BoardGroup) => !needle || g.name.toLowerCase().includes(needle) || g.school.toLowerCase().includes(needle);
  const shown = groups.filter(match);
  const active = shown.filter((g) => !g.finished);
  const finished = shown.filter((g) => g.finished);

  const tap = (g: BoardGroup, t: Tap) =>
    run(`${g.id}:${t.label}`, () => markGroups(eventId, t.ops), `Marked ${g.name} ${t.did}`, () => markGroups(eventId, t.undo));

  const card = (g: BoardGroup) => (
    <li key={g.id} className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{g.name}</p>
          <p className="text-sm text-muted">{g.school}</p>
        </div>
        <Badge tone={BADGE[g.status.tone]}>
          {g.status.tone === "warning" && <span aria-hidden>◆&nbsp;</span>}
          {g.status.text}
        </Badge>
      </div>
      <p className="mt-2 text-sm">{g.line}</p>
      {(g.tap || g.alt || (g.noTimes && isHost)) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {g.tap && (
            <Button type="button" disabled={busy !== null} aria-busy={busy === `${g.id}:${g.tap.label}`} onClick={() => void tap(g, g.tap!)}>
              {busy === `${g.id}:${g.tap.label}` ? "Saving…" : g.tap.label}
            </Button>
          )}
          {g.alt && (
            <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void tap(g, g.alt!)}>
              {busy === `${g.id}:${g.alt.label}` ? "Saving…" : g.alt.label}
            </Button>
          )}
          {g.noTimes && isHost && (
            <Link
              href={roomsHref}
              className="inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand"
            >
              Add to the end of {dayLabel}
            </Link>
          )}
        </div>
      )}
    </li>
  );

  return (
    <div className="mt-5 space-y-5">
      <section aria-labelledby="rooms-now">
        <h2 id="rooms-now" className="sr-only">
          Rooms now
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((r) => (
            <li key={r.id} className="min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 font-semibold">
                  {r.name}
                  {r.note && <span className="block text-xs font-normal text-muted">{r.note}</span>}
                </p>
                <Link
                  href={r.href}
                  className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-brand underline underline-offset-4"
                  aria-label={`See ${r.name}'s list`}
                >
                  See list
                </Link>
              </div>
              <p>
                <span className="text-muted">Now:</span> {r.now ?? "Between groups"}
              </p>
              <p>
                <span className="text-muted">Up next:</span> {r.next ?? "No one else today"}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <div id="push-back" className="flex scroll-mt-6 flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-sm font-semibold">Find a group</span>
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Group or school" autoComplete="off" />
        </label>
        {push && (
          <PushBackButton
            eventId={eventId}
            groups={push.groups}
            defaultGroup={push.defaultGroup}
            posted={push.posted}
            version={push.version}
            multiDay={push.multiDay}
            label="Running behind? Push the schedule back"
            className="w-full sm:w-auto"
          />
        )}
      </div>

      {groups.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm">No groups are on the schedule for {dayLabel} yet.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm" role="status">
          No group or school matches “{q.trim()}”.
        </p>
      ) : (
        <>
          <ul className="space-y-3" aria-label="Groups">
            {active.map(card)}
          </ul>
          {finished.length > 0 &&
            (needle || showDone ? (
              <>
                {!needle && (
                  <button
                    type="button"
                    onClick={() => setShowDone(false)}
                    aria-expanded
                    className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand"
                  >
                    <span aria-hidden>⌄</span> Hide finished groups
                  </button>
                )}
                <ul className="space-y-3" aria-label="Finished groups">
                  {finished.map(card)}
                </ul>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowDone(true)}
                aria-expanded={false}
                className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand"
              >
                <span aria-hidden>›</span> Show {finished.length} finished {finished.length === 1 ? "group" : "groups"}
              </button>
            ))}
        </>
      )}
      {/* Pinned above the event-day bar while the list scrolls, so Undo is in reach after a tap far down. */}
      <div className="sticky bottom-[var(--day-bar,0px)] z-20 pb-2">{bar}</div>
    </div>
  );
}

"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { markChanged, markSaved, SaveFooter } from "./save-footer";
import { NumberInput } from "@/components/number-input";
import { Button, Card, Field, FormMessage, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { pathRooms, roomTimes, tooLongRooms, type GroupPlan, type Room } from "@/lib/rooms";
import { formatDate, formatTime, zonedToUtc } from "@/lib/time";
import type { ScheduleInput } from "./actions";
import { LineIcon } from "@/components/line-icon";
import { TimeField } from "@/components/time-field";

export type ScheduleGroup = { id: string; name: string; school: string; classification: string; conflicts: string | null };

/**
 * Groups in order. Each starts the path one interval after the one before
 * (plus any break), and every room's time follows from the room lengths and
 * the passing time, previewed here as you go.
 */
export function ScheduleEditor({
  groups,
  rooms,
  initialOrder,
  initialDate,
  initialTime,
  initialInterval,
  initialPassing,
  days,
  timezone,
  zoneLabel,
  posted,
  save,
}: {
  groups: ScheduleGroup[];
  rooms: Room[];
  initialOrder: GroupPlan[];
  initialDate: string;
  initialTime: string;
  initialInterval: number;
  initialPassing: number;
  days: string[];
  timezone: string;
  zoneLabel: string;
  posted: boolean;
  save: (input: ScheduleInput) => Promise<ActionState>;
}) {
  // The saved order first, then groups that registered since.
  const [order, setOrder] = useState<GroupPlan[]>(() => [
    ...initialOrder.filter((o) => groups.some((c) => c.id === o.bandId)),
    ...groups.filter((c) => !initialOrder.some((o) => o.bandId === c.id)).map((c) => ({ bandId: c.id, skipped: [], extraMinutes: 0 })),
  ]);
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [interval, setIntervalMinutes] = useState(String(initialInterval));
  const [passing, setPassing] = useState(String(initialPassing));
  const [emailChanges, setEmailChanges] = useState(true);
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  // Every change goes through here: the footer says it's unsaved, and leaving the tab asks first.
  const touch = () => {
    setDirty(true);
    markChanged(form);
  };

  const path = pathRooms(rooms);
  const unsaved = initialOrder.length !== order.length || order.some((o, i) => initialOrder[i]?.bandId !== o.bandId);
  const byId = new Map(groups.map((c) => [c.id, c]));
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const iv = Number(interval) || 0;
  const pass = Number(passing) || 0;
  const times = useMemo(
    () => (date && time ? roomTimes(zonedToUtc(date, time, timezone), iv, pass, rooms, order) : new Map()),
    [date, time, timezone, iv, pass, rooms, order],
  );
  const overlong = tooLongRooms(rooms, iv);

  const set = (i: number, patch: Partial<GroupPlan>) => {
    setOrder((list) => list.map((o, j) => (j === i ? { ...o, ...patch } : o)));
    touch();
  };
  const move = (i: number, by: number) => {
    setOrder((list) => {
      const next = [...list];
      const [o] = next.splice(i, 1);
      next.splice(i + by, 0, o);
      return next;
    });
    touch();
  };

  if (!path.length) {
    return (
      <Card>
        <p className="text-muted">Add the rooms every group visits in the Rooms tab first; then put the groups in order here.</p>
      </Card>
    );
  }
  if (!groups.length) {
    return (
      <Card>
        <p className="text-muted">No groups have registered yet. They&apos;ll appear here, ready to put in order.</p>
      </Card>
    );
  }

  const onSave = () =>
    start(async () => {
      const r = await save({
        date,
        time,
        interval: iv,
        passing: pass,
        order: order.map((o) => ({ bandId: o.bandId, skipped: o.skipped.filter((id) => roomName.has(id)), extraMinutes: o.extraMinutes })),
        emailChanges,
      });
      setState(r);
      if (r.ok) setDirty(false);
      markSaved(form, Boolean(r.ok));
    });

  return (
    <form
      ref={form}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <Card className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Day">
            <Select value={date} onChange={(e) => (setDate(e.target.value), touch())}>
              {days.map((d) => (
                <option key={d} value={d}>
                  {formatDate(d, { year: undefined })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="First group starts">
            <TimeField value={time} onChange={(e) => (setTime(e.target.value), touch())} />
          </Field>
          <Field label="Minutes between groups">
            <NumberInput value={interval} onChange={(e) => (setIntervalMinutes(e.target.value), touch())} maxLength={3} />
          </Field>
          <Field label="Passing time (minutes)" hint="Walking between rooms.">
            <NumberInput value={passing} onChange={(e) => (setPassing(e.target.value), touch())} maxLength={2} />
          </Field>
        </div>
        <p className="text-sm text-muted">
          Path: {path.map((r) => `${r.name} (${r.minutes} min)`).join(" → ")}. All times {zoneLabel}.
        </p>
        {overlong.length > 0 && (
          <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm" role="alert">
            {overlong.map((r) => r.name).join(" and ")} {overlong.length === 1 ? "takes" : "take"} longer than the {iv} minutes
            between groups, so two groups would be in {overlong.length === 1 ? "it" : "them"} at once. Make the gap at least{" "}
            {Math.max(...overlong.map((r) => r.minutes))} minutes.
          </p>
        )}
      </Card>

      <p className="text-sm text-muted">Tap a room to skip it for that group (for example, a group that isn&apos;t sight-reading).</p>
      <ol className="space-y-3">
        {order.map((o, i) => {
          const c = byId.get(o.bandId);
          if (!c) return null;
          const mine = times.get(o.bandId) ?? [];
          return (
            <li key={o.bandId}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      <span className="mr-2 text-muted tabular-nums">{i + 1}.</span>
                      {c.name}
                    </p>
                    <p className="text-sm text-muted">
                      {c.school} · {c.classification}
                    </p>
                    {c.conflicts && <p className="mt-1 text-sm"><LineIcon name="warning" inline />{c.conflicts}</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" className="px-3" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${c.name} earlier`}>
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-3"
                      disabled={i === order.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={`Move ${c.name} later`}
                    >
                      ↓
                    </Button>
                  </div>
                </div>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {path.map((r) => {
                    const t = mine.find((x: { roomId: string }) => x.roomId === r.id);
                    const skipped = o.skipped.includes(r.id);
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => set(i, { skipped: skipped ? o.skipped.filter((x) => x !== r.id) : [...o.skipped, r.id] })}
                          aria-pressed={!skipped}
                          title={skipped ? `Add ${r.name} back` : `Skip ${r.name} for this group`}
                          className={`flex min-h-11 flex-col items-start rounded-md border px-3 py-1 text-left text-sm ${skipped ? "border-dashed border-border text-muted line-through" : "border-border bg-background"}`}
                        >
                          <span className="font-medium">{r.name}</span>
                          <span className="text-xs tabular-nums">{skipped ? "Skipping" : t ? `${formatTime(t.startsAt.toISOString(), timezone)}–${formatTime(t.endsAt.toISOString(), timezone)}` : ""}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3 flex items-center gap-2 text-sm">
                  <label htmlFor={`break-${o.bandId}`} className="text-muted">
                    Break before this group
                  </label>
                  <div className="w-20">
                    <NumberInput
                      id={`break-${o.bandId}`}
                      value={o.extraMinutes ? String(o.extraMinutes) : ""}
                      onChange={(e) => set(i, { extraMinutes: Number(e.target.value) || 0 })}
                      placeholder="0"
                      maxLength={3}
                    />
                  </div>
                  <span className="text-muted">min</span>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>

      <FormMessage error={state.error} success={state.ok && !dirty ? state.message : null} />
      <SaveFooter dirty={dirty || unsaved} saved={initialOrder.length > 0} pending={pending} label="Save schedule" inCard={false}>
        {posted && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={emailChanges} onChange={(e) => setEmailChanges(e.target.checked)} className="h-5 w-5 accent-[var(--brand)]" />
            Email directors whose times change
          </label>
        )}
      </SaveFooter>
      {unsaved && !pending && <p className="text-sm text-muted">New groups aren&apos;t scheduled until you save.</p>}
    </form>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { NumberInput } from "@/components/number-input";
import { TimeField } from "@/components/time-field";
import { Badge, Button, Select } from "@/components/ui";
import { checkRequest, clock, pathRooms, shortDay, span, timeChanges, weekday, type GroupRequest } from "@/lib/rooms";
import { loadSchedule, saveSchedule, type SaveResult } from "./actions";
import { PushBackButton, type PushGroup } from "./push-back-form";
import { SaveFooter } from "./save-footer";
import { applyOps, onDay, planTimes, roomNameMap, summarize, type Conflict, type Op, type Plan, type Snapshot } from "./schedule-plan";
import { useSaveQueue, type RunResult } from "./use-save-queue";
import { Choice, ConflictWindow, SaveTimesWindow, Window } from "./windows";

export type ScheduleGroup = {
  id: string;
  name: string;
  school: string;
  classification: string | null;
  request: GroupRequest;
  withdrawn: boolean;
};

const OUT = "inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";
// 44 by 44. One that can't be used keeps the same fill (dark mode read a darker fill as "pressed"), with a muted
// border and arrow.
const ARROW =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-field-border bg-surface hover:border-brand disabled:cursor-not-allowed disabled:border-border disabled:text-disabled disabled:hover:border-border";
const MENU_ITEM = "flex min-h-11 w-full items-center rounded px-3 text-left text-sm hover:bg-background";
/** Closes the menu a tapped item is in. */
const closeMenu = (e: { currentTarget: HTMLElement }) => {
  const d = e.currentTarget.closest("details");
  if (d) d.open = false;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/**
 * The Group times tab (board 10, with the light check's fixes): a day switch for two-day festivals, each day's
 * first start, then the groups in order with their room times as plain words. Move to, Skip a room, and Add a break
 * are buttons; a break is a solid row saying when the next group starts instead. Directors' requests show as met or
 * broken. Groups with no times wait at the end. Before posting it saves as you go; once posted, Save opens "Save the
 * new times?" (board 12).
 */
export function ScheduleEditor({
  eventId,
  initial,
  groups,
  days,
  tz,
  classifications,
}: {
  eventId: string;
  initial: Snapshot;
  /** Every registered group (withdrawn ones too: they keep their place until taken off). */
  groups: ScheduleGroup[];
  days: string[];
  tz: string;
  classifications: string[];
}) {
  const [base, setBase] = useState(initial);
  const [ops, setOps] = useState<Op[]>([]);
  const opsRef = useRef(ops);
  useEffect(() => {
    opsRef.current = ops;
  });
  const [day, setDay] = useState(days[0]);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saving, setSaving] = useState({ open: false, busy: false, error: null as string | null });
  const [moving, setMoving] = useState<string | null>(null);
  const [breakFor, setBreakFor] = useState<string | null>(null);
  const [sorted, setSorted] = useState<{ day: string; ids: string[] } | null>(null);
  const [announce, setAnnounce] = useState("");
  const arrows = useRef(new Map<string, HTMLButtonElement | null>());
  const posted = base.posted;
  const multi = days.length > 1;
  const byId = new Map(groups.map((g) => [g.id, g]));
  const roomNames = roomNameMap(base.rooms);
  const path = pathRooms(base.rooms);

  const basePlan: Plan = { starts: base.starts, order: base.order };
  const plan = applyOps(basePlan, ops, days);
  const times = planTimes(plan, base.rooms, base.interval, base.passing, days, tz);
  const labels = ops.map((o) => o.label);

  const save = async (email: boolean): Promise<RunResult> => {
    const sent = opsRef.current;
    if (!sent.length) return { kind: "nothing" };
    const p = applyOps(basePlan, sent, days);
    let r: SaveResult;
    try {
      r = await saveSchedule(eventId, {
        starts: p.starts,
        order: p.order.map((o) => ({ bandId: o.bandId, day: o.day, skipped: o.skipped, extraMinutes: o.extraMinutes })),
        expectedVersion: base.version,
        summary: summarize(sent.map((o) => o.label)) + (posted ? (email ? " Directors were emailed." : " Directors weren't emailed.") : ""),
        email,
      });
    } catch {
      return { kind: "failed", error: "Check your connection, then select Retry.", retry: true };
    }
    if ("conflict" in r) {
      setConflict(r.conflict);
      return { kind: "conflict" };
    }
    if ("error" in r) return { kind: "failed", error: r.error, retry: r.error.startsWith("Something went wrong") };
    if (!("ok" in r)) return { kind: "failed", error: "That couldn't be saved.", retry: false };
    setBase((b) => ({ ...b, version: r.version, starts: p.starts, order: p.order }));
    setOps((list) => list.slice(sent.length));
    return { kind: "saved" };
  };

  const saver = useSaveQueue(() => (posted ? Promise.resolve<RunResult>({ kind: "nothing" }) : save(false)), "A change to the group times");
  const { hold } = saver;
  useEffect(() => hold(posted && ops.length > 0), [hold, posted, ops.length]);

  const add = (op: Op) => {
    setOps((list) => [...list, op]);
    if (!posted) saver.queue();
  };

  const name = (id: string) => byId.get(id)?.name ?? "A group";
  const today = onDay(plan.order, day);
  const scheduled = new Set(plan.order.map((o) => o.bandId));
  const waiting = groups.filter((g) => !g.withdrawn && !scheduled.has(g.id));
  const dayName = weekday(day);
  const startLabel = multi ? `${weekday(day)}'s first group starts` : "First group starts";

  const move = (id: string, by: -1 | 1) => {
    const i = today.findIndex((o) => o.bandId === id);
    const j = i + by;
    if (j < 0 || j >= today.length) return;
    add({ k: "move", bandId: id, day, index: j, label: `Moved ${name(id)} ${by < 0 ? "earlier" : "later"}` });
    setAnnounce(`Moved ${name(id)} to ${ordinal(j + 1)}`);
    requestAnimationFrame(() => {
      const end = (by < 0 && j === 0) || (by > 0 && j === today.length - 1);
      arrows.current.get(`${id}:${end ? -by : by}`)?.focus();
    });
  };

  // Posted: Save opens the window with every group whose times change.
  const baseTimes = planTimes(basePlan, base.rooms, base.interval, base.passing, days, tz);
  const changes = saving.open
    ? timeChanges(baseTimes, times, roomNames, tz, [...new Set([...base.order, ...plan.order].map((o) => o.bandId))], { multi }).map((c) => ({ name: name(c.bandId), text: c.text }))
    : [];
  const confirmSave = async (email: boolean) => {
    setSaving({ open: true, busy: true, error: null });
    const r = await save(email);
    if (r.kind === "saved" || r.kind === "nothing") {
      setSaving({ open: false, busy: false, error: null });
      saver.setStatus({ kind: "saved" });
    } else if (r.kind === "conflict") setSaving({ open: false, busy: false, error: null });
    else setSaving({ open: true, busy: false, error: r.kind === "failed" ? r.error : r.kind === "incomplete" ? r.what : null });
  };

  const resolve = (addMine: boolean) => {
    const c = conflict;
    if (!c) return;
    setConflict(null);
    setBase(c.snapshot);
    if (!addMine) {
      setOps([]);
      saver.setStatus({ kind: "idle" });
      saver.clear();
      return;
    }
    if (c.snapshot.posted) setSaving({ open: true, busy: false, error: null });
    else saver.queue(true);
  };

  // After a push back here: the saved schedule again, with any change not saved yet still on top.
  const reload = async () => {
    const snap = await loadSchedule(eventId);
    if (snap) setBase(snap);
  };

  const pushGroups: PushGroup[] = days.flatMap((d) =>
    onDay(base.order, d).flatMap((o) => {
      const t = baseTimes.get(o.bandId)?.[0];
      return t ? [{ id: o.bandId, name: name(o.bandId), day: d, dayLabel: weekday(d), startsAt: t.startsAt.toISOString(), startLabel: clock(t.startsAt, tz) }] : [];
    }),
  );
  const now = new Date().toISOString();

  if (!path.length) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4 text-sm shadow-card sm:p-6">
        <p>Add the rooms every group visits first, in the Rooms tab. Then the groups go in order here.</p>
      </div>
    );
  }

  // A break that ends up first in a day (after a move) starts the whole day later: the save window says so.
  const lateStarts = days.flatMap((d) => {
    const head = onDay(plan.order, d)[0];
    const t = head && head.extraMinutes > 0 ? times.get(head.bandId)?.[0] : null;
    return t
      ? [{ day: d, text: `${multi ? `${weekday(d)}'s` : "The"} first group, ${name(head.bandId)}, now starts at ${clock(t.startsAt, tz)}, ${head.extraMinutes} minutes after the first start you set, because of the break before it.` }]
      : [];
  });

  const moveItem = moving ? plan.order.find((o) => o.bandId === moving) : null;
  const breakItem = breakFor ? plan.order.find((o) => o.bandId === breakFor) : null;

  return (
    <div>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {multi ? (
          <div role="group" aria-label="Festival day" className="flex flex-wrap rounded-md ring-1 ring-field-border">
            {days.map((d, i) => (
              <button
                key={d}
                type="button"
                aria-pressed={d === day}
                onClick={() => setDay(d)}
                className={`inline-flex min-h-11 items-center px-4 text-sm font-semibold ${i === 0 ? "rounded-l-md" : ""} ${i === days.length - 1 ? "rounded-r-md" : ""} ${
                  d === day ? "bg-brand text-brand-foreground" : "hover:bg-background"
                }`}
              >
                {shortDay(d)} · {plural(onDay(plan.order, d).length, "group", "groups")}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap gap-2">
          {classifications.length > 0 && today.length > 1 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const rank = (id: string) => {
                  const c = byId.get(id)?.classification;
                  const i = c ? classifications.indexOf(c) : -1;
                  return i < 0 ? 999 : i;
                };
                const before = today.map((o) => o.bandId);
                const ids = [...before].sort((a, b) => rank(a) - rank(b));
                setSorted({ day, ids: before });
                add({ k: "order", day, ids, label: `Sorted ${multi ? `${weekday(day)}'s groups` : "the groups"} by classification` });
              }}
            >
              Sort by classification
            </Button>
          )}
          {pushGroups.length > 0 && (
            <PushBackButton
              eventId={eventId}
              groups={pushGroups}
              defaultGroup={(pushGroups.find((g) => g.startsAt > now && g.day === day) ?? pushGroups.find((g) => g.day === day))?.id}
              posted={posted}
              version={base.version}
              multiDay={multi}
              onDone={() => void reload()}
            />
          )}
        </div>
      </div>
      {sorted && sorted.day === day && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 text-sm" role="status">
          Sorted by classification.
          <button
            type="button"
            className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
            onClick={() => {
              add({ k: "order", day: sorted.day, ids: sorted.ids, label: "Undid the sort by classification" });
              setSorted(null);
            }}
          >
            Undo
          </button>
        </p>
      )}

      <div className="mt-4 max-w-xs">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">{startLabel}</span>
          <TimeField
            value={plan.starts[day] ?? ""}
            onChange={(e) => {
              const t = e.target.value;
              if (/^\d{2}:\d{2}$/.test(t) && t !== plan.starts[day]) add({ k: "start", day, time: t, label: `${multi ? `${weekday(day)}'s` : "The"} first group starts at ${clock(new Date(`2000-01-01T${t}:00Z`), "UTC")}` });
            }}
          />
        </label>
        {!plan.starts[day] && <p className="mt-1 text-sm text-muted">Groups get times once this is filled in.</p>}
      </div>

      {today.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface p-4 text-sm shadow-card">
          {multi ? `No groups on ${weekday(day)} yet.` : "No groups have times yet."} {waiting.length > 0 ? "Add them from the list below." : "Groups appear here once they register."}
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {today.map((o, i) => {
            const g = byId.get(o.bandId);
            const mine = times.get(o.bandId) ?? [];
            const request = g ? checkRequest(g.request, mine, roomNames, tz, multi) : null;
            const skipped = path.filter((r) => o.skipped.includes(r.id));
            const first = mine[0];
            const label = g?.name ?? "this group";
            return (
              <li key={o.bandId} className="space-y-2">
                {o.extraMinutes > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm">
                    <span>
                      <span className="font-semibold">Break, {o.extraMinutes} min</span>
                      {first && (
                        <>
                          {" "}
                          · {label} starts {clock(first.startsAt, tz)} instead of {clock(new Date(first.startsAt.getTime() - o.extraMinutes * 60_000), tz)}
                        </>
                      )}
                    </span>
                    <span className="flex gap-2">
                      <Button type="button" variant="secondary" onClick={() => setBreakFor(o.bandId)}>
                        <span>
                          Change<span className="sr-only"> the break before {label}</span>
                        </span>
                      </Button>
                      {/* The red outline every Remove has. */}
                      <Button type="button" variant="danger" onClick={() => add({ k: "break", bandId: o.bandId, minutes: 0, label: `Took out the break before ${label}` })}>
                        <span>
                          Remove<span className="sr-only"> the break before {label}</span>
                        </span>
                      </Button>
                    </span>
                  </div>
                )}
                <div className={`rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6 ${request && !request.ok ? "border-l-4 border-l-warning" : ""}`}>
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="w-7 text-lg font-semibold text-muted tabular-nums" aria-hidden>
                        {i + 1}.
                      </span>
                      <button type="button" ref={(el) => void arrows.current.set(`${o.bandId}:-1`, el)} className={ARROW} disabled={i === 0} onClick={() => move(o.bandId, -1)} aria-label={`Move ${label} earlier`}>
                        <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                          <path d="M12 19V5M6 11l6-6 6 6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        ref={(el) => void arrows.current.set(`${o.bandId}:1`, el)}
                        className={ARROW}
                        disabled={i === today.length - 1}
                        onClick={() => move(o.bandId, 1)}
                        aria-label={`Move ${label} later`}
                      >
                        <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                          <path d="M12 5v14M6 13l6 6 6-6" />
                        </svg>
                      </button>
                    </div>
                    <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                      <p className="font-semibold">{label}</p>
                      <p className="text-sm text-muted">{[g?.school, g?.classification].filter(Boolean).join(" · ")}</p>
                    </div>
                    {g?.withdrawn && <Badge tone="off">Withdrawn</Badge>}
                    {request && !request.ok && (
                      <Badge tone="warning">
                        <span aria-hidden>◆&nbsp;</span>Request not met
                      </Badge>
                    )}
                  </div>
                  {/* Times are words, not boxes: nothing here to type in (light check). */}
                  {/* Phones: one line per room (room, then its time). Wider screens: a column per room. */}
                  <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3 sm:gap-y-2">
                    {path.map((r) => {
                      const t = mine.find((x) => x.roomId === r.id);
                      return (
                        <div key={r.id} className="flex flex-wrap justify-between gap-x-3 sm:block">
                          <dt className="font-semibold">{r.name}</dt>
                          <dd className="tabular-nums">{o.skipped.includes(r.id) ? "Skipped for this group" : t ? span(t.startsAt, t.endsAt, tz) : "No time yet"}</dd>
                        </div>
                      );
                    })}
                  </dl>
                  {request && (
                    <p className={`mt-2 text-sm ${request.ok ? "" : "font-medium text-warning"}`}>
                      {request.ok ? (
                        <span aria-hidden className="text-success">
                          ✓{" "}
                        </span>
                      ) : (
                        <span aria-hidden>◆ </span>
                      )}
                      {request.text}
                    </p>
                  )}
                  {/* Phones: the changes under one "Change" menu, so each card stays short. */}
                  <details className="relative mt-3 sm:hidden">
                    <summary className={`${OUT} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                      Change<span className="sr-only"> {label}</span> <span aria-hidden>▾</span>
                    </summary>
                    <div className="absolute z-20 mt-1 w-64 rounded-md border border-field-border bg-surface p-1 shadow-elevated">
                      <button
                        type="button"
                        className={MENU_ITEM}
                        onClick={(e) => {
                          closeMenu(e);
                          setMoving(o.bandId);
                        }}
                      >
                        Move to…
                      </button>
                      {path.map((r) => {
                        const on = o.skipped.includes(r.id);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            className={MENU_ITEM}
                            onClick={(e) => {
                              closeMenu(e);
                              add({ k: "skip", bandId: o.bandId, roomId: r.id, on: !on, label: on ? `Added ${r.name} back for ${label}` : `Skipped ${r.name} for ${label}` });
                            }}
                          >
                            {on ? `Add ${r.name} back` : `Skip ${r.name}`}
                          </button>
                        );
                      })}
                      {o.extraMinutes === 0 && i > 0 && (
                        <button
                          type="button"
                          className={MENU_ITEM}
                          onClick={(e) => {
                            closeMenu(e);
                            setBreakFor(o.bandId);
                          }}
                        >
                          Add a break before
                        </button>
                      )}
                      {g?.withdrawn && (
                        <button
                          type="button"
                          className={MENU_ITEM}
                          onClick={(e) => {
                            closeMenu(e);
                            add({ k: "drop", bandId: o.bandId, label: `Took ${label} off the schedule` });
                          }}
                        >
                          Take off the schedule
                        </button>
                      )}
                    </div>
                  </details>
                  <div className="mt-3 flex flex-wrap gap-2 max-sm:hidden">
                    <button type="button" className={OUT} onClick={() => setMoving(o.bandId)}>
                      Move to…<span className="sr-only"> (move {label})</span>
                    </button>
                    <details className="relative">
                      <summary className={`${OUT} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                        {skipped.length ? `Rooms: add ${skipped[0].name} back` : "Skip a room"} <span aria-hidden>▾</span>
                      </summary>
                      <div className="absolute z-20 mt-1 w-64 rounded-md border border-field-border bg-surface p-1 shadow-elevated">
                        {path.map((r) => {
                          const on = o.skipped.includes(r.id);
                          return (
                            <button
                              key={r.id}
                              type="button"
                              className="flex min-h-11 w-full items-center rounded px-3 text-left text-sm hover:bg-background"
                              onClick={(e) => {
                                closeMenu(e);
                                add({ k: "skip", bandId: o.bandId, roomId: r.id, on: !on, label: on ? `Added ${r.name} back for ${label}` : `Skipped ${r.name} for ${label}` });
                              }}
                            >
                              {on ? `Add ${r.name} back` : `Skip ${r.name}`}
                            </button>
                          );
                        })}
                      </div>
                    </details>
                    {/* No break before the first group of a day: the day's first start does that. */}
                    {o.extraMinutes === 0 && i > 0 && (
                      <button type="button" className={OUT} onClick={() => setBreakFor(o.bandId)}>
                        Add a break before<span className="sr-only"> {label}</span>
                      </button>
                    )}
                    {g?.withdrawn && (
                      <button type="button" className={OUT} onClick={() => add({ k: "drop", bandId: o.bandId, label: `Took ${label} off the schedule` })}>
                        Take off the schedule
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {multi && today.length > 0 && (
        <p className="mt-4 text-sm">
          <span className="font-semibold">Last group {weekday(day)}.</span> Move a group to another day with Move to.
        </p>
      )}

      {waiting.length > 0 && (
        <section aria-labelledby="no-times" className="mt-6 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
          <h3 id="no-times" className="font-semibold">
            Registered, no times yet · {plural(waiting.length, "group", "groups")}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {posted ? "When you add a group and save, its directors are emailed its times. No one else is emailed." : "They get times once you add them."}
          </p>
          <ul className="mt-3 divide-y divide-border">
            {waiting.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm">
                  <span className="font-semibold">{g.name}</span>
                  <span className="text-muted"> · {[g.school, g.classification].filter(Boolean).join(" · ")}</span>
                </span>
                <button type="button" className={OUT} onClick={() => add({ k: "add", bandIds: [g.id], day, label: `Added ${g.name} to the end of ${dayName}` })}>
                  Add to the end of {dayName}
                </button>
              </li>
            ))}
          </ul>
          {waiting.length > 1 && (
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              onClick={() => add({ k: "add", bandIds: waiting.map((g) => g.id), day, label: `Added ${plural(waiting.length, "group", "groups")} to the end of ${dayName}` })}
            >
              Add all {waiting.length} to the end of {dayName}, in the order they registered
            </Button>
          )}
        </section>
      )}

      <SaveFooter
        inCard={false}
        status={saver.status}
        retry={() => void saver.fire()}
        notPosted={!posted}
        postedIdle={posted}
        posted={posted && ops.length ? { summary: `${summarize(labels)}.`, onSave: () => setSaving({ open: true, busy: false, error: null }), onUndo: () => setOps([]), busy: saving.busy } : null}
      />

      <SaveTimesWindow
        key={saving.open ? "open" : "closed"}
        open={saving.open}
        intro={
          <>
            <p>{summarize(labels)}.</p>
            {lateStarts.map((l) => (
              <p key={l.day}>{l.text}</p>
            ))}
          </>
        }
        changes={changes}
        busy={saving.busy}
        error={saving.error}
        onSave={(email) => void confirmSave(email)}
        onClose={() => setSaving({ open: false, busy: false, error: null })}
      />
      <ConflictWindow conflict={conflict} mine={summarize(labels)} onAddMine={() => resolve(true)} onDropMine={() => resolve(false)} />
      <MoveWindow
        key={`move-${moving ?? "none"}`}
        item={moveItem ?? null}
        name={moving ? name(moving) : ""}
        nameOf={name}
        plan={plan}
        days={days}
        onClose={() => setMoving(null)}
        onMove={(d, index) => {
          if (!moveItem) return;
          const where = d !== moveItem.day ? ` to ${weekday(d)}` : ` to ${ordinal(index + 1)}`;
          add({ k: "move", bandId: moveItem.bandId, day: d, index, label: `Moved ${name(moveItem.bandId)}${where}` });
          setMoving(null);
          if (d !== day) setDay(d);
        }}
      />
      <BreakWindow
        key={`break-${breakFor ?? "none"}`}
        item={breakItem ?? null}
        name={breakFor ? name(breakFor) : ""}
        onClose={() => setBreakFor(null)}
        onSet={(minutes) => {
          if (!breakItem) return;
          add({ k: "break", bandId: breakItem.bandId, minutes, label: minutes ? `Break of ${minutes} minutes before ${name(breakItem.bandId)}` : `Took out the break before ${name(breakItem.bandId)}` });
          setBreakFor(null);
        }}
      />
    </div>
  );
}

/** "Move to…": a position on this day, or another day (two-day festivals). */
function MoveWindow({
  item,
  name,
  nameOf,
  plan,
  days,
  onClose,
  onMove,
}: {
  item: { bandId: string; day: string } | null;
  name: string;
  nameOf: (id: string) => string;
  plan: Plan;
  days: string[];
  onClose: () => void;
  onMove: (day: string, index: number) => void;
}) {
  const [day, setDay] = useState(item?.day ?? days[0]);
  const others = item ? onDay(plan.order, day).filter((o) => o.bandId !== item.bandId) : [];
  const current = item ? onDay(plan.order, item.day).findIndex((o) => o.bandId === item.bandId) : 0;
  const [index, setIndex] = useState(String(current));
  const at = Math.min(Number(index), others.length);
  return (
    <Window
      open={Boolean(item)}
      title={`Move ${name}`}
      onClose={onClose}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Keep it here
          </Button>
          <Button type="button" onClick={() => onMove(day, at)}>
            Move {name}
          </Button>
        </>
      }
    >
      {item && <p>Now {ordinal(current + 1)}{days.length > 1 ? ` on ${weekday(item.day)}` : ""}.</p>}
      {days.length > 1 && (
        <fieldset className="space-y-2">
          <legend className="font-semibold">Day</legend>
          {days.map((d) => (
            <Choice
              key={d}
              name="move-day"
              checked={d === day}
              onChange={() => {
                setDay(d);
                setIndex(String(d === item?.day ? current : onDay(plan.order, d).length));
              }}
            >
              {shortDay(d)}
            </Choice>
          ))}
        </fieldset>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="font-semibold">Position</span>
        <Select value={String(at)} onChange={(e) => setIndex(e.target.value)}>
          {Array.from({ length: others.length + 1 }, (_, i) => (
            <option key={i} value={i}>
              {i === 0 ? "1st, first of the day" : i === others.length ? `${ordinal(i + 1)}, last of the day` : `${ordinal(i + 1)}, after ${nameOf(others[i - 1].bandId)}`}
            </option>
          ))}
        </Select>
      </label>
    </Window>
  );
}

/** "Add a break before": minutes; every group after it that day starts that much later. */
function BreakWindow({ item, name, onClose, onSet }: { item: { extraMinutes: number } | null; name: string; onClose: () => void; onSet: (minutes: number) => void }) {
  const [minutes, setMinutes] = useState(item?.extraMinutes ? String(item.extraMinutes) : "");
  const m = Number(minutes);
  const valid = Number.isInteger(m) && m >= 1 && m <= 600;
  return (
    <Window
      open={Boolean(item)}
      title={`Break before ${name}`}
      onClose={onClose}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Keep editing
          </Button>
          {item && item.extraMinutes > 0 && (
            <Button type="button" variant="secondary" onClick={() => onSet(0)}>
              Take out the break
            </Button>
          )}
          <Button type="button" disabled={!valid} onClick={() => onSet(m)}>
            {item?.extraMinutes ? "Change the break" : "Add the break"}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className="font-semibold">Minutes</span>
        <NumberInput value={minutes} maxLength={3} onChange={(e) => setMinutes(e.target.value)} className="max-w-[8rem]" autoFocus />
        <span className="text-muted">{name} and every group after them that day start this much later. Groups before them keep their times.</span>
      </label>
    </Window>
  );
}

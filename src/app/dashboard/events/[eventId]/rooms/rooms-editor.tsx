"use client";

import { useEffect, useRef, useState } from "react";
import { confirmDialog } from "@/components/confirm-dialog";
import { NumberInput } from "@/components/number-input";
import { Button, Input } from "@/components/ui";
import { pathRooms, timeChanges, tooLongRooms, type Room } from "@/lib/rooms";
import { saveRooms, skipRoomForRest, type RoomInput, type SaveResult } from "./actions";
import { SaveFooter } from "./save-footer";
import { planTimes, roomNameMap, type Conflict, type Snapshot } from "./schedule-plan";
import { useSaveQueue, type RunResult } from "./use-save-queue";
import { ConflictWindow, EmailChoice, SaveTimesWindow, Window } from "./windows";

type Row = { key: string; id?: string; name: string; note: string; onPath: boolean; minutes: string };

let nextKey = 0;
const blank = (onPath: boolean): Row => ({ key: `new-${nextKey++}`, name: "", note: "", onPath, minutes: "" });
const toRows = (rooms: Room[]): Row[] => [
  ...pathRooms(rooms).map((r) => ({ key: r.id, id: r.id, name: r.name, note: r.note ?? "", onPath: true, minutes: String(r.minutes) })),
  ...rooms.filter((r) => r.path_order == null).map((r) => ({ key: r.id, id: r.id, name: r.name, note: r.note ?? "", onPath: false, minutes: String(r.minutes) })),
];
const complete = (r: Row) => Boolean(r.name.trim()) && (!r.onPath || (Number(r.minutes) >= 1 && Number(r.minutes) <= 240));
/** Rows as rooms (new ones get a stand-in id), for working out times before saving. */
const asRooms = (rows: Row[]): Room[] => {
  let stop = 0;
  return rows.filter(complete).map((r) => ({ id: r.id ?? r.key, name: r.name.trim(), note: r.note.trim() || null, path_order: r.onPath ? ++stop : null, minutes: Number(r.minutes) || 20 }));
};
const EX = "placeholder:italic placeholder:text-disabled";
const ARROW =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-field-border bg-surface hover:border-brand disabled:cursor-not-allowed disabled:border-border disabled:bg-background disabled:text-disabled";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

function duration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${plural(h, "hour", "hours")}${m ? ` ${plural(m, "minute", "minutes")}` : ""}` : plural(m, "minute", "minutes");
}

/** What changed since the last save, in words ("Performance hall 20 → 25 minutes"). */
function describe(base: Snapshot, rows: Row[], interval: string, passing: string) {
  const out: string[] = [];
  const kept = rows.filter((r) => r.id || complete(r));
  for (const r of kept) {
    const old = base.rooms.find((b) => b.id === r.id);
    const name = r.name.trim() || old?.name || "a room";
    if (!old) {
      if (complete(r)) out.push(`Added ${name}`);
      continue;
    }
    if (old.name !== r.name.trim()) out.push(`Renamed ${old.name} to ${r.name.trim()}`);
    if (r.onPath && old.minutes !== Number(r.minutes)) out.push(`${name} ${old.minutes} → ${r.minutes || "?"} minutes`);
    if ((old.note ?? "") !== r.note.trim()) out.push(`Changed where ${name} is`);
  }
  for (const old of base.rooms) if (!rows.some((r) => r.id === old.id)) out.push(`Removed ${old.name}`);
  const before = pathRooms(base.rooms).map((r) => r.id);
  const now = rows.filter((r) => r.onPath && r.id && before.includes(r.id)).map((r) => r.id);
  if (now.join() !== before.filter((id) => now.includes(id)).join()) out.push("Changed the order of the rooms");
  if (Number(interval) !== base.interval && interval) out.push(`A new group starts every ${interval} minutes (was ${base.interval})`);
  if (Number(passing) !== base.passing && passing !== "") out.push(`Walking time ${passing} minutes (was ${base.passing})`);
  return out;
}

/**
 * Step 2's rooms (boards 2 and 3), and the Rooms tab once live: the rooms every group visits in order, rooms outside
 * the rotation, the walking time, and how often a new group starts. Before the schedule is posted each complete
 * row saves itself; once posted, changes wait for Save and the "Save the new times?" window (board 12). Removing a
 * room asks first (board 4).
 */
export function RoomsEditor({
  eventId,
  initial,
  groupNames,
  days,
  tz,
  next,
}: {
  eventId: string;
  initial: Snapshot;
  /** Every registered group's name, by id (for the windows). */
  groupNames: Record<string, string>;
  days: string[];
  tz: string;
  /** During setup: the next step, in the pinned bar. */
  next?: { href: string; label: string };
}) {
  const [base, setBase] = useState(initial);
  const [rows, setRows] = useState<Row[]>(() => (initial.rooms.length ? toRows(initial.rooms) : [blank(true)]));
  const [interval, setIntervalMinutes] = useState(String(initial.interval));
  const [passing, setPassing] = useState(String(initial.passing));
  const [announce, setAnnounce] = useState("");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saving, setSaving] = useState<{ open: boolean; title?: string; intro?: string; danger?: boolean; keep?: string; saveLabel?: string; busy: boolean; error: string | null }>({
    open: false,
    busy: false,
    error: null,
  });
  const [blocked, setBlocked] = useState<{ roomId: string; roomName: string; groups: { id: string; name: string }[]; version: number } | null>(null);
  const [blockedEmail, setBlockedEmail] = useState(true);
  const [blockedBusy, setBlockedBusy] = useState(false);
  const arrows = useRef(new Map<string, HTMLButtonElement | null>());
  const posted = base.posted;
  // Before a Remove window (to put back if they keep the room), and my change when a co-host saved first.
  const restore = useRef<Row[] | null>(null);
  const mineRef = useRef<{ rows: Row[]; interval: string; passing: string } | null>(null);

  const labels = describe(base, rows, interval, passing);
  const dirty = labels.length > 0;
  const plan = { starts: base.starts, order: base.order };
  const hasTimes = [...planTimes(plan, base.rooms, base.interval, base.passing, days, tz).values()].some((t) => t.length > 0);

  /** Groups whose times this change moves, old and new. */
  const changesFor = (r: Row[], iv: string, ps: string) => {
    const names = new Map([...roomNameMap(base.rooms), ...roomNameMap(asRooms(r))]);
    return timeChanges(
      planTimes(plan, base.rooms, base.interval, base.passing, days, tz),
      planTimes(plan, asRooms(r), Number(iv) || base.interval, Number(ps === "" ? base.passing : ps), days, tz),
      names,
      tz,
      base.order.map((o) => o.bandId),
      { multi: days.length > 1 },
    ).map((c) => ({ name: groupNames[c.bandId] ?? "A group", text: c.text }));
  };

  /** Sends rows, walking time, and spacing. Rows still being filled in wait; a saved row that's emptied says why. */
  const send = async (list: Row[], iv: string, ps: string, email: boolean): Promise<RunResult> => {
    const half = list.find((r) => r.id && !complete(r));
    if (half) return { kind: "incomplete", what: !half.name.trim() ? "Fill in the room's name." : `Fill in the minutes for ${half.name.trim()} (1 to 240).` };
    if (list.some((r) => complete(r)) && (!iv || Number(iv) < 5 || Number(iv) > 240)) return { kind: "incomplete", what: "Fill in how often a new group starts (5 to 240 minutes)." };
    if (ps === "" || Number(ps) > 60) return { kind: "incomplete", what: "Fill in the walking time between rooms (0 to 60 minutes)." };
    const sent = list.filter((r) => r.id || complete(r));
    const roomsChanged = describe(base, sent, base.interval.toString(), base.passing.toString()).length > 0;
    const said = describe(base, sent, iv, ps);
    if (!said.length) return { kind: "nothing" };
    let r: SaveResult;
    try {
      r = await saveRooms(eventId, {
        rooms: roomsChanged ? sent.map<RoomInput>((x) => ({ id: x.id, name: x.name, note: x.note, onPath: x.onPath, minutes: Number(x.minutes) || 20 })) : null,
        interval: Number(iv) || base.interval,
        passing: Number(ps),
        expectedVersion: base.version,
        summary: said.join("; "),
        email,
      });
    } catch {
      return { kind: "failed", error: "Check your connection, then select Retry.", retry: true };
    }
    return land(r, sent, iv, ps);
  };

  /** What a save's answer means for the rows on screen. */
  const land = (r: SaveResult, sent: Row[], iv: string, ps: string): RunResult => {
    if ("conflict" in r) {
      mineRef.current = { rows, interval: iv, passing: ps };
      setConflict(r.conflict);
      return { kind: "conflict" };
    }
    if ("cantRemove" in r) {
      // Put the room back where it was, and say why.
      const back = base.rooms.find((x) => x.id === r.cantRemove.roomId);
      if (back) setRows((list) => (list.some((x) => x.id === back.id) ? list : [...toRows([back]), ...list].sort((a, b) => order(a) - order(b))));
      setBlocked(r.cantRemove);
      return { kind: "failed", error: `${r.cantRemove.roomName} can't be removed.`, retry: false };
    }
    if ("error" in r) return { kind: "failed", error: r.error, retry: r.error.startsWith("Something went wrong") };
    const fresh = r.rooms ?? base.rooms;
    // New rows get the ids the database gave them (the first unclaimed room with the same name).
    const claimed = new Set(sent.filter((x) => x.id).map((x) => x.id));
    const ids = new Map<string, string>();
    for (const x of sent.filter((s) => !s.id)) {
      const match = fresh.find((f) => !claimed.has(f.id) && f.name === x.name.trim());
      if (match) {
        claimed.add(match.id);
        ids.set(x.key, match.id);
      }
    }
    setRows((list) => list.map((x) => (ids.has(x.key) ? { ...x, id: ids.get(x.key) } : x)));
    setBase((b) => ({ ...b, version: r.version, rooms: fresh, interval: Number(iv) || b.interval, passing: Number(ps) }));
    return { kind: "saved" };
  };
  const order = (row: Row) => {
    const i = base.rooms.findIndex((b) => b.id === row.id);
    return i < 0 ? 999 : i;
  };

  const saver = useSaveQueue(() => (posted ? Promise.resolve<RunResult>({ kind: "nothing" }) : send(rows, interval, passing, false)), "A change to the rooms");
  const { hold } = saver;
  useEffect(() => hold(posted && dirty), [hold, posted, dirty]);

  const edit = (nextRows: Row[] | ((list: Row[]) => Row[]), now = false) => {
    setRows(nextRows);
    if (!posted) saver.queue(now);
  };
  const set = (key: string, patch: Partial<Row>) => edit((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const path = rows.filter((r) => r.onPath);
  const outside = rows.filter((r) => !r.onPath);
  const move = (row: Row, by: -1 | 1) => {
    const i = path.indexOf(row);
    const j = i + by;
    if (j < 0 || j >= path.length) return;
    const nextPath = [...path];
    [nextPath[i], nextPath[j]] = [nextPath[j], nextPath[i]];
    edit([...nextPath, ...outside], true);
    setAnnounce(`Moved ${row.name.trim() || "the room"} ${by < 0 ? "earlier" : "later"}, to ${ordinal(j + 1)}`);
    requestAnimationFrame(() => {
      const end = (by < 0 && j === 0) || (by > 0 && j === path.length - 1);
      arrows.current.get(`${row.key}:${end ? -by : by}`)?.focus();
    });
  };

  const remove = async (row: Row) => {
    const name = row.name.trim() || "this room";
    const without = rows.filter((r) => r.key !== row.key);
    if (!row.id) {
      edit(without.length ? without : [blank(true)]);
      return;
    }
    const lose = changesFor(without, interval, passing);
    if (posted) {
      setRows(without);
      setSaving({
        open: true,
        title: `Remove ${name}?`,
        intro: `The schedule is posted. ${lose.length ? `${plural(lose.length, "group loses", "groups lose")} their ${name} time.` : "Nobody's times change."}`,
        danger: true,
        keep: "Keep the room",
        saveLabel: `Remove ${name}`,
        busy: false,
        error: null,
      });
      restore.current = rows;
      return;
    }
    const ok = await confirmDialog({
      title: `Remove ${name}?`,
      message: !hasTimes
        ? "No group has times yet, so nobody is affected."
        : lose.length
          ? `${plural(lose.length, "group loses", "groups lose")} their ${name} time. Nobody is emailed: the schedule isn't posted yet.`
          : "Nobody's times change.",
      confirmLabel: `Remove ${name}`,
      cancelLabel: "Keep the room",
      danger: true,
    });
    if (ok) edit(without.length ? without : [blank(true)], true);
  };

  // Posted: Save opens the window; the window saves.
  const openSave = () => setSaving({ open: true, busy: false, error: null });
  const closeSave = () => {
    // Closing a Remove window keeps the room.
    if (restore.current) setRows(restore.current);
    restore.current = null;
    setSaving({ open: false, busy: false, error: null });
  };
  const confirmSave = async (email: boolean) => {
    setSaving((s) => ({ ...s, busy: true, error: null }));
    const r = await send(rows, interval, passing, email);
    if (r.kind === "saved" || r.kind === "nothing") {
      restore.current = null;
      setSaving({ open: false, busy: false, error: null });
      saver.setStatus({ kind: "saved" });
    } else if (r.kind === "conflict") {
      restore.current = null;
      setSaving({ open: false, busy: false, error: null });
    }
    else if (r.kind === "failed" || r.kind === "incomplete") {
      if (r.kind === "failed" && r.error.endsWith("can't be removed.")) setSaving({ open: false, busy: false, error: null });
      else setSaving((s) => ({ ...s, busy: false, error: r.kind === "failed" ? r.error : r.what }));
    }
  };
  const undo = () => {
    setRows(toRows(base.rooms).length ? toRows(base.rooms) : [blank(true)]);
    setIntervalMinutes(String(base.interval));
    setPassing(String(base.passing));
  };

  // A co-host saved first: theirs, with my changes on top.
  const resolve = (addMine: boolean) => {
    const c = conflict;
    const mine = mineRef.current ?? { rows, interval, passing };
    if (!c) return;
    const theirs = c.snapshot;
    setConflict(null);
    mineRef.current = null;
    if (!addMine) {
      setBase(theirs);
      setRows(theirs.rooms.length ? toRows(theirs.rooms) : [blank(true)]);
      setIntervalMinutes(String(theirs.interval));
      setPassing(String(theirs.passing));
      saver.setStatus({ kind: "idle" });
      saver.clear();
      return;
    }
    const merged = merge(base, theirs, mine.rows);
    const iv = Number(mine.interval) !== base.interval ? mine.interval : String(theirs.interval);
    const ps = Number(mine.passing) !== base.passing ? mine.passing : String(theirs.passing);
    setBase(theirs);
    setRows(merged);
    setIntervalMinutes(iv);
    setPassing(ps);
    if (theirs.posted) requestAnimationFrame(openSave);
    else saver.queue(true);
  };

  const pathComplete = asRooms(rows).filter((r) => r.path_order != null);
  const longest = pathComplete.reduce<Room | null>((a, r) => (!a || r.minutes > a.minutes ? r : a), null);
  const ivNum = Number(interval);
  const long = ivNum ? tooLongRooms(asRooms(rows), ivNum) : [];
  const walk = Number(passing) || 0;
  const perGroup = pathComplete.reduce((n, r) => n + r.minutes, 0) + walk * Math.max(pathComplete.length - 1, 0);
  const changes = saving.open ? changesFor(rows, interval, passing) : [];
  const todo = !base.rooms.length && !rows.some(complete) ? "Add your first room" : null;

  const roomRow = (r: Row, i: number, inPath: boolean) => {
    const label = r.name.trim() || (inPath ? `room ${i + 1}` : "this room");
    return (
      <li key={r.key} className="py-4 first:pt-2">
        <div className="flex flex-wrap items-center gap-2">
          {inPath && (
            <span className="w-7 text-lg font-semibold text-muted tabular-nums" aria-hidden>
              {i + 1}.
            </span>
          )}
          {inPath && path.length > 1 && (
            <>
              <button
                type="button"
                ref={(el) => void arrows.current.set(`${r.key}:-1`, el)}
                className={ARROW}
                disabled={i === 0}
                onClick={() => move(r, -1)}
                aria-label={`Move ${label} earlier`}
              >
                <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path d="M12 19V5M6 11l6-6 6 6" />
                </svg>
              </button>
              <button
                type="button"
                ref={(el) => void arrows.current.set(`${r.key}:1`, el)}
                className={ARROW}
                disabled={i === path.length - 1}
                onClick={() => move(r, 1)}
                aria-label={`Move ${label} later`}
              >
                <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path d="M12 5v14M6 13l6 6 6-6" />
                </svg>
              </button>
            </>
          )}
          {(rows.length > 1 || r.id || r.name || r.minutes || r.note) && (
            <button
              type="button"
              onClick={() => void remove(r)}
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-danger underline underline-offset-4 hover:bg-danger/5"
            >
              Remove {label}
            </button>
          )}
        </div>
        <div className={`mt-3 grid gap-3 ${inPath ? "sm:grid-cols-[1fr_9rem_1fr]" : "sm:grid-cols-2"}`}>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-semibold">Room name</span>
            <Input value={r.name} maxLength={80} onChange={(e) => set(r.key, { name: e.target.value })} placeholder={inPath ? "For example, Warm-up room" : "For example, Hospitality room"} className={EX} />
          </label>
          {inPath && (
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-semibold">Minutes per group</span>
              <NumberInput value={r.minutes} maxLength={3} onChange={(e) => set(r.key, { minutes: e.target.value })} placeholder="For example, 15" className={EX} />
            </label>
          )}
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-semibold">Where it is (optional)</span>
            <Input value={r.note} maxLength={200} onChange={(e) => set(r.key, { note: e.target.value })} placeholder={inPath ? "For example, Room 112, east hallway" : "For example, Library"} className={EX} />
          </label>
        </div>
      </li>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
      <h2 className="text-lg font-semibold">Rooms, in the order groups visit them</h2>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <ol className="mt-2 divide-y divide-border">{path.map((r, i) => roomRow(r, i, true))}</ol>
      <Button type="button" variant="secondary" className="mt-2" onClick={() => edit((list) => [...list.filter((x) => x.onPath), blank(true), ...list.filter((x) => !x.onPath)])}>
        Add a room
      </Button>
      {!pathComplete.length && <p className="mt-4 text-sm text-muted">Most festivals have a warm-up room, a performance hall, and a sight-reading room.</p>}

      {pathComplete.length > 0 && (
        <>
          <div className="mt-6 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Walking time between rooms (minutes)</span>
              <NumberInput value={passing} maxLength={2} onChange={(e) => (setPassing(e.target.value), !posted && saver.queue())} className="max-w-[8rem]" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">A new group starts every (minutes)</span>
              <NumberInput value={interval} maxLength={3} onChange={(e) => (setIntervalMinutes(e.target.value), !posted && saver.queue())} className="max-w-[8rem]" />
              {longest && (
                <span className="text-sm text-muted">
                  At least as long as your longest room ({longest.name}, {plural(longest.minutes, "minute", "minutes")}), so a room never has two groups at once.
                </span>
              )}
            </label>
          </div>
          {long.length > 0 && (
            <div role="alert" className="mt-4 rounded-md border border-warning/40 bg-warning-soft p-4 text-sm leading-6">
              <p className="font-semibold">
                <span aria-hidden>◆ </span>
                {long.length === 1 ? `${long[0].name} would have two groups at once` : `${long.map((r) => r.name).join(" and ")} would have two groups at once`}
              </p>
              <p>
                {long[0].name} is {plural(long[0].minutes, "minute", "minutes")}, but a new group starts every {plural(ivNum, "minute", "minutes")}. Start a group every{" "}
                {Math.max(...long.map((r) => r.minutes))} minutes, or shorten {long.length === 1 ? long[0].name : "those rooms"}. The schedule can&apos;t be posted until then.
              </p>
              <Button
                type="button"
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  setIntervalMinutes(String(Math.max(...long.map((r) => r.minutes))));
                  if (!posted) saver.queue(true);
                }}
              >
                Start a group every {Math.max(...long.map((r) => r.minutes))} minutes
              </Button>
            </div>
          )}
          <p className="mt-4 text-sm leading-6">
            <span className="font-semibold">Each group goes:</span>{" "}
            {pathComplete.map((r, i) => `${i ? "then " : ""}${r.name} (${r.minutes} min)`).join(", ")}. About {duration(perGroup)} per group.
          </p>
        </>
      )}

      <div className="mt-6 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">Rooms outside the rotation (optional)</h3>
        <p className="text-sm text-muted">Listed on the festival page, with no times. For example, a hospitality room or where buses park.</p>
        {outside.length > 0 && <ul className="divide-y divide-border">{outside.map((r, i) => roomRow(r, i, false))}</ul>}
        <Button type="button" variant="secondary" className="mt-2" onClick={() => edit((list) => [...list, blank(false)])}>
          Add a room outside the rotation
        </Button>
      </div>

      <SaveFooter
        status={saver.status}
        retry={() => void saver.fire()}
        next={next}
        todo={todo}
        notPosted={!next && !posted}
        postedIdle={posted}
        posted={posted && dirty ? { summary: `${labels.join("; ")}.`, onSave: openSave, onUndo: undo, busy: saving.busy } : null}
      />

      <SaveTimesWindow
        key={saving.open ? `open-${saving.title ?? ""}` : "closed"}
        open={saving.open}
        title={saving.title}
        intro={
          saving.intro ? (
            <p>{saving.intro}</p>
          ) : (
            <p>
              {labels.join("; ")}.
            </p>
          )
        }
        changes={changes}
        busy={saving.busy}
        error={saving.error}
        onSave={(email) => void confirmSave(email)}
        onClose={closeSave}
        keepLabel={saving.keep}
        saveLabel={saving.saveLabel}
        danger={saving.danger}
      />

      <ConflictWindow conflict={conflict} mine={labels.join("; ")} onAddMine={() => resolve(true)} onDropMine={() => resolve(false)} />

      <Window
        open={Boolean(blocked)}
        title={`${blocked?.roomName ?? "This room"} can't be removed`}
        onClose={() => setBlocked(null)}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => setBlocked(null)} disabled={blockedBusy}>
              Keep the room
            </Button>
            {blocked && blocked.groups.length > 0 && (
              <Button
                type="button"
                disabled={blockedBusy}
                aria-busy={blockedBusy}
                onClick={async () => {
                  if (!blocked) return;
                  setBlockedBusy(true);
                  const r = await skipRoomForRest(eventId, {
                    roomId: blocked.roomId,
                    roomName: blocked.roomName,
                    bandIds: blocked.groups.map((g) => g.id),
                    expectedVersion: blocked.version,
                    email: posted && blockedEmail,
                  });
                  setBlockedBusy(false);
                  setBlocked(null);
                  if ("ok" in r) {
                    setBase((b) => ({ ...b, version: r.version }));
                    saver.setStatus({ kind: "saved" });
                  } else if ("conflict" in r) setConflict(r.conflict);
                  else if ("error" in r) saver.setStatus({ kind: "failed", error: r.error, retry: false });
                }}
              >
                {blockedBusy ? "Saving…" : "Skip it for the groups still to come"}
              </Button>
            )}
          </>
        }
      >
        <p>The team has marked groups in {blocked?.roomName}, so removing it would lose those marks.</p>
        {blocked && blocked.groups.length > 0 ? (
          <>
            <p>
              To stop using it, skip it for the {plural(blocked.groups.length, "group", "groups")} still to come: {blocked.groups.map((g) => g.name).join(", ")}.
            </p>
            {posted && <EmailChoice count={blocked.groups.length} email={blockedEmail} setEmail={setBlockedEmail} />}
          </>
        ) : (
          <p>Every group with a time there has been marked, so there&apos;s nothing left to skip.</p>
        )}
      </Window>
    </div>
  );
}

/** A co-host's rooms, with my changes on top: my edits to rooms they kept, my new rooms, my removals, and my order. */
function merge(base: Snapshot, theirs: Snapshot, mine: Row[]): Row[] {
  const removed = new Set(base.rooms.filter((b) => !mine.some((r) => r.id === b.id)).map((b) => b.id));
  let rows = toRows(theirs.rooms).filter((r) => !removed.has(r.id!));
  rows = rows.map((r) => {
    const m = mine.find((x) => x.id === r.id);
    const b = base.rooms.find((x) => x.id === r.id);
    if (!m || !b) return r;
    return {
      ...r,
      name: m.name.trim() !== b.name ? m.name : r.name,
      note: m.note.trim() !== (b.note ?? "") ? m.note : r.note,
      minutes: Number(m.minutes) !== b.minutes ? m.minutes : r.minutes,
      onPath: m.onPath !== (b.path_order != null) ? m.onPath : r.onPath,
    };
  });
  // My order, for the rooms we both have.
  const before = pathRooms(base.rooms).map((r) => r.id);
  const mineOrder = mine.filter((r) => r.onPath && r.id).map((r) => r.id!);
  if (mineOrder.join() !== before.filter((id) => mineOrder.includes(id)).join()) {
    const inPath = rows.filter((r) => r.onPath);
    const sorted = [...inPath].sort((a, b) => {
      const ia = mineOrder.indexOf(a.id!);
      const ib = mineOrder.indexOf(b.id!);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    rows = [...sorted, ...rows.filter((r) => !r.onPath)];
  }
  const fresh = mine.filter((r) => !r.id);
  return [...rows.filter((r) => r.onPath), ...fresh.filter((r) => r.onPath), ...rows.filter((r) => !r.onPath), ...fresh.filter((r) => !r.onPath)];
}

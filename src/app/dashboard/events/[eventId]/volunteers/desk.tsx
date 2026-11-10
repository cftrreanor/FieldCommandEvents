"use client";

import { startTransition, useMemo, useOptimistic, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Button, Input } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { confirmDialog } from "@/components/confirm-dialog";
import { VolunteerTags } from "@/components/volunteer-tags";
import { folderTab, folderTabNote, folderTabRow } from "@/components/folder-tabs";
import { BinIcon } from "../forms";
import { MAX_OTHERS } from "@/lib/group-signup";

// The shared buttons: blue for the one main action, an outline for the rest, a plain link for small
// moves, and red text with a bin for taking something off a list. 44px tall, 14px words.
const BASE = "inline-flex min-h-11 items-center justify-center gap-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
const OUTLINE = `${BASE} rounded-md border-[1.5px] border-field-border bg-surface px-4 text-foreground hover:border-brand`;
const LINK = `${BASE} text-brand underline underline-offset-4 hover:text-brand-hover`;
const ROW_DELETE = `${BASE} px-1.5 text-danger underline-offset-4 hover:underline`;

export type DeskVolunteer = {
  assignmentId: string;
  name: string;
  phone: string | null;
  phoneDisplay: string | null;
  email: string | null;
  walkUp: boolean;
  /** Under 18 / a student: their phone is a guardian's. */
  minor: boolean;
  /** Who signed them up, if someone else did. */
  signedUpBy: string | null;
  /** A minor whose parent or guardian confirmed at sign-up. */
  guardianConfirmed?: boolean;
  checkedIn: boolean;
};

export type DeskShift = {
  id: string;
  title: string;
  time: string;
  capacity: number;
  /** Has started (event day): anyone who hasn't checked in is "not here yet". */
  started: boolean;
  now: boolean;
  over: boolean;
  volunteers: DeskVolunteer[];
};

export type DeskStation = {
  id: string;
  name: string;
  /** "Parking", "Check-in point"… for stations on the bands' path. */
  kind: string | null;
  /** No one under 18 on this sign-up's shifts. */
  adultsOnly: boolean;
  shifts: DeskShift[];
};

type AddWalkUp = (shiftId: string, overCapacity: boolean, prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * The volunteer desk: an Overview (who's not here yet, where help is needed now)
 * and a tab per station with its shifts. Check people in, add walk-ups, and
 * release no-shows' spots.
 */
export function Desk({
  stations,
  eventDay,
  open,
  opensOn,
  toggle,
  addWalkUp,
  release,
}: {
  stations: DeskStation[];
  eventDay: boolean;
  /** Check-in and walk-ups are on (the day before through the event). Otherwise the lists are read-only. */
  open: boolean;
  /** When they turn on, for the note shown before then. */
  opensOn: string;
  toggle: (assignmentId: string, checkedIn: boolean) => Promise<ActionState>;
  addWalkUp: AddWalkUp;
  release: (assignmentId: string) => Promise<ActionState>;
}) {
  const [tab, setTab] = useState<string>("overview");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useOptimistic(stations, (state, change: { id: string; checkedIn: boolean }) =>
    state.map((st) => ({
      ...st,
      shifts: st.shifts.map((sh) => ({
        ...sh,
        volunteers: sh.volunteers.map((v) => (v.assignmentId === change.id ? { ...v, checkedIn: change.checkedIn } : v)),
      })),
    })),
  );

  const everyone = optimistic.flatMap((st) => st.shifts.flatMap((sh) => sh.volunteers));
  const here = everyone.filter((v) => v.checkedIn).length;

  function onToggle(v: DeskVolunteer) {
    setError(null);
    startTransition(async () => {
      setOptimistic({ id: v.assignmentId, checkedIn: !v.checkedIn });
      try {
        const result = await toggle(v.assignmentId, !v.checkedIn);
        if (result.error) setError(result.error);
      } catch {
        setError("That didn't go through. Check your signal and tap again.");
      }
    });
  }

  // Searching looks across every sign-up.
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q
        ? optimistic.flatMap((st) =>
            st.shifts.flatMap((sh) =>
              sh.volunteers
                .filter((v) => [v.name, v.phone ?? "", v.phoneDisplay ?? "", v.email ?? ""].some((x) => x.toLowerCase().includes(q)))
                .map((v) => ({ v, st, sh })),
            ),
          )
        : [],
    [optimistic, q],
  );

  const current = optimistic.find((s) => s.id === tab);
  const rowProps = { onToggle, release, eventDay, open };

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">
            <span className="text-2xl font-semibold tabular-nums">{here}</span>
            <span className="text-muted"> / {everyone.length} checked in</span>
          </p>
          <Input
            type="search"
            placeholder="Find someone by name or phone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="sm:max-w-xs"
            aria-label="Find a volunteer"
          />
        </div>
        {error && (
          <p className="mt-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
      {!open && (
        <p className="mt-4 rounded-md border border-border bg-surface px-3 py-2 text-sm">
          Check-in and walk-ups turn on the day before the event, {opensOn}, so no one gets checked in early.
        </p>
      )}

      {q ? (
        <section className="mt-5" aria-label="Search results">
          {matches.length === 0 ? (
            <p className="text-muted">No one matches that. Adding a walk-up? Open their sign-up&apos;s tab.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {matches.map(({ v, st, sh }) => (
                <VolunteerRow key={v.assignmentId} v={v} shift={sh} detail={`${st.name} · ${sh.time}`} {...rowProps} />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          <div role="group" aria-label="Jobs" className="relative -mx-4 mt-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className={folderTabRow}>
              <TabButton active={tab === "overview"} onClick={() => setTab("overview")} label="Overview" sub="Who's not here yet" />
              {optimistic.map((s) => {
                const people = s.shifts.flatMap((sh) => sh.volunteers);
                return (
                  <TabButton
                    key={s.id}
                    active={tab === s.id}
                    onClick={() => setTab(s.id)}
                    label={s.name}
                    sub={people.length ? `${people.filter((v) => v.checkedIn).length} of ${people.length} here` : "No one signed up yet"}
                  />
                );
              })}
            </div>
          </div>

          {current ? (
            <div className="mt-4 space-y-4">
              {current.shifts.length === 0 && <p className="text-sm text-muted">No shifts in this sign-up.</p>}
              {current.shifts.map((sh) => (
                <ShiftCard key={sh.id} shift={sh} adultsOnly={current.adultsOnly} addWalkUp={addWalkUp} {...rowProps} />
              ))}
            </div>
          ) : (
            <Overview stations={optimistic} openTab={setTab} {...rowProps} />
          )}
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, label, sub }: { active: boolean; onClick: () => void; label: string; sub: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={folderTab(active)}
    >
      <span className="whitespace-nowrap">{label}</span>
      <span className={folderTabNote()}>{sub}</span>
    </button>
  );
}

type RowProps = {
  onToggle: (v: DeskVolunteer) => void;
  release: (assignmentId: string) => Promise<ActionState>;
  eventDay: boolean;
  open: boolean;
};

function Overview({ stations, openTab, ...rowProps }: { stations: DeskStation[]; openTab: (id: string) => void } & RowProps) {
  const { eventDay } = rowProps;
  const notHere = stations.flatMap((st) =>
    st.shifts.filter((sh) => sh.started && !sh.over).flatMap((sh) => sh.volunteers.filter((v) => !v.checkedIn).map((v) => ({ v, st, sh }))),
  );
  const openNow = stations.flatMap((st) =>
    st.shifts.filter((sh) => sh.now && sh.volunteers.length < sh.capacity).map((sh) => ({ st, sh, gaps: sh.capacity - sh.volunteers.length })),
  );
  return (
    <div className="mt-4 space-y-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stations.map((st) => {
          const people = st.shifts.flatMap((sh) => sh.volunteers);
          const arrived = people.filter((v) => v.checkedIn).length;
          const gaps = st.shifts.filter((sh) => !sh.over).reduce((n, sh) => n + Math.max(0, sh.capacity - sh.volunteers.length), 0);
          return (
            <button
              key={st.id}
              type="button"
              onClick={() => openTab(st.id)}
              className="rounded-lg bg-surface px-3 py-2 text-left ring-1 ring-border hover:bg-background"
            >
              <p className="truncate text-xs text-muted">{st.name}</p>
              <p className="text-xl font-semibold tabular-nums">
                {arrived}
                <span className="text-sm font-normal text-muted"> / {people.length} here</span>
              </p>
              <p className="h-4 text-xs text-muted">{gaps ? `${gaps} open ${gaps === 1 ? "spot" : "spots"}` : ""}</p>
            </button>
          );
        })}
      </div>

      {!eventDay ? (
        <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm">
          On the day of the event, this shows who&apos;s not here yet for shifts that have started, and where walk-ups are needed.
        </p>
      ) : (
        <>
          <section>
            <h2 className="text-sm font-semibold">Not here yet ({notHere.length})</h2>
            <p className="text-sm text-muted">Their shift has started. Give them a call if you need them.</p>
            {notHere.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Everyone on the current shifts is here.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
                {notHere.map(({ v, st, sh }) => (
                  <VolunteerRow key={v.assignmentId} v={v} shift={sh} detail={`${st.name} · ${sh.time}`} {...rowProps} />
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="text-sm font-semibold">Need help now</h2>
            <p className="text-sm text-muted">Shifts happening now with open spots: send walk-ups here.</p>
            {openNow.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Every current shift is full.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {openNow.map(({ st, sh, gaps }) => (
                  <li key={sh.id}>
                    <button
                      type="button"
                      onClick={() => openTab(st.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:bg-background"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{st.name}</span>
                        <span className="block text-xs text-muted">{sh.time}</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold">
                        {gaps} open · Add walk-up →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ShiftCard({
  shift,
  adultsOnly,
  addWalkUp,
  ...rowProps
}: { shift: DeskShift; adultsOnly: boolean; addWalkUp: AddWalkUp } & RowProps) {
  const [adding, setAdding] = useState(false);
  const here = shift.volunteers.filter((v) => v.checkedIn).length;
  const gaps = shift.capacity - shift.volunteers.length;
  const full = gaps <= 0;
  return (
    <section
      aria-label={`${shift.title}, ${shift.time}`}
      // An ended shift stays full strength (late arrivals still check in); its "Ended" label says it's past.
      className={`overflow-hidden rounded-lg border bg-surface ${shift.now ? "border-brand ring-1 ring-brand" : "border-border"}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 bg-background px-3 py-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="truncate">{shift.time}</span>
            {shift.now && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-brand-foreground">Now</span>}
            {shift.over && <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-semibold text-muted">Ended</span>}
          </p>
          <p className="truncate text-xs text-muted">{shift.title}</p>
        </div>
        <p className="text-sm tabular-nums text-muted">
          {here} of {shift.volunteers.length} here · {shift.volunteers.length}/{shift.capacity} filled
        </p>
      </header>
      <ul className="divide-y divide-border">
        {shift.volunteers.map((v) => (
          <VolunteerRow key={v.assignmentId} v={v} shift={shift} {...rowProps} />
        ))}
        <li className="px-3 py-2">
          {adding ? (
            <WalkUpForm addWalkUp={addWalkUp} shiftId={shift.id} gaps={gaps} adultsOnly={adultsOnly} onDone={() => setAdding(false)} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted">{full ? "Full" : `${gaps} open ${gaps === 1 ? "spot" : "spots"}`}</span>
              {!shift.over && rowProps.open && (
                <button type="button" className={OUTLINE} onClick={() => setAdding(true)}>
                  + Add walk-up
                </button>
              )}
            </div>
          )}
        </li>
      </ul>
    </section>
  );
}

function WalkUpForm({
  addWalkUp,
  shiftId,
  gaps,
  adultsOnly,
  onDone,
}: {
  addWalkUp: AddWalkUp;
  shiftId: string;
  gaps: number;
  adultsOnly: boolean;
  onDone: () => void;
}) {
  const [others, setOthers] = useState<{ name: string; minor: boolean }[]>([]);
  const [minor, setMinor] = useState(false);
  // Same as the signup page: say so as soon as someone under 18 is ticked.
  const blocked = adultsOnly && (minor || others.some((o) => o.minor));
  // Everyone in the group needs a spot; past that, the desk confirms adding anyway.
  const full = gaps < 1 + others.length;
  const setOther = (i: number, change: Partial<{ name: string; minor: boolean }>) =>
    setOthers((prev) => prev.map((o, j) => (j === i ? { ...o, ...change } : o)));
  return (
    <ActionForm
      action={addWalkUp.bind(null, shiftId, full)}
      onSuccess={onDone}
      confirmMessage={full ? `This shift doesn't have room for ${others.length ? "everyone" : "them"}. Add anyway?` : undefined}
      className="space-y-2"
    >
      <p className="text-sm font-medium">
        Add a walk-up
        {adultsOnly && <span className="ml-2 text-xs font-normal text-muted">Adults only (18+)</span>}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input name="fullName" placeholder="Their name" required maxLength={200} autoComplete="off" aria-label="Their name" />
        <Input name="phone" type="tel" placeholder="Phone (optional)" maxLength={30} autoComplete="off" aria-label="Their phone (optional)" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="minor"
          checked={minor}
          onChange={(e) => setMinor(e.target.checked)}
          className="h-5 w-5 accent-[var(--brand)]"
        />
        Under 18 or a student
      </label>
      <input type="hidden" name="companions" value={JSON.stringify(others)} />
      {others.map((o, i) => (
        <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Input
            value={o.name}
            onChange={(e) => setOther(i, { name: e.target.value })}
            placeholder="Their name"
            aria-label={`Person ${i + 2} name`}
            required
            maxLength={200}
            autoComplete="off"
            className="min-w-0 basis-full sm:basis-auto sm:flex-1"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={o.minor}
              onChange={(e) => setOther(i, { minor: e.target.checked })}
              className="h-5 w-5 accent-[var(--brand)]"
            />
            Under 18
          </label>
          <button type="button" className={ROW_DELETE} onClick={() => setOthers((prev) => prev.filter((_, j) => j !== i))}>
            <BinIcon />
            Remove {o.name.trim() || "this person"}
          </button>
        </div>
      ))}
      {others.length < MAX_OTHERS && (
        <button
          type="button"
          className={LINK}
          onClick={() => setOthers((prev) => [...prev, { name: "", minor: false }])}
        >
          + Add someone else
        </button>
      )}
      {blocked && (
        <p role="alert" className="text-sm text-danger">
          This station is adults only (18+), so someone under 18 can&apos;t be added here. Try another sign-up.
        </p>
      )}
      <div className="flex gap-2">
        <SubmitButton pendingText="Adding…" disabled={blocked}>
          {others.length ? `Add ${others.length + 1} & check in` : "Add & check in"}
        </SubmitButton>
        <button type="button" className={OUTLINE} onClick={onDone}>
          Cancel
        </button>
      </div>
    </ActionForm>
  );
}

function VolunteerRow({
  v,
  shift,
  detail,
  onToggle,
  release,
  eventDay,
  open,
}: { v: DeskVolunteer; shift: DeskShift; detail?: string } & RowProps) {
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notHereYet = eventDay && shift.started && !v.checkedIn;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate font-medium">
          {v.name}
          <VolunteerTags minor={v.minor} guardianConfirmed={v.guardianConfirmed} />
          {v.walkUp && <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold">Walk-up</span>}
        </p>
        {v.signedUpBy && <p className="truncate text-xs text-muted">Booked by {v.signedUpBy}</p>}
        {detail && <p className="truncate text-sm text-muted">{detail}</p>}
        <p className="truncate text-sm text-muted">
          {v.phone && (
            <>
              {v.minor && "Guardian: "}
              <a href={`tel:${v.phone}`} className="font-medium text-brand hover:underline">
                {v.phoneDisplay}
              </a>
            </>
          )}
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {notHereYet && (
          <button
            type="button"
            className={ROW_DELETE}
            disabled={releasing}
            onClick={async () => {
              const ok = await confirmDialog({
                title: `Release ${v.name}'s spot?`,
                message: "They'll be taken off this shift so someone else can fill it.",
                confirmLabel: "Release spot",
                danger: true,
              });
              if (!ok) return;
              setReleasing(true);
              setError(null);
              release(v.assignmentId)
                .then((r) => r.error && setError(r.error))
                .catch(() => setError("That didn't go through. Try again."))
                .finally(() => setReleasing(false));
            }}
          >
            {!releasing && <BinIcon />}
            {releasing ? "Releasing…" : "Release spot"}
          </button>
        )}
        {!open ? (
          v.checkedIn && <span className="text-sm font-semibold text-success">✓ Here</span>
        ) : v.checkedIn ? (
          // Here: a status, not a button, with a small Undo beside it.
          <span className="flex items-center gap-3">
            <span className="text-sm font-semibold text-success">✓ Here</span>
            <button type="button" className={LINK} onClick={() => onToggle(v)} aria-label={`Undo check-in for ${v.name}`}>
              Undo
            </button>
          </span>
        ) : (
          <Button type="button" onClick={() => onToggle(v)} className="min-w-28" aria-label={`Check in ${v.name}`}>
            Check in
          </Button>
        )}
      </div>
    </li>
  );
}

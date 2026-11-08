"use client";

import { createContext, use, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { linkFrom, passcodeFrom } from "@/lib/meeting-link";
import { ActionForm } from "@/components/action-form";
import { AutosaveBar, useAutosaveForm } from "@/components/autosave";
import { NumberInput } from "@/components/number-input";
import { SubmitButton } from "@/components/submit-button";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { VenuePicker, type VenueValue } from "@/components/venue-picker";
import type { ActionState } from "@/lib/action-state";
import { brand } from "@/lib/brand";
import {
  AHEAD_DAYS,
  aheadLabel,
  GAP_LENGTHS,
  MEETING_LENGTHS,
  MODES,
  modesOf,
  meetingStarts,
  meetingSummary,
  NOTICE_HOURS,
  noticeLabel,
  dateRuns,
  datesBetween,
  groupWeekly,
  sortWeekly,
  WEEKDAYS,
  weeklyMeetingCount,
  type ConferenceSettings,
  type Mode,
  type Schedule,
  bookingsOutside,
  type BookedTime,
} from "@/lib/conferences";
import { displayTime, formatDuration } from "@/lib/schedule";
import { formatDate } from "@/lib/time";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

// Which tabs have unsaved changes: publishing waits until they're saved or
// cancelled (see "Setup pages" in docs/DESIGN.md).
const Editing = createContext<{ editing: string[]; set: (id: string, on: boolean) => void }>({ editing: [], set: () => {} });

/** The setup tabs and the Publish button, sharing which tabs are being edited. */
export function ConferenceSetup({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState<string[]>([]);
  const set = (id: string, on: boolean) =>
    setEditing((ids) => (on ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((x) => x !== id)));
  return (
    <Editing value={{ editing, set }}>
      {children}
    </Editing>
  );
}

function useEditing(id: string) {
  const { editing, set } = use(Editing);
  return [editing.includes(id), (on: boolean) => set(id, on)] as const;
}

/** The Publish / Unpublish button, or, while a tab has unsaved changes, a note to save them first. */
export function PublishWhenSaved({ children }: { children: ReactNode }) {
  const { editing } = use(Editing);
  return editing.length ? <p className="text-sm text-muted">To unpublish, save or undo your changes first.</p> : <>{children}</>;
}

/**
 * The Save bar pinned to the bottom of the screen until the tab's card ends,
 * saying whether anything's unsaved. Cancel shows only once something has changed.
 */
function SaveCancel({
  editing,
  onCancel,
  label,
  disabled,
  saved = true,
  problem = null,
}: {
  /** Why it can't save yet, with the id of where it's explained. */
  problem?: { text: string; target: string } | null;
  editing: boolean;
  onCancel: () => void;
  label: string;
  disabled?: boolean;
  /** Saved at least once (a new conference's steps start "Not saved yet"). */
  saved?: boolean;
}) {
  // Something changed (typing, or a button like Remove): leaving the tab asks first (setup-leave.tsx).
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editing) bar.current?.closest("form")?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [editing]);
  return (
    <div
      ref={bar}
      className="sticky bottom-[var(--day-bar,0px)] z-10 -mx-4 -mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-b-lg border-t-2 border-border bg-surface px-4 py-3 shadow-[0_-6px_16px_rgb(0_0_0/0.10)] sm:-mx-6 sm:-mb-6 sm:px-6"
    >
      <p className={`flex min-w-0 items-center gap-2 text-sm ${problem ? "basis-full sm:basis-auto sm:flex-1" : "flex-1"}`} aria-live="polite">
        {editing || !saved ? (
          <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-[#f5b301] ring-1 ring-warning/50" />
        ) : (
          <span aria-hidden className="font-bold text-success">
            ✓
          </span>
        )}
        <span className="font-semibold">{problem ? problem.text : editing ? "Unsaved changes" : saved ? "All changes saved" : "Not saved yet"}</span>
        {problem && (
          <button
            type="button"
            onClick={() => {
              const box = document.getElementById(problem.target);
              box?.scrollIntoView({ behavior: "smooth", block: "center" });
              box?.focus({ preventScroll: true });
            }}
            className="inline-flex min-h-11 items-center font-medium text-brand underline underline-offset-4"
          >
            Review
          </button>
        )}
      </p>
      {editing && (
        <Button type="button" variant="ghost" onClick={onCancel}>
          Undo changes
        </Button>
      )}
      <SubmitButton disabled={disabled || (saved && !editing)}>{label}</SubmitButton>
    </div>
  );
}

type BreakDraft = { key: number; start: string; minutes: string; label: string };
type GroupDraft = { key: number; days: number[]; start: string; end: string };
type DaysOffDraft = { key: number; from: string; to: string };

/** Who books, in this setup's words: families for conferences, people for meetings. */
const whoBooks = (meeting?: boolean) =>
  meeting
    ? { Families: "People", families: "people", family: "person", Family: "Person", school: "work" }
    : { Families: "Families", families: "families", family: "family", Family: "Family", school: "school" };

/** Days of the week, Sunday first (0), as short tap targets. */
const DAY_LETTERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type TimesProps = {
  action: Action;
  initial: ConferenceSettings;
  /** The conference day (or with weekly hours, the first day), "YYYY-MM-DD". */
  date: string;
  /** With weekly hours, the last day, "YYYY-MM-DD". */
  endDate: string;
  /** The conference's hours, "HH:MM" in the event's time zone. */
  start: string;
  end: string;
  /** How many meeting times families have booked. */
  booked: number;
  /** The account has a plan, so weekly hours can be published. */
  /** The account's plan includes weekly hours (20261223000000_packages.sql). */
  weeklyIncluded: boolean;
  planName: string | null;
  /** Meetings: "people" where conferences say "families". */
  meeting?: boolean;
  /**
   * In the setup steps, the form is split: the basics (one day or every week, the hours, how long
   * each meeting is) on Meeting times; the extras (time between meetings, breaks, the booking window)
   * on More options. Each sends only its own part; the server keeps the rest as saved.
   */
  part?: "basics" | "extras";
  /** Save a moment after each change (the setup steps, before anyone has booked), with this step next. */
  autosave?: { next?: { href: string; label: string } };
  /** "Make a weekly copy", when booked meetings keep this to one day. */
  copyAction?: () => Promise<void>;
  /** Booked meetings, to name any that new times would leave out before saving. */
  bookedTimes?: BookedTime[];
};

/** Step 1: one day or weekly hours, how long each meeting is, a gap between them, and breaks, with the meetings they make. */
export function MeetingTimesForm(props: TimesProps) {
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useEditing("times");
  return (
    <TimesForm
      key={version}
      {...props}
      editing={editing}
      setEditing={setEditing}
      onCancel={() => {
        setVersion((v) => v + 1);
        setEditing(false);
      }}
    />
  );
}

const SCHEDULES: { value: Schedule; label: string; hint: string }[] = [
  { value: "one_day", label: "One day", hint: "A conference day, like fall or spring conferences." },
  { value: "weekly", label: "Every week", hint: "The same times each week, like calls on Tuesday afternoons." },
];

function TimesForm({
  action,
  initial,
  date,
  endDate,
  start,
  end,
  booked,
  weeklyIncluded,
  planName,
  meeting: forMeetings,
  editing,
  setEditing: setEditingNow,
  onCancel,
  part,
  autosave,
  copyAction,
  bookedTimes = [],
}: TimesProps & { editing: boolean; setEditing: (on: boolean) => void; onCancel: () => void }) {
  const w = whoBooks(forMeetings);
  const basics = part !== "extras";
  const extras = part !== "basics";
  const auto = useAutosaveForm(Boolean(autosave), "A change to your meeting times");
  // Buttons (days, Add a break, Remove) change things without a form event: count them as a change too.
  const anchor = useRef<HTMLSpanElement>(null);
  const setEditing = (on: boolean) => {
    if (!autosave) return setEditingNow(on);
    if (on) setTimeout(() => {
      const f = anchor.current?.closest("form");
      if (f) auto.edited(f);
    }, 0);
  };
  // A new event's step starts with suggested hours: save them right away, so what's on screen is what's saved.
  const savedOnce = Boolean(initial.times_saved_at);
  useEffect(() => {
    if (!autosave || savedOnce || part === "extras") return;
    const f = anchor.current?.closest("form");
    if (f) auto.edited(f);
    // Once, when the step first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [schedule, setSchedule] = useState<Schedule>(initial.schedule);
  const weekly = schedule === "weekly";
  const [meeting, setMeeting] = useState(initial.meeting_minutes);
  const [gap, setGap] = useState(initial.gap_minutes);
  const [breaks, setBreaks] = useState<BreakDraft[]>(() =>
    initial.breaks.map((b, i) => ({ key: i, start: b.start, minutes: String(b.minutes), label: b.label })),
  );
  // Weekly hours as days that share the same times; each picked day is saved as its own block.
  const [groups, setGroups] = useState<GroupDraft[]>(() => {
    const saved = groupWeekly(initial.weekly_hours).map((g, i) => ({ key: i, ...g }));
    // Every week with no hours yet (a weekly copy, say): start from the day's weekday and hours.
    if (saved.length || initial.schedule !== "weekly") return saved;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    return [{ key: 0, days: Number.isNaN(weekday) ? [] : [weekday], start, end }];
  });
  const [nextKey, setNextKey] = useState(100);
  const newKey = () => {
    setNextKey((k) => k + 1);
    return nextKey;
  };
  // The day and hours can be changed right here; saving moves the event too.
  // A new conference (times never saved) starts with the day and hours open, since none were picked yet.
  const [changingHours, setChangingHours] = useState(!initial.times_saved_at);
  const [day, setDay] = useState(date);
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  const [firstDay, setFirstDay] = useState(date);
  const [lastDay, setLastDay] = useState(initial.schedule === "weekly" ? endDate : "");
  // Coming back from weekly hours to one day: pick the day. In the setup steps the day is always open.
  const askDay = autosave ? basics || initial.schedule === "weekly" : changingHours || (!weekly && initial.schedule === "weekly");
  const lengths = { meeting_minutes: meeting, gap_minutes: gap, breaks: breaks.map((b) => ({ start: b.start, minutes: Number(b.minutes) || 0, label: b.label })) };
  const starts = meetingStarts(from, to, lengths);
  const weeklyHours = groups.flatMap((g) => (g.start && g.end && g.end > g.start ? g.days.map((day) => ({ day, start: g.start, end: g.end })) : []));
  const perWeek = weeklyMeetingCount(weeklyHours, lengths);
  // Booked meetings these times would leave out: named before saving, and saving needs a tick.
  // Only the meetings this change leaves out: ones already outside (an earlier change, a day off) aren't counted again.
  const key = (b: BookedTime) => `${b.date} ${b.time} ${b.who}`;
  const alreadyOut = new Set(
    bookingsOutside(bookedTimes, {
      schedule: initial.schedule,
      day: date,
      from: start,
      to: end,
      weekly: initial.weekly_hours,
      firstDay: date,
      lastDay: endDate,
      lengths: initial,
      closed: initial.closed_dates,
      movesWithDay: true,
    }).map(key),
  );
  const outside = editing
    ? bookingsOutside(bookedTimes, { schedule, day, from, to, weekly: weeklyHours, firstDay, lastDay, lengths, closed: initial.closed_dates, movesWithDay: true }).filter(
        (b) => !alreadyOut.has(key(b)),
      )
    : [];
  // One day: how many times stay open for them to move to.
  const openLeft = !weekly && outside.length ? Math.max(0, starts.length - (bookedTimes.length - outside.length)) : null;
  // Too few open times for everyone: start on "I'll contact them myself", and say why.
  const short = openLeft !== null && openLeft < outside.length;
  const [choice, setChoice] = useState<"email" | "self" | null>(null);
  const picked = choice ?? (short ? "self" : "email");
  const changeGroup = (key: number, patch: Partial<GroupDraft>) => setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  const change = (key: number, patch: Partial<BreakDraft>) => setBreaks((bs) => bs.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  return (
    <ActionForm
      action={action}
      resetOnSuccess={false}
      className="space-y-5"
      onEdit={autosave ? auto.edited : () => setEditing(true)}
      onError={autosave ? auto.failed : undefined}
      quiet={Boolean(autosave)}
      noToast={Boolean(autosave)}
      // No days start picked, so each set of weekly hours needs at least one tapped.
      validate={() => (schedule === "weekly" && groups.some((g) => !g.days.length) ? { error: "Tap at least one day for each set of hours." } : null)}
      onSuccess={() => {
        if (autosave) auto.saved();
        else setEditing(false);
        setChangingHours(false);
      }}
    >
      <span ref={anchor} hidden />
      {part && <input type="hidden" name="part" value={part} />}
      {basics && (
      <fieldset>
        <legend className="text-sm font-semibold">When can {w.families} meet with you?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {SCHEDULES.map((o) => {
            // Booked meetings stay as booked: switching waits until they're canceled.
            const locked = booked > 0 && o.value !== initial.schedule;
            return (
            <label
              key={o.value}
              className={`flex gap-3 rounded-lg border p-3 ${locked ? "cursor-not-allowed border-dashed border-field-border" : "cursor-pointer"} ${schedule === o.value ? "border-brand bg-brand-soft" : locked ? "" : "border-field-border"}`}
            >
              <input
                type="radio"
                name="schedule"
                value={o.value}
                disabled={locked}
                checked={schedule === o.value}
                onChange={() => {
                  setSchedule(o.value);
                  // Switching to every week keeps what's set: the chosen day's weekday and hours, from that day
                  // for twelve weeks (decisions 2026-11-08, finding 1).
                  if (o.value === "weekly") {
                    if (!groups.length) {
                      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
                      setGroups([{ key: newKey(), days: Number.isNaN(weekday) ? [] : [weekday], start: from || "15:30", end: to || "16:30" }]);
                    }
                    if (!firstDay) setFirstDay(day);
                    // Never an empty, red Last day on switching: twelve weeks from the first day, to change.
                    if (!lastDay && day) setLastDay(new Date(Date.parse(`${firstDay || day}T12:00:00Z`) + 83 * 86_400_000).toISOString().slice(0, 10));
                  }
                  setEditing(true);
                }}
                className="team-radio mt-1"
              />
              <span>
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {o.label}
                  {/* Meetings always need a plan, so weekly hours aren't an extra for them. */}
                  {o.value === "weekly" && !forMeetings && <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-brand-foreground">Premium</span>}
                </span>
                <span className={`block text-sm ${locked ? "text-foreground" : "text-muted"}`}>
                  {locked ? (
                    // Never "cancel everyone to switch": say why, and offer a way to get more times (decisions 2026-11-07, finding 3).
                    <>
                      {booked === 1 ? `1 ${w.family} has` : `${booked} ${w.families} have`} booked, so this stays{" "}
                      {initial.schedule === "weekly" ? "weekly" : "one day"}.{" "}
                      {copyAction && o.value === "weekly" && (
                        <>
                          Need more times? <WeeklyCopyButton action={copyAction} />
                        </>
                      )}
                    </>
                  ) : forMeetings && o.value === "one_day" ? (
                    "A single day of meetings."
                  ) : (
                    o.hint
                  )}
                </span>
              </span>
            </label>
            );
          })}
        </div>
      </fieldset>
      )}

      {basics && weekly && !weeklyIncluded && (
        <p className="rounded-md border border-border bg-brand-soft px-3 py-2 text-sm leading-6">
          <strong>Your {planName ? `${planName} ` : ""}plan doesn&apos;t include weekly hours.</strong> You can set them up now. To publish them, write to us at{" "}
          <a href={`mailto:${brand.supportEmail}`} className="font-medium text-brand underline underline-offset-4">
            {brand.supportEmail}
          </a>{" "}
          about an upgrade.
        </p>
      )}

      {weekly && !basics ? (
        // More options, with weekly hours: the booking window.
        <BookingWindow initial={initial} who={w.Families} />
      ) : weekly ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First day">
              <Input type="date" name="weeklyFrom" required value={firstDay} onChange={(e) => setFirstDay(e.target.value)} />
            </Field>
            <Field label="Last day" hint="For example, the last day of the semester.">
              <Input type="date" name="weeklyTo" required min={firstDay} value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
            </Field>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold">Weekly hours</legend>
            <p className="text-sm text-muted">Choose the days you meet, then set your hours.</p>
            <ul className="mt-3 space-y-3">
              {groups.map((g, gi) => (
                <li key={g.key} className="space-y-3 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={groups.length > 1 ? `Days for hours ${gi + 1}` : "Days"}>
                    {DAY_LETTERS.map((label, day) => {
                      const on = g.days.includes(day);
                      return (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={on}
                          aria-label={WEEKDAYS[day]}
                          onClick={() => {
                            changeGroup(g.key, { days: on ? g.days.filter((d) => d !== day) : [...g.days, day].sort() });
                            setEditing(true);
                          }}
                          className={`min-h-11 min-w-12 rounded-md border px-2 text-sm font-semibold ${
                            on ? "border-brand bg-brand text-brand-foreground" : "border-field-border hover:border-brand"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[10.5rem_10.5rem_auto]">
                    <Field label="From">
                      <Input type="time" required value={g.start} onChange={(e) => changeGroup(g.key, { start: e.target.value })} />
                    </Field>
                    <Field label="To">
                      <Input type="time" required value={g.end} onChange={(e) => changeGroup(g.key, { end: e.target.value })} />
                    </Field>
                    {groups.length > 1 && (
                      <Button
                        type="button"
                        variant="danger"
                        className="col-span-2 sm:col-span-1"
                        onClick={() => {
                          setGroups((gs) => gs.filter((x) => x.key !== g.key));
                          setEditing(true);
                        }}
                      >
                        Remove Hours
                      </Button>
                    )}
                  </div>
                  {/* Saved as one block per day. */}
                  {g.days.map((day) => (
                    <span key={day} hidden>
                      <input type="hidden" name="weeklyDay" value={day} />
                      <input type="hidden" name="weeklyStart" value={g.start} />
                      <input type="hidden" name="weeklyEnd" value={g.end} />
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            {groups.length < 7 && (
              <Button
                type="button"
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  setGroups((gs) => [...gs, { key: newKey(), days: [], start: "15:30", end: "16:30" }]);
                  setEditing(true);
                }}
              >
                + Add different hours
              </Button>
            )}
          </fieldset>

          {!extras && (
            <>
              <input type="hidden" name="minNotice" value={initial.min_notice_hours} />
              <input type="hidden" name="maxAhead" value={initial.max_days_ahead} />
            </>
          )}
          {extras && <BookingWindow initial={initial} who={w.Families} />}
        </div>
      ) : !basics ? null : askDay ? (
        <div className="grid gap-4 rounded-lg border border-border p-3 sm:grid-cols-3">
          <Field label={forMeetings ? "Day" : "Conference day"}>
            <Input type="date" name="conferenceDay" required value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="First meeting starts">
            <Input type="time" name="startTime" required value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Last meeting ends by">
            <Input type="time" name="endTime" required value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          {booked > 0 && day !== date && initial.schedule === "one_day" && (
            <p className="text-sm text-muted sm:col-span-3">
              {booked === 1 ? "The booked meeting moves" : `All ${booked} booked meetings move`} to this day at the same time, and we email
              each {w.family} an updated calendar invite with a link to pick another time or cancel.
            </p>
          )}
        </div>
      ) : (
        <p className="rounded-md bg-background px-3 py-2 text-sm">
          <span className="font-medium">
            {formatDate(day, { year: undefined, weekday: "long" })} · {displayTime(from)} – {displayTime(to)}
          </span>{" "}
          <button
            type="button"
            onClick={() => {
              setChangingHours(true);
              setEditing(true);
            }}
            className="font-medium text-brand underline underline-offset-4"
          >
            Change the day or hours
          </button>
        </p>
      )}

      <div className={`grid gap-4 sm:grid-cols-2 ${basics && extras ? "" : "sm:max-w-md sm:grid-cols-1"}`}>
        {basics && (
        <Field label="Meeting length">
          <Select name="meetingMinutes" value={meeting} onChange={(e) => setMeeting(Number(e.target.value))}>
            {MEETING_LENGTHS.map((m) => (
              <option key={m} value={m}>
                {formatDuration(m)}
              </option>
            ))}
          </Select>
        </Field>
        )}
        {extras && (
        <Field label="Time between meetings" hint={`A moment to write notes or let the next ${w.family} in.`}>
          <Select name="gapMinutes" value={gap} onChange={(e) => setGap(Number(e.target.value))}>
            {GAP_LENGTHS.map((m) => (
              <option key={m} value={m}>
                {m ? formatDuration(m) : "None, back to back"}
              </option>
            ))}
          </Select>
        </Field>
        )}
      </div>

      {extras && (
      <div>
        <p className="text-sm font-semibold">Breaks</p>
        <p className="text-sm text-muted">
          {weekly
            ? "A time you're never free, on every day you meet. No meetings are booked during them."
            : forMeetings
              ? "Lunch, or a few minutes to catch up. No meetings are booked during them."
              : "Dinner, or a few minutes to catch up. No meetings are booked during them."}
        </p>
        {breaks.length > 0 && (
          <ul className="mt-3 space-y-3">
            {breaks.map((b) => (
              <li key={b.key} className="grid grid-cols-2 items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-[10.5rem_7rem_1fr_auto]">
                <Field label="Starts">
                  <Input type="time" name="breakStart" required value={b.start} onChange={(e) => change(b.key, { start: e.target.value })} />
                </Field>
                <Field label="Minutes">
                  <NumberInput name="breakMinutes" required maxLength={3} value={b.minutes} onChange={(e) => change(b.key, { minutes: e.target.value })} />
                </Field>
                <Field label="Name (optional)" className="col-span-2 sm:col-span-1">
                  <Input name="breakLabel" maxLength={60} value={b.label} placeholder="e.g. Dinner" onChange={(e) => change(b.key, { label: e.target.value })} />
                </Field>
                <Button
                  type="button"
                  variant="danger"
                  className="col-span-2 sm:col-span-1"
                  onClick={() => {
                    setBreaks((bs) => bs.filter((x) => x.key !== b.key));
                    setEditing(true);
                  }}
                >
                  Remove Break
                </Button>
              </li>
            ))}
          </ul>
        )}
        {breaks.length < 8 && (
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            onClick={() => {
              setBreaks((bs) => [...bs, { key: newKey(), start: "", minutes: "30", label: "" }]);
              setEditing(true);
            }}
          >
            + Add a break
          </Button>
        )}
      </div>
      )}

      <div className="rounded-lg border border-border bg-background p-4">
        {weekly ? (
          <>
            <p className="font-semibold">
              {perWeek ? `${perWeek} ${perWeek === 1 ? "time" : "times"} each week` : "No times fit in your weekly hours yet"}
            </p>
            {perWeek > 0 ? (
              <ul className="mt-3 space-y-3" aria-label="Meeting times each week">
                {sortWeekly(weeklyHours).map((h) => (
                  <li key={`${h.day}-${h.start}-${h.end}`}>
                    <p className="text-sm font-medium">
                      {WEEKDAYS[h.day]}s, {displayTime(h.start)} – {displayTime(h.end)}
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {meetingStarts(h.start, h.end, lengths).map((t) => (
                        <li key={t} className="rounded-sm border border-border bg-surface px-2 py-1 text-sm tabular-nums">
                          {displayTime(t)}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted">
                {weeklyHours.length ? "Try shorter meetings, fewer breaks, or longer hours." : "Choose at least one day you meet, above."}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="font-semibold">{meetingSummary(starts, meeting)}</p>
            {starts.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Meeting times">
                {starts.map((t) => (
                  <li key={t} className="rounded-sm border border-border bg-surface px-2 py-1 text-sm tabular-nums">
                    {displayTime(t)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted">Try shorter meetings, fewer breaks, or longer hours.</p>
            )}
          </>
        )}
      </div>

      {part === "basics" && (
        <p className="text-sm text-muted">Need a break, or time between meetings? Add it in More options, the next step after Where you&apos;ll meet.</p>
      )}
      {outside.length > 0 && (
        <div id="times-outside" tabIndex={-1} className="rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm leading-6 outline-none">
          <p className="font-semibold">
            {outside.length === 1 ? "1 booked meeting doesn't" : `${outside.length} booked meetings don't`} fit these times:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {outside.map((b) => (
              <li key={key(b)}>
                {b.who}, {weekly ? `${formatDate(b.date, { year: undefined })} at ` : ""}
                {displayTime(b.time)}
              </li>
            ))}
          </ul>
          <fieldset className="mt-3">
            <legend className="font-semibold">What should happen to {outside.length === 1 ? "this meeting" : `these ${outside.length} meetings`}?</legend>
            {(
              [
                { value: "email", label: `Keep ${outside.length === 1 ? "it" : "them"} booked, and email ${outside.length === 1 ? "them" : "each"} a link to pick a new time` },
                { value: "self", label: `Keep ${outside.length === 1 ? "it" : "them"} booked. I'll contact ${outside.length === 1 ? "them" : "each one"} myself` },
              ] as const
            ).map((o) => (
              <label key={o.value} className="mt-2 flex min-h-11 items-start gap-3">
                <input type="radio" name="outsideChoice" value={o.value} checked={picked === o.value} onChange={() => setChoice(o.value)} className="team-radio mt-1" />
                <span>{o.label}</span>
              </label>
            ))}
          </fieldset>
          <p className="mt-2">
            {short
              ? openLeft === 0
                ? "No open times are left to move them to, so a link to pick a new time wouldn't help yet. Add hours first, or contact them yourself."
                : `Only ${openLeft} open ${openLeft === 1 ? "time is" : "times are"} left for ${outside.length} people, so the first to answer would get ${openLeft === 1 ? "it" : "them"}.`
              : "Either way, they stay booked, and Your meetings lists them first after saving."}
          </p>
        </div>
      )}
      {autosave ? (
        <AutosaveBar status={auto.status} retry={auto.retry} next={autosave.next} />
      ) : (
        <SaveCancel
          editing={editing}
          onCancel={onCancel}
          // Save says what will happen (decisions 2026-11-08, light check).
          label={outside.length ? (picked === "email" ? `Save and email ${outside.length === 1 ? "them" : `all ${outside.length}`}` : `Save, keep ${outside.length} booked`) : "Save meeting times"}
          saved={Boolean(initial.times_saved_at)}
          problem={outside.length ? { text: `${outside.length} don't fit`, target: "times-outside" } : null}
        />
      )}
    </ActionForm>
  );
}

/** Days off, with weekly hours: holidays, field trips, or a break like winter break. Saved on their own tab. */
export function DaysOffForm({ action, closedDates, meeting, autosave }: { action: Action; closedDates: string[]; meeting?: boolean; autosave?: boolean }) {
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useEditing("daysoff");
  return (
    <DaysOffFields
      key={version}
      action={action}
      closedDates={closedDates}
      meeting={meeting}
      autosave={autosave}
      editing={editing}
      setEditing={setEditing}
      onCancel={() => {
        setVersion((v) => v + 1);
        setEditing(false);
      }}
    />
  );
}

function DaysOffFields({
  action,
  closedDates,
  meeting,
  autosave,
  editing,
  setEditing: setEditingNow,
  onCancel,
}: {
  action: Action;
  closedDates: string[];
  meeting?: boolean;
  autosave?: boolean;
  editing: boolean;
  setEditing: (on: boolean) => void;
  onCancel: () => void;
}) {
  const w = whoBooks(meeting);
  const auto = useAutosaveForm(Boolean(autosave), "A change to your days off");
  const anchor = useRef<HTMLSpanElement>(null);
  const setEditing = (on: boolean) => {
    if (!autosave) return setEditingNow(on);
    if (on) setTimeout(() => {
      const f = anchor.current?.closest("form");
      if (f) auto.edited(f);
    }, 0);
  };
  // Days off as runs of dates (a single day, or a break like Dec 21 – Jan 4).
  const [daysOff, setDaysOff] = useState<DaysOffDraft[]>(() => dateRuns(closedDates).map((r, i) => ({ key: i, ...r })));
  const [nextKey, setNextKey] = useState(100);
  const offDates = [...new Set(daysOff.flatMap((d) => datesBetween(d.from, d.to)))];
  return (
    <ActionForm
      action={action}
      resetOnSuccess={false}
      className="space-y-4"
      onEdit={autosave ? auto.edited : () => setEditing(true)}
      onSuccess={autosave ? auto.saved : () => setEditing(false)}
      onError={autosave ? auto.failed : undefined}
      quiet={Boolean(autosave)}
      noToast={Boolean(autosave)}
    >
      <span ref={anchor} hidden />
      {daysOff.length > 0 ? (
        <ul className="space-y-3">
          {daysOff.map((d) => (
            <li key={d.key} className="grid grid-cols-2 items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-[10rem_10rem_auto]">
              <Field label="Day off">
                <Input
                  type="date"
                  required
                  value={d.from}
                  onChange={(e) => setDaysOff((ds) => ds.map((x) => (x.key === d.key ? { ...x, from: e.target.value } : x)))}
                />
              </Field>
              <Field label="Through (optional)">
                <Input
                  type="date"
                  min={d.from}
                  value={d.to === d.from ? "" : d.to}
                  onChange={(e) => setDaysOff((ds) => ds.map((x) => (x.key === d.key ? { ...x, to: e.target.value } : x)))}
                />
              </Field>
              <Button
                type="button"
                variant="danger"
                className="col-span-2 sm:col-span-1"
                onClick={() => {
                  setDaysOff((ds) => ds.filter((x) => x.key !== d.key));
                  setEditing(true);
                }}
              >
                Remove Day Off
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No days off yet. {w.Families} can book any week you meet.</p>
      )}
      {offDates.map((date) => (
        <input key={date} type="hidden" name="closedDate" value={date} />
      ))}
      {offDates.length > 60 && <p className="text-sm font-semibold text-danger">Add up to 60 days off in all.</p>}
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setDaysOff((ds) => [...ds, { key: nextKey, from: "", to: "" }]);
          setNextKey((k) => k + 1);
          setEditing(true);
        }}
      >
        + Add a day off
      </Button>
      {autosave ? (
        <AutosaveStatus status={auto.status} retry={auto.retry} />
      ) : (
        <SaveCancel editing={editing} onCancel={onCancel} label="Save days off" />
      )}
    </ActionForm>
  );
}

type PlaceProps = {
  action: Action;
  initial: ConferenceSettings;
  /** "3:00 PM – 7:00 PM" */
  hours: string;
  /** The school, kept on the event: shown on the public page and in calendar invites. */
  venue: VenueValue;
  venueSearchEnabled: boolean;
  timezone: string;
  /** Meetings: "people" where conferences say "families", and a place rather than a school. */
  meeting?: boolean;
  /** The room and directions from their last conference or meeting, to start from when this one has none yet. */
  lastRoom?: string | null;
  /** Everything this needs is saved (nothing left to fill in before publishing). */
  saved?: boolean;
  /** Save a moment after each change, with this step next. */
  autosave?: { next?: { href: string; label: string } };
};

/** Step 2: in person, video (one meeting with a waiting room for the whole time), or the family's choice. */
export function MeetingPlaceForm(props: PlaceProps) {
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useEditing("place");
  return (
    <PlaceForm
      key={version}
      {...props}
      editing={editing}
      setEditing={setEditing}
      onCancel={() => {
        setVersion((v) => v + 1);
        setEditing(false);
      }}
    />
  );
}

function PlaceForm({
  action,
  initial,
  hours,
  venue,
  venueSearchEnabled,
  timezone,
  meeting,
  editing,
  setEditing,
  onCancel,
  lastRoom,
  saved,
  autosave,
}: PlaceProps & { editing: boolean; setEditing: (on: boolean) => void; onCancel: () => void }) {
  const w = whoBooks(meeting);
  const auto = useAutosaveForm(Boolean(autosave), "A change to where you'll meet");
  const [modes, setModes] = useState<Mode[]>(modesOf(initial));
  const [link, setLink] = useState(initial.video_link ?? "");
  const [passcode, setPasscode] = useState(initial.video_passcode ?? "");
  // In person, video, and phone calls, together (decisions 2026-11-08).
  const shown = MODES;
  const inPerson = modes.includes("in_person");
  const video = modes.includes("video");
  const toggle = (m: Mode) => setModes((now) => (now.includes(m) ? now.filter((x) => x !== m) : [...now, m]));
  const linkOk = /^https:\/\/\S+$/.test(link.trim());

  return (
    <ActionForm
      action={action}
      resetOnSuccess={false}
      className="space-y-5"
      onEdit={autosave ? auto.edited : () => setEditing(true)}
      onSuccess={autosave ? auto.saved : () => setEditing(false)}
      onError={autosave ? auto.failed : undefined}
      quiet={Boolean(autosave)}
      noToast={Boolean(autosave)}
    >
      {/* The setup step saves what's there; the step says what's still missing (decisions 2026-11-08). */}
      {autosave && <input type="hidden" name="partial" value="1" />}
      <fieldset>
        <legend className="text-sm font-semibold">How will you meet?</legend>
        <p className="mt-1 text-sm text-muted">Choose all that work for you. With more than one, each {w.family} picks when they book.</p>
        <div className={`mt-2 grid gap-2 ${shown.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {shown.map((m) => (
            <label
              key={m.value}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${modes.includes(m.value) ? "border-brand bg-brand-soft" : "border-field-border"}`}
            >
              <input
                type="checkbox"
                name="modes"
                value={m.value}
                checked={modes.includes(m.value)}
                onChange={() => toggle(m.value)}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--brand)]"
              />
              <span>
                <span className="block font-semibold">{m.label}</span>
                <span className="block text-sm text-muted">{meeting ? m.hint.replace("Families", "People").replace("each family", "each person") : m.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {inPerson && (
        <fieldset className="grid gap-4">
          <legend className="mb-1 text-sm font-semibold">{meeting ? "Where you meet" : "Your school"}</legend>
          <p className="-mt-2 text-sm text-muted">Shown on your public page and in {meeting ? "people's" : "families'"} calendar invites.</p>
          <VenuePicker required={!autosave} searchEnabled={venueSearchEnabled} initial={venue} timezone={timezone} kind={meeting ? "Place" : "School"} example={meeting ? "e.g. Main Street Office" : "e.g. Cedar Ridge Elementary"} />
        </fieldset>
      )}

      {inPerson && (
        <Field
          label="Room and directions"
          hint={
            !initial.room && lastRoom
              ? `Filled in from your last event. Change it if this one's different. ${w.Families} get this in their confirmation and reminder.`
              : `${w.Families} get this in their confirmation and reminder.`
          }
        >
          <Textarea
            name="room"
            required={!autosave}
            rows={2}
            maxLength={200}
            defaultValue={initial.room ?? lastRoom ?? ""}
            placeholder="e.g. Room 214, purple hallway, 3rd door on the left"
          />
        </Field>
      )}

      {video && (
        <div className="space-y-4">
          <WaitingRoomGuide hours={hours} meeting={meeting} />
          {/* One pasted link for everyone: a link added to each invite never reached people, since the invite comes from us (decisions 2026-11-07, finding 1). */}
            <>
              <Field label="Meeting link" hint={`Only ${w.families} who book get it, in their confirmation and reminder. It's never on your public page.`}>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    name="videoLink"
                    type="url"
                    // In the setup step, the rest saves without it; the step stays "not done" until it's added.
                    required={!autosave}
                    maxLength={500}
                    value={link}
                    // A whole pasted invitation becomes just its link.
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!/\s/.test(v.trim())) return setLink(v);
                      setLink(linkFrom(v));
                      const code = passcodeFrom(v);
                      if (code) setPasscode(code);
                    }}
                    placeholder="https://zoom.us/j/… or https://meet.google.com/…"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0"
                    disabled={!linkOk}
                    onClick={() => window.open(link.trim(), "_blank", "noopener,noreferrer")}
                  >
                    Test the link
                  </Button>
                </div>
              </Field>
              <Field
                label="Passcode (optional)"
                hint={`If ${w.families} need a passcode to join, add it here. We show it next to the link, so no one has to hunt for it.`}
              >
                <Input
                  name="videoPasscode"
                  maxLength={50}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value.trim())}
                  autoComplete="off"
                  spellCheck={false}
                  className="sm:max-w-xs"
                />
              </Field>
              <details className="-mt-2 rounded-md bg-background px-3 py-2 text-sm">
                <summary className="font-medium text-brand">Where do I find my link?</summary>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
                  <li>
                    <strong className="text-foreground">Zoom:</strong> in the Zoom app, open Meetings, pick your meeting, and choose{" "}
                    <strong className="text-foreground">Copy invitation</strong>. Paste the whole invitation into the link box and we&apos;ll keep just the link, and fill in the
                    passcode for you. The link starts with https://zoom.us/j/.
                  </li>
                  <li>
                    <strong className="text-foreground">Google Meet:</strong> in Google Calendar, make an event, add Google Meet video conferencing, and
                    copy its meet.google.com link.
                  </li>
                  <li>
                    <strong className="text-foreground">Microsoft Teams:</strong> in your Teams calendar, open the meeting and copy its join link.
                  </li>
                  <li>
                    One link for all your meetings works best. On a free Zoom account, meetings end after 40 minutes, so a free Google Meet link or a paid
                    Zoom account is better for a long block of meetings.
                  </li>
                </ul>
              </details>
              <label className="flex gap-3 rounded-lg border border-field-border p-3 text-sm leading-6">
                <input
                  type="checkbox"
                  name="waitingRoom"
                  required={!autosave}
                  defaultChecked={initial.waiting_room_confirmed}
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--brand)]"
                />
                <span>
                  <span className="font-semibold">My meeting has a waiting room, and it runs the whole time ({hours}).</span>{" "}
                  <span className="text-muted">{w.Families} wait there until you let them in, so meetings never overlap.</span>
                </span>
              </label>
            </>
        </div>
      )}

      {inPerson && (
        <p className="text-sm text-muted">
          {meeting ? "People meeting in person are" : "In-person families are"} asked to wait outside your room. You invite them in when you&apos;re ready.
        </p>
      )}

      {modes.includes("phone") && (
        <div className="rounded-lg border border-border bg-brand-soft p-4 text-sm leading-6">
          <p className="font-semibold">You call each {w.family}</p>
          <p className="mt-1">
            {w.Families} give the number to call when they book, and it&apos;s on your Meetings page and in your calendar invite.
            We never ask for your number or share it.
          </p>
          <p className="mt-2">
            Calling from your own phone? In the US, dial <strong>*67</strong> before the number to hide yours. Some
            {w.families} don&apos;t answer hidden numbers, so a {w.school} phone or calling app works best.
          </p>
        </div>
      )}

      {autosave ? (
        <AutosaveBar status={auto.status} retry={auto.retry} next={autosave.next} />
      ) : (
        <SaveCancel editing={editing} onCancel={onCancel} label="Save" disabled={!modes.length} saved={saved} />
      )}
    </ActionForm>
  );
}

/** How to set up one meeting with a waiting room, for Zoom and Google Meet. */
function WaitingRoomGuide({ hours, meeting }: { hours: string; meeting?: boolean }) {
  const w = whoBooks(meeting);
  return (
    <div className="rounded-lg border border-border bg-brand-soft p-4 text-sm leading-6">
      <p className="font-semibold">Set up one meeting for the whole time</p>
      <p className="mt-1">
        Create a single meeting that runs {hours}, with a waiting room turned on. Every {w.family} gets the same link and
        waits until you let them in, so meetings never overlap. {w.Families} are asked to join using the name on their
        booking {meeting ? <>(their own name)</> : <>(&ldquo;Ava Lopez&apos;s family,&rdquo; or a parent&apos;s own name when you don&apos;t ask for the child&apos;s)</>}, so
        you can match the waiting room to your list.
      </p>
      <details className="mt-3 rounded-md border border-border bg-surface px-3 py-2">
        <summary className="cursor-pointer font-semibold">Zoom</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Sign in with your <strong>{w.school}</strong> Zoom account. Free personal accounts end every meeting after 40
            minutes, and {w.families} in the waiting room count toward that time.
          </li>
          <li>Schedule a meeting from your first {meeting ? "meeting" : "conference"} to your last.</li>
          <li>
            Under Security, tick <strong>Waiting Room</strong>. Leave &ldquo;Allow participants to join before
            host&rdquo; off.
          </li>
          <li>Copy the invite link and paste it below.</li>
        </ol>
      </details>
      <details className="mt-2 rounded-md border border-border bg-surface px-3 py-2">
        <summary className="cursor-pointer font-semibold">Google Meet</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Sign in with your <strong>{w.school}</strong> Google account.
          </li>
          <li>In Google Calendar, create an event that covers your whole time, and add Google Meet video conferencing.</li>
          <li>
            Don&apos;t invite {meeting ? "anyone" : "parents"} to the calendar event. That way each {w.family} has to <strong>ask to join</strong>,
            and you choose when to let them in.
          </li>
          <li>
            In the meeting&apos;s host controls, set access to <strong>Restricted</strong> if your {meeting ? "organization" : "school"} allows it.
          </li>
          <li>Copy the Meet link and paste it below.</li>
        </ol>
      </details>
    </div>
  );
}

/** A small status line for a card that saves itself, inside a page whose bar is elsewhere. */
function AutosaveStatus({ status, retry }: { status: ReturnType<typeof useAutosaveForm>["status"]; retry: () => void }) {
  return (
    <p className="min-h-6 text-sm" role="status">
      {status.kind === "failed" ? (
        <span className="font-semibold text-danger">
          <span aria-hidden>▲ </span>Not saved. {status.error}{" "}
          {status.retry && (
            <button type="button" onClick={retry} className="underline underline-offset-4">
              Retry
            </button>
          )}
        </span>
      ) : status.kind === "incomplete" ? (
        <span className="font-medium text-warning">
          <span aria-hidden>◆ </span>Not saved yet. Fill in “{status.what}”.
        </span>
      ) : status.kind === "saving" || status.kind === "waiting" ? (
        <span className="text-muted">Saving…</span>
      ) : status.kind === "saved" ? (
        <span className="font-medium">
          <span aria-hidden className="text-success">✓ </span>Saved
        </span>
      ) : null}
    </p>
  );
}

/** With weekly hours: how much notice people give, and how far ahead they can book (More options). */
function BookingWindow({ initial, who }: { initial: ConferenceSettings; who: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={`${who} book at least`} hint="So no one books a meeting that starts in a few minutes.">
        <Select name="minNotice" defaultValue={initial.min_notice_hours}>
          {NOTICE_HOURS.map((h) => (
            <option key={h} value={h}>
              {h ? `${noticeLabel(h)} ahead` : noticeLabel(h)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`${who} can book up to`} hint="So your calendar doesn't fill up for the whole semester on day one.">
        <Select name="maxAhead" defaultValue={initial.max_days_ahead}>
          {AHEAD_DAYS.map((d) => (
            <option key={d} value={d}>
              {aheadLabel(d)} ahead
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/**
 * "Make a weekly copy": a new draft with this setup, every week, without the bookings. Its own
 * button, not part of the times form (a button inside a form would just save the times).
 */
function WeeklyCopyButton({ action }: { action: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => action())}
      className="inline-flex min-h-11 items-center font-medium text-brand underline underline-offset-4 disabled:no-underline"
    >
      {pending ? "Making a copy…" : "Make a weekly copy"}
    </button>
  );
}

/**
 * The email shown on the booking page when every time is booked, so people can ask about another
 * time. Optional: nothing is shown unless it's added (decisions 2026-11-08). Saves itself.
 */
export function MeetingContactForm({ action, initial, autosave = false }: { action: Action; initial: string | null; autosave?: boolean }) {
  const auto = useAutosaveForm(autosave, "A change to your contact email");
  return (
    <ActionForm
      action={action}
      resetOnSuccess={false}
      className="space-y-3"
      onEdit={autosave ? auto.edited : undefined}
      onSuccess={autosave ? auto.saved : undefined}
      onError={autosave ? auto.failed : undefined}
      quiet={autosave}
      noToast={autosave}
    >
      <Field label="Contact email (optional)" hint="Shown on your booking page only when every time is booked, so people can ask about another time. Hidden once your meetings are over.">
        <Input name="contactEmail" type="email" maxLength={200} defaultValue={initial ?? ""} autoComplete="email" />
      </Field>
      {autosave ? (
        <AutosaveStatus status={auto.status} retry={auto.retry} />
      ) : (
        // Secondary: the page's main save is the bar under Meeting times.
        <SubmitButton variant="secondary" pendingText="Saving…">
          Save contact email
        </SubmitButton>
      )}
    </ActionForm>
  );
}

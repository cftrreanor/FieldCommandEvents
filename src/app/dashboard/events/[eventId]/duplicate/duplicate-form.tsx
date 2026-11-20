"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { duplicateEvent } from "@/app/dashboard/duplicate-actions";
import { DateField } from "@/components/date-field";
import { IconTile, LineIcon } from "@/components/line-icon";
import { toast } from "@/components/toaster";
import { Button, Card, Field, FieldError, Input } from "@/components/ui";
import { addDays, dayShort, daysBetween, listAnd, longRange, longWeekday, offsetWords, weekdays, type DuplicateCounts } from "@/lib/duplicate-words";
import { contestDeadlineWarning } from "@/lib/contest-deadline";
import { formatDate } from "@/lib/time";

export type DuplicateSource = {
  id: string;
  name: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  /** "Sat–Sun, Nov 21–22, 2026" */
  dates: string;
  /** Today in the event's time zone (the first day can't be before it). */
  today: string;
  /** Each shift's local day and clock times. */
  shifts: { job: string; day: string; time: string }[];
  deadline: string | null;
  opensOn: string | null;
  counts: DuplicateCounts;
  /** What's copied, in the same words as Event settings and New event ("3 jobs, 4 shifts, and 1 map or document"). */
  copying: string[];
};

type Problem = { kind: "missing" } | { kind: "field"; text: string } | { kind: "failed"; text: string } | { kind: "dropped" };

/**
 * The Duplicate event form: the new name and first day, a preview of the new dates (days moved, a change of
 * weekday, the shifts on their new days, registration dates moved or left blank), what comes over, and the main
 * button. One request id per page, kept across retries, so a double press or a dropped connection never makes a
 * second copy: trying again opens the one that was made.
 */
export function DuplicateForm({
  source,
  initialName,
  initialDay,
  comesOver,
  startsFresh,
  coordinatorLine,
  cancelHref,
  selectName = false,
}: {
  cancelHref: string;
  source: DuplicateSource;
  initialName: string;
  /** Start with the name selected, so typing replaces it (a name without a year to move on). */
  selectName?: boolean;
  initialDay: string;
  comesOver: ReactNode;
  startsFresh: ReactNode;
  coordinatorLine: ReactNode;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [day, setDay] = useState(initialDay);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const nameBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectName) nameBox.current?.select();
  }, [selectName]);
  const contest = source.kind === "band_contest" || source.kind === "group_event";
  const length = daysBetween(source.startsOn, source.endsOn);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= source.today;
  const end = valid ? addDays(day, length) : null;
  const offset = valid ? daysBetween(source.startsOn, day) : 0;
  const dayLabel = length === 0 ? (source.kind === "band_contest" ? "New contest day" : "New date") : "New first day";
  // Changing the name or date is a new request: a retry only reuses the id for the same name and date.
  const changed = () => {
    requestId.current = null;
  };
  const newName = name.trim() || source.name;
  const pastWords = `Pick today or a later date (${formatDate(source.today, { weekday: undefined })} or after)`;

  const submit = async () => {
    if (busy) return;
    setNameError(null);
    if (!name.trim()) {
      setNameError("Fill in the name of the new event");
      setProblem(null);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setProblem({ kind: "missing" });
      return;
    }
    // A past day: the box already says so, once (its own message, in the page's words).
    if (day < source.today) return;
    // Made once and kept: a retry with the same id returns the copy the first try made.
    requestId.current ??= crypto.randomUUID();
    setBusy(true);
    setProblem(null);
    const data = new FormData();
    data.set("name", name.trim());
    data.set("startsOn", day);
    try {
      const result = await duplicateEvent(source.id, requestId.current, {}, data);
      if (result.ok && result.goTo) {
        if (result.filesNotCopied?.length) {
          toast(`${listAnd(result.filesNotCopied.map((f) => f.label || f.file_name))} didn't copy. Add ${result.filesNotCopied.length === 1 ? "it" : "them"} again in Maps and documents.`);
        }
        router.push(result.goTo);
        return;
      }
      setBusy(false);
      if (result.fieldErrors?.name) setNameError(result.fieldErrors.name.replace(/\.$/, ""));
      else if (result.fieldErrors?.startsOn) setProblem({ kind: "field", text: result.fieldErrors.startsOn.replace(/\.$/, "") });
      else setProblem({ kind: "failed", text: result.error ?? "Nothing was created. Try again." });
    } catch {
      // No answer: it may or may not have been made. Trying again (same request id) opens it if it was.
      setBusy(false);
      setProblem({ kind: "dropped" });
    }
  };

  const fieldProblem = problem?.kind === "missing" ? `Pick the ${dayLabel.toLowerCase()}` : problem?.kind === "field" ? problem.text : null;

  return (
    <Card className="mt-6 space-y-6">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-6"
      >
        <Field
          label="Name of the new event"
          hint={`A different name helps tell it apart from ${source.name} on My events.`}
          error={nameError ?? undefined}
          errorId="dup-name-error"
        >
          <Input
            ref={nameBox}
            name="name"
            value={name}
            autoFocus={selectName}
            onChange={(e) => {
              setName(e.target.value);
              changed();
            }}
            required
            maxLength={120}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "dup-name-error" : undefined}
          />
        </Field>

        <div>
          <label className="flex flex-col gap-1.5">
            <span data-field-label className="text-sm font-semibold">
              {dayLabel}
            </span>
            <DateField
              name="startsOn"
              required
              min={source.today}
              rangeMessage={pastWords}
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                changed();
                if (problem?.kind === "missing" || problem?.kind === "field") setProblem(null);
              }}
              aria-invalid={fieldProblem ? true : undefined}
              aria-describedby={fieldProblem ? "dup-day-error" : undefined}
              className="max-w-xs"
            />
            {/* The problem always sits directly under the box, the hint after it. */}
            {fieldProblem && <FieldError id="dup-day-error">{fieldProblem}</FieldError>}
            {!end && (
              <span className="text-sm text-muted">
                {length === 0
                  ? `${source.name} was ${formatDate(source.startsOn)}.`
                  : `${source.name} started ${formatDate(source.startsOn)} and lasts ${length + 1} days. The new event lasts ${length + 1} days too.`}
              </span>
            )}
          </label>
          {end && (
            <DatePreview
              source={source}
              start={day}
              end={end}
              offset={offset}
              pickDay={(d) => {
                setDay(d);
                changed();
              }}
            />
          )}
        </div>

        <div className="grid gap-4 border-t border-border pt-5 text-sm leading-6 sm:grid-cols-2">
          <div>
            <h2 className="font-semibold">Comes over</h2>
            <ul className="mt-1 list-disc space-y-1 pl-5">{comesOver}</ul>
          </div>
          <div>
            <h2 className="font-semibold">Starts fresh</h2>
            <ul className="mt-1 list-disc space-y-1 pl-5">{startsFresh}</ul>
          </div>
        </div>

        {coordinatorLine && (
          <div className="flex gap-3 border-t border-border pt-5 text-sm leading-6">
            <IconTile name="volunteer" size="sm" />
            <div className="min-w-0">{coordinatorLine}</div>
          </div>
        )}

        {/* Phones: the button stays in reach under the long lists (a sticky bar, like the step pages). */}
        <div className="space-y-3 border-t border-border pt-5 max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:-mx-4 max-sm:bg-surface max-sm:px-4 max-sm:pb-4 max-sm:shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          {problem?.kind === "missing" && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {fieldProblem} in the box above.
            </p>
          )}
          {problem?.kind === "failed" && (
            <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm leading-6 text-danger">
              <p className="font-semibold">Couldn&apos;t duplicate {source.name}</p>
              <p>{problem.text}</p>
            </div>
          )}
          {problem?.kind === "dropped" && (
            <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm leading-6 text-danger">
              <p className="font-semibold">The connection dropped before we heard back</p>
              <p>Try again: if {newName} was made, it opens. Trying again never makes a second copy.</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {busy ? (
              // Readable while busy: full strength, the words say what's happening (no fading, L7).
              <button
                type="button"
                aria-disabled
                className="inline-flex min-h-11 cursor-wait items-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground"
              >
                <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-brand-foreground border-t-transparent motion-reduce:animate-none" />
                Duplicating…
              </button>
            ) : (
              <Button type="submit">{problem?.kind === "failed" || problem?.kind === "dropped" ? "Try again" : "Duplicate event"}</Button>
            )}
            {!busy && (
              <Link href={cancelHref} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-muted hover:text-foreground">
                Cancel
              </Link>
            )}
          </div>
          <p aria-live="polite" className={`text-sm ${busy ? "font-medium" : "text-muted"}`}>
            {busy
              ? `Copying ${listAnd(source.copying.length ? source.copying : ["its details"])}. This takes a few seconds.`
              : contest
                ? `Makes a draft only your team can see. Nobody is emailed: not directors, Coordinators, or volunteers.`
                : "Makes a draft only your team can see. Nobody is emailed."}
          </p>
        </div>
      </form>
    </Card>
  );
}

/** The new dates: the range, how far everything moves, a change of weekday, the shifts, and registration dates. */
function DatePreview({ source, start, end, offset, pickDay }: { source: DuplicateSource; start: string; end: string; offset: number; pickDay: (day: string) => void }) {
  const contest = source.kind === "band_contest" || source.kind === "group_event";
  const moved = (d: string | null) => (d ? addDays(d, offset) : null);
  // The database's rule (copy_event_setup): a date already past, or not before the first day, is left blank.
  const deadlineTo = moved(source.deadline);
  const deadlineBlank = Boolean(deadlineTo && (deadlineTo < source.today || deadlineTo >= start));
  const opensTo = moved(source.opensOn);
  const opensBlank = Boolean(opensTo && (opensTo < source.today || !deadlineTo || deadlineBlank || opensTo > deadlineTo));
  const weekdayChanged = offset % 7 !== 0;
  // The nearest day on the same weekday as before (not in the past), offered in the warning.
  const back = ((offset % 7) + 7) % 7;
  const sameWeekday = [addDays(start, -back), addDays(start, 7 - back)].filter((d) => d >= source.today).sort((a, b) => Math.abs(daysBetween(start, a)) - Math.abs(daysBetween(start, b)))[0];
  const deadlineWarning = contest ? contestDeadlineWarning(source.kind, start, source.today) : null;
  return (
    <div role="status" className="mt-3 space-y-3 rounded-md border border-brand/25 bg-brand-soft px-4 py-3 text-sm leading-6">
      {start === source.today && (
        <p className="font-semibold">That&apos;s today. People would have only today to sign up.</p>
      )}
      <p>
        <span className="font-semibold">{longRange(start, end)}.</span> Every shift{contest && (source.deadline || source.opensOn) ? " and registration date" : ""} moves{" "}
        {offsetWords(offset)}, at the same times of day. {source.name} was {source.dates}.
      </p>
      {weekdayChanged && (
        <div className="flex gap-2">
          <LineIcon name="warning" className="mt-0.5 size-5 shrink-0 text-warning" />
          <p>
            <span className="font-semibold">
              Different days of the week: {weekdays(start, end)}, not {weekdays(source.startsOn, source.endsOn)}.
            </span>{" "}
            Shifts keep their order, so {longWeekday(source.startsOn)}&apos;s shifts move to {longWeekday(start)}.{" "}
            {sameWeekday && (
              <button type="button" onClick={() => pickDay(sameWeekday)} className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
                Use {dayShort(sameWeekday)} instead
              </button>
            )}
          </p>
        </div>
      )}
      {deadlineWarning && (
        // A day close to now leaves directors little time: say so before copying, by the same rule as Band registration.
        <div className="flex gap-2">
          <LineIcon name="warning" className="mt-0.5 size-5 shrink-0 text-warning" />
          <p>
            <span className="font-semibold">{deadlineWarning.head}</span> {deadlineWarning.body}
          </p>
        </div>
      )}
      {contest && (source.deadline || source.opensOn) && (
        <ul className="list-disc space-y-1 pl-5">
          {source.deadline && (
            <li>
              <span className="font-semibold">Registration deadline:</span>{" "}
              {deadlineBlank
                ? `${dayShort(source.deadline)} would move to ${formatDate(deadlineTo!)}, which ${deadlineTo! < source.today ? "has passed" : "isn't before the new first day"}, so it's left blank. You pick one before you publish.`
                : `moves to ${formatDate(deadlineTo!)}`}
            </li>
          )}
          {source.opensOn && (
            <li>
              <span className="font-semibold">Registration opens:</span>{" "}
              {opensBlank
                ? `${dayShort(source.opensOn)} would move to ${formatDate(opensTo!)}, which ${opensTo! < source.today ? "has passed" : "comes after the deadline"}, so it's left blank. Registration opens when you publish.`
                : `moves to ${formatDate(opensTo!)}`}
            </li>
          )}
        </ul>
      )}
      {source.shifts.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-brand">
            <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
              ›
            </span>
            {source.shifts.length === 1 ? "See the shift on its new day" : `See the ${source.shifts.length} shifts on their new days`}
          </summary>
          <ul className="divide-y divide-border border-t border-brand/25 text-sm">
            {source.shifts.map((s, i) => (
              <li key={i} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="font-medium sm:w-40 sm:shrink-0">{s.job}</span>
                <span className="tabular-nums">
                  {dayShort(addDays(s.day, offset))}, {s.time}
                </span>
                <span className="text-muted sm:ml-auto">was {dayShort(s.day)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { NumberInput } from "@/components/number-input";
import { ZoneInput } from "@/components/zone-input";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { CHECKPOINT_KINDS, type CheckpointKind } from "@/lib/contest-day";
import { formatDate } from "@/lib/time";
import { OVERLAPS, clockLabel, durationLabel, planShifts, toMinutes } from "@/lib/shift-plan";
import { onRetry, setPending, useUnadded } from "@/components/pending-edits";
import { StepNotice, useStepEdits } from "./volunteering/station-steps";
import { copyDialog } from "@/components/confirm-dialog";
import { CO_HOST_POWERS } from "@/lib/team-words";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

type StationValues = {
  name: string;
  checkpoint_kind: CheckpointKind | null;
  due_minutes_before_warm_up: number | null;
  location: string | null;
  instructions: string | null;
  adults_only?: boolean;
  /** Spots on each shift held for volunteers 18 or older (null: any mix). */
  min_adults?: number | null;
  /** School fairs: which zone the station is in. */
  zone?: string | null;
  /** Everyone leading this sign-up, first-added first. */
  lead_ids?: string[];
};
export type LeadOption = { id: string; label: string };

export function StationForm({
  action,
  initial,
  leads,
  submitLabel = "Add sign-up",
  bands = true,
  locations = [],
  zones,
  leadLabel = "Coordinators",
  trackUnsaved,
  draft = false,
  remaining = [],
  kind: signupKind,
  coordinators,
  job = false,
}: {
  action: Action;
  initial?: StationValues;
  /** A volunteer event's job: says "job" and "shifts" (other events keep "sign-up" and "time slots"). */
  job?: boolean;
  leads?: LeadOption[];
  /** Time slots or items to bring, and why it can't change right now (null if it can). */
  kind?: { value: SignupKind; locked: string | null };
  /** Who leads it, picked from the team, with a window to invite someone new. */
  coordinators?: { options: LeadOption[]; pending: string[]; invite: Action };
  submitLabel?: string;
  /** A band contest: sign-ups can be stops on the bands' check-in path. */
  bands?: boolean;
  /** Suggestions for Location: a group event's rooms. */
  locations?: string[];
  /** School fairs: zone suggestions (shows the Zone field). */
  zones?: readonly string[];
  /** What the sign-up's leads are called. */
  leadLabel?: string;
  /** On a sign-up's tab: warn before leaving with changes unsaved, and save from a bar pinned to the bottom of the section. */
  trackUnsaved?: boolean;
  /** Not finished yet: never saved with Save sign-up. */
  draft?: boolean;
  /** What's still to do for this sign-up, shown in its save bar ("add items to bring"). */
  remaining?: string[];
}) {
  const [kind, setKind] = useState<string>(initial?.checkpoint_kind ?? "");
  const [signup, setSignup] = useState<SignupKind>(signupKind?.value ?? "shifts");
  const setEdited = useStepEdits(trackUnsaved ? "details" : undefined);
  const [dirty, setDirty] = useState(false);
  const changed = useCallback(() => {
    setDirty(true);
    setEdited(true);
  }, [setEdited]);
  const saved = useCallback(() => {
    setDirty(false);
    setEdited(false);
    // Saved from the footer: back up to the tabs, where the sign-up's status shows the change.
    // (After the page has redrawn with the saved sign-up, so the scroll isn't cut short.)
    if (trackUnsaved) setTimeout(() => document.getElementById("signups-heading")?.scrollIntoView({ block: "start" }), 50);
  }, [setEdited, trackUnsaved]);
  return (
    <ActionForm
      id={trackUnsaved ? SIGNUP_FORM : undefined}
      action={action}
      className="grid gap-4 sm:grid-cols-2"
      resetOnSuccess={!initial}
      onEdit={trackUnsaved ? changed : undefined}
      onSuccess={trackUnsaved ? saved : undefined}
    >
      <Field
        label={job ? "Job name" : "Sign-up name"}
        hint={bands ? "e.g. Spectator Parking, Concessions, Warm-Up Area A" : job ? "e.g. Parking, Litter pickup, Supplies to bring" : "e.g. Parking, Concessions, Ticket Table"}
        className={signupKind ? "sm:col-span-2" : undefined}
      >
        <Input name="name" required maxLength={80} defaultValue={initial?.name} />
      </Field>
      {signupKind && (
        <div className="sm:col-span-2">
          <SignupKindPicker
            value={signup}
            onChange={setSignup}
            disabled={Boolean(signupKind.locked)}
            job={job}
            note={signupKind.locked ?? (job ? "You can change this until you add shifts or things to bring." : "You can change this until you add time slots or items.")}
          />
          {/* A locked choice still says what it is, so saving never changes it. */}
          {signupKind.locked && <input type="hidden" name="signupKind" value={signup} />}
        </div>
      )}
      {signupKind && <h3 className="border-t border-border pt-4 text-base font-semibold sm:col-span-2">{job ? "Job details" : "Sign-up details"}</h3>}
      {bands && <CheckInStopFields kind={kind} setKind={setKind} initial={initial} />}
      {zones && (
        <Field label="Zone" hint="Optional. Groups sign-ups on the event's pages. Use one of these or make up your own.">
          <ZoneInput zones={zones} defaultValue={initial?.zone} />
        </Field>
      )}
      <Field label="Location" hint="Optional. Where volunteers should report." className="sm:col-span-2">
        <Input
          name="location"
          defaultValue={initial?.location ?? ""}
          placeholder={locations.length ? `e.g. ${locations[0]}` : "e.g. North lot, by the ticket booth"}
          list={locations.length ? "room-locations" : undefined}
        />
        {locations.length > 0 && (
          <datalist id="room-locations">
            {locations.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        )}
      </Field>
      <Field label="Instructions for volunteers" hint="Optional. What to wear, bring, and do." className="sm:col-span-2">
        <Textarea name="instructions" defaultValue={initial?.instructions ?? ""} />
      </Field>
      <label className="flex items-start gap-3 text-sm sm:col-span-2">
        <input
          type="checkbox"
          name="adultsOnly"
          defaultChecked={initial?.adults_only ?? false}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
        />
        <span>
          <span className="font-medium">Adults only (18+)</span>
          <span className="block text-muted">No one under 18 can sign up for this {job ? "job" : "sign-up"}&apos;s shifts or be added as a walk-up, e.g. Parking.</span>
        </span>
      </label>
      <AdultsNeededField initial={initial?.min_adults} className="sm:col-span-2" />
      {coordinators && <CoordinatorPicker label={leadLabel} initial={initial?.lead_ids ?? []} onChange={trackUnsaved ? changed : undefined} {...coordinators} />}
      {leads && (
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium">{leadLabel}</legend>
          <input type="hidden" name="leadsField" value="1" />
          <p className="mt-1 text-sm text-muted">
            {leads.length
              ? "Pick one or more, so there's a backup if someone can't make it. Every lead sees this sign-up's volunteers; volunteers contact the first lead you added."
              : "Invite Coordinators in the Team card on the event page."}
          </p>
          {leads.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {leads.map((l) => (
                <label key={l.id} className="flex min-h-10 items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm hover:border-brand">
                  <input
                    type="checkbox"
                    name="leadIds"
                    value={l.id}
                    defaultChecked={initial?.lead_ids?.includes(l.id)}
                    className="h-5 w-5 shrink-0 accent-[var(--brand)]"
                  />
                  {l.label}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
      {trackUnsaved ? (
        <SignupBar dirty={dirty} draft={draft} remaining={remaining} submitLabel={submitLabel} />
      ) : (
        <div className="sm:col-span-2">
          <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

const SIGNUP_FORM = "signup-details";

const noSubscribe = () => () => {};

/**
 * A sign-up's footer: pinned to the bottom of the screen for the whole sign-up (resting at the end of its card),
 * saying what's left and saving its details form. Rendered into the card's #signup-bar slot.
 */
function SignupBar({
  dirty,
  draft,
  remaining,
  submitLabel,
}: {
  dirty: boolean;
  draft: boolean;
  remaining: string[];
  submitLabel: string;
}) {
  const slot = useSyncExternalStore(
    noSubscribe,
    () => document.getElementById("signup-bar"),
    () => null,
  );
  if (!slot) return null;
  const left = remaining.length ? new Intl.ListFormat("en", { type: "conjunction" }).format(remaining) : "";
  return createPortal(
    <div className="space-y-2 rounded-b-lg border-t-2 border-border bg-surface px-4 py-3 shadow-[0_-6px_16px_rgb(0_0_0/0.10)] sm:px-6">
      <StepNotice step="details" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex w-full min-w-0 items-start gap-2 text-sm sm:w-auto sm:flex-1" aria-live="polite">
          {dirty || remaining.length ? (
            <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full bg-[#f5b301] ring-1 ring-warning/50" />
          ) : (
            <span aria-hidden className="font-bold text-success">
              ✓
            </span>
          )}
          <span className="min-w-0">
            {dirty ? (
              <>
                <span className="font-semibold">Unsaved changes</span>
                {left && <span className="text-muted"> · Still to do: {left}</span>}
              </>
            ) : remaining.length ? (
              <>
                <span className="font-semibold">What&apos;s left:</span> {left[0].toUpperCase() + left.slice(1)}
              </>
            ) : (
              <span className="font-semibold">Ready for sign-ups</span>
            )}
          </span>
        </p>
          <div className="flex w-full gap-2 sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
            {/* Always there; usable once there's something to save. Keeps it without marking the sign-up finished. */}
            <SubmitButton form={SIGNUP_FORM} variant="secondary" name="intent" value="later" pendingText="Saving…" disabled={!dirty && !draft}>
              Save for later
            </SubmitButton>
            <SubmitButton form={SIGNUP_FORM} pendingText="Saving…" disabled={!dirty && !draft}>
              {submitLabel}
            </SubmitButton>
          </div>
      </div>
    </div>,
    slot,
  );
}


/** Anything typed or picked in a form (hidden fields aside). */
function hasAnswers(form: HTMLFormElement) {
  return [...form.elements].some(
    (el) => (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) && el.type !== "hidden" && el.value.trim() !== "",
  );
}

/** Shift lengths offered, in minutes: 30 minutes to 6 hours, every half hour. */
const SHIFT_LENGTHS = Array.from({ length: 12 }, (_, i) => (i + 1) * 30);

/** 30 → "30 minutes", 90 → "1½ hours", 120 → "2 hours". */
function lengthLabel(minutes: number) {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const half = minutes % 60 === 30 ? "½" : "";
  return `${hours}${half} hour${hours === 1 && !half ? "" : "s"}`;
}

/**
 * "Auto create shifts": split each event day into shifts of one length. Run again, it
 * replaces the sign-up's shifts, as long as nobody has signed up for them.
 */
export function GenerateShiftsForm({
  action,
  windowLabel,
  windowTimes,
  multiDay = false,
  existing = 0,
  signedUp = false,
  job = false,
  minAdults = null,
}: {
  action: Action;
  windowLabel: string;
  /** The event day's start and end ("07:00", "21:00"): where From and To start out. */
  windowTimes?: { start: string; end: string };
  job?: boolean;
  multiDay?: boolean;
  /** Spots held for adults on each shift (the job's setting), said under Volunteers per shift. */
  minAdults?: number | null;
  /** How many shifts the station has now. */
  existing?: number;
  /** Someone has signed up for one of them: auto create can't replace them. */
  signedUp?: boolean;
}) {
  const setEdited = useStepEdits("shifts");
  const unadded = useUnadded();
  const [from, setFrom] = useState(windowTimes?.start ?? "");
  const [to, setTo] = useState(windowTimes?.end ?? "");
  const [length, setLength] = useState(0);
  const [overlap, setOverlap] = useState(0);
  const [capacity, setCapacity] = useState(0);
  if (signedUp) {
    return (
      <p className="rounded-md border border-border bg-background px-3 py-2.5 text-sm">
        Volunteers have signed up for this {job ? "job" : "sign-up"}&apos;s {job ? "shifts" : "time slots"}, so filling the day can&apos;t replace them. Edit them one at a time above, or add one shift.
      </p>
    );
  }
  const fromMin = from ? toMinutes(from) : 0;
  const toMin = to ? toMinutes(to) : 0;
  // The same time twice makes nothing; a To before From runs past midnight (an evening event).
  const backwards = Boolean(from && to) && toMin === fromMin;
  const overnight = Boolean(from && to) && toMin < fromMin;
  const plan = from && to && length && !backwards ? planShifts(fromMin, toMin, length, overlap) : [];
  // The time zone the event's hours are written in ("8:00 AM – 9:00 PM CDT" → "CDT"), for the preview.
  const zone = windowLabel.match(/\b([A-Z]{2,5})$/)?.[1] ?? "";
  const span = (p: { start: number; end: number }) => durationLabel(p.end - p.start);
  // Outside the event's hours: said quietly, so a typo (6:00 AM for 6:00 PM) gets noticed.
  const eventFrom = windowTimes ? toMinutes(windowTimes.start) : null;
  const eventTo = windowTimes ? toMinutes(windowTimes.end) : null;
  const outside = [
    eventFrom != null && from && fromMin < eventFrom ? `starts ${lengthLabel(eventFrom - fromMin)} before the event` : null,
    eventTo != null && to && eventTo > (eventFrom ?? 0) && toMin > eventTo ? `ends ${lengthLabel(toMin - eventTo)} after it` : null,
    overnight ? "ends the next day" : null,
  ].filter(Boolean);
  return (
    <ActionForm
      action={action}
      className="space-y-4"
      confirmMessage={existing ? `Replace this ${job ? "job" : "sign-up"}'s ${existing} shift${existing === 1 ? "" : "s"} with new ones?` : undefined}
      onEdit={(f) => {
        setEdited(hasAnswers(f));
        unadded(f);
      }}
    >
      <p className="text-sm text-muted">
        Shifts back to back{multiDay ? ", on each day of the event" : ""}. From and To start at the event&apos;s hours ({windowLabel}). Change
        them for setup before or cleanup after.
        {existing > 0 && (
          <>
            {" "}
            <strong className="font-semibold text-foreground">
              This replaces its {existing} shift{existing === 1 ? "" : "s"}
            </strong>{" "}
            (nobody has signed up yet).
          </>
        )}
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="From">
          <Input name="fromTime" type="time" required value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To" error={backwards ? "To has to be later than From" : undefined} errorId="to-error">
          <Input
            name="toTime"
            type="time"
            required
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-invalid={backwards || undefined}
            aria-describedby={backwards ? "to-error" : undefined}
          />
        </Field>
        {outside.length > 0 && <p className="col-span-2 -mt-2 text-sm text-muted">This {outside.join(" and ")}.</p>}
        <Field label="Shift length">
          <Select name="blockHours" defaultValue="" required onChange={(e) => setLength(Number(e.target.value) * 60)}>
            <option value="" disabled>
              Pick a length
            </option>
            {SHIFT_LENGTHS.map((m) => (
              <option key={m} value={m / 60}>
                {lengthLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Volunteers per shift"
          hint={minAdults ? `${minAdults} of them saved for adults (18+), set in More options` : undefined}
        >
          <NumberInput name="capacity" placeholder="e.g. 4" required onChange={(e) => setCapacity(Number(e.target.value) || 0)} />
        </Field>
        {/* Off unless asked for; once ticked, how much (15 minutes to start). */}
        <div className="col-span-2 space-y-2">
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={overlap > 0}
              onChange={(e) => setOverlap(e.target.checked ? 15 : 0)}
              className="h-5 w-5 shrink-0 accent-[var(--brand)]"
            />
            <span className="font-semibold">Overlap shifts</span>
          </label>
          {overlap > 0 ? (
            <Field label="By how much" hint="Each shift after the first starts this much earlier and runs that much longer, so nobody leaves before the next volunteers arrive.">
              <Select name="overlap" value={overlap} onChange={(e) => setOverlap(Number(e.target.value))} className="sm:max-w-xs">
                {OVERLAPS.map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <input type="hidden" name="overlap" value="0" />
          )}
        </div>
      </div>
      {plan.length > 0 && (
        // What it makes, before anything is created: in time order, with each shift's length when it isn't the one picked.
        <div aria-live="polite" className="rounded-md border border-border bg-background px-3 py-2.5 text-sm">
          <p className="font-semibold">
            Preview: {plan.length} shift{plan.length === 1 ? "" : "s"}
            {multiDay ? " each day" : ""}
            {capacity > 0 ? `, ${plan.length * capacity} spots` : ""}
            {zone ? ` (${zone})` : ""}
          </p>
          <ol className="mt-1 space-y-0.5">
            {plan.map((p, i) => (
              <li key={p.start}>
                {i + 1}. {clockLabel(p.start)} – {clockLabel(p.end)}
                {p.end - p.start !== length && <span className="text-muted"> · {span(p)}</span>}
              </li>
            ))}
          </ol>
          <p className="sr-only">Nothing is created until you use Create shifts.</p>
        </div>
      )}
      <StepNotice step="shifts" />
      <SubmitButton variant="go" pendingText="Creating…">
        Create {plan.length || ""} shift{plan.length === 1 ? "" : "s"}
      </SubmitButton>
    </ActionForm>
  );
}

type ShiftValues = {
  title: string;
  day: string;
  startTime: string;
  endTime: string;
  capacity: number;
  description: string | null;
  adultsOnly?: boolean;
  minAge?: number | null;
};

export function ShiftForm({
  action,
  days,
  initial,
  registered = 0,
  submitLabel = "Create shift",
}: {
  action: Action;
  days: string[];
  initial?: ShiftValues;
  registered?: number;
  submitLabel?: string;
}) {
  // A new shift: the button turns green once every required answer is in.
  const setEdited = useStepEdits(initial ? undefined : "shifts");
  const unadded = useUnadded();
  return (
    <ActionForm
      action={action}
      className="grid gap-4 sm:grid-cols-2"
      resetOnSuccess={!initial}
      onEdit={(f) => {
        if (!initial) setEdited(hasAnswers(f));
        unadded(f);
      }}
    >
      {initial && (
        <Field label="Title" className="sm:col-span-2">
          <Input name="title" required defaultValue={initial.title} placeholder="e.g. Morning parking crew" />
        </Field>
      )}
      {days.length > 1 ? (
        <Field label="Day" className="sm:col-span-2">
          <Select name="day" defaultValue={initial?.day}>
            {days.map((d) => (
              <option key={d} value={d}>
                {formatDate(d)}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="day" value={initial?.day ?? days[0]} />
      )}
      <Field label="Start time">
        <Input name="startTime" type="time" required defaultValue={initial?.startTime} />
      </Field>
      <Field label="End time">
        <Input name="endTime" type="time" required defaultValue={initial?.endTime} />
      </Field>
      <Field
        label="Volunteers needed"
        hint={registered > 0 ? `${registered} already signed up, so it can't go lower than that.` : undefined}
      >
        <NumberInput name="capacity" defaultValue={initial?.capacity ?? ""} placeholder="e.g. 4" required />
      </Field>
      {initial && (
        <Field label="Duties" hint="Optional." className="sm:col-span-2">
          <Textarea name="description" defaultValue={initial.description ?? ""} />
        </Field>
      )}
      <AgeRules adultsOnly={initial?.adultsOnly ?? false} minAge={initial?.minAge ?? null} />
      <div className="space-y-3 sm:col-span-2">
        {!initial && <StepNotice step="shifts" />}
        <SubmitButton variant={initial ? "primary" : "go"} pendingText="Saving…">
          {submitLabel}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Who can take a time slot: everyone, adults only, or under-18s from a minimum age. */
function AgeRules({ adultsOnly: savedAdults, minAge }: { adultsOnly: boolean; minAge: number | null }) {
  const [adults, setAdults] = useState(savedAdults);
  return (
    <fieldset className="space-y-2 sm:col-span-2">
      <legend className="text-sm font-semibold">Who can sign up</legend>
      {(savedAdults || minAge != null) && <input type="hidden" name="hadAgeRules" value="1" />}
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          name="adultsOnly"
          checked={adults}
          onChange={(e) => setAdults(e.target.checked)}
          className="h-5 w-5 accent-[var(--brand)]"
        />
        Adults only (18+)
      </label>
      {!adults && (
        <Field label="Minimum age for under-18s" hint="Optional. Leave blank for any age. Younger volunteers see this time slot greyed out.">
          <div className="w-24!">
            <NumberInput name="minAge" defaultValue={minAge ?? ""} maxLength={2} placeholder="e.g. 14" />
          </div>
        </Field>
      )}
    </fieldset>
  );
}

/** "2. Build shifts": auto create a day of shifts, or create one shift. */
export function BuildShifts({
  generate,
  create,
  windowLabel,
  windowTimes,
  days,
  existing = 0,
  signedUp = false,
  job = false,
  minAdults = null,
}: {
  generate: Action;
  /** Spots held for adults on each shift (the job's setting). */
  minAdults?: number | null;
  job?: boolean;
  create: Action;
  windowLabel: string;
  /** The event day's start and end ("07:00", "21:00"). */
  windowTimes?: { start: string; end: string };
  days: string[];
  /** The sign-up's shifts now, and whether anyone has signed up for one. */
  existing?: number;
  signedUp?: boolean;
}) {
  // A job that already has shifts most likely needs one more, not a whole new day of them.
  const [mode, setMode] = useState<"auto" | "single">(job && existing > 0 ? "single" : "auto");
  // Switching forms drops what was typed in the other one.
  const setEdited = useStepEdits("shifts");
  const options = [
    { value: "auto", label: "Several shifts" },
    { value: "single", label: "One shift" },
  ] as const;
  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="How to build shifts" className="inline-flex rounded-md border border-border bg-background p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={mode === o.value}
            onClick={() => {
              setMode(o.value);
              setEdited(false);
            }}
            className={`min-h-10 rounded-sm px-4 text-sm font-semibold transition ${
              mode === o.value ? "bg-brand text-brand-foreground shadow-card" : "text-muted hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {mode === "auto" ? (
        <GenerateShiftsForm
          action={generate}
          windowLabel={windowLabel}
          windowTimes={windowTimes}
          multiDay={days.length > 1}
          minAdults={minAdults}
          existing={existing}
          signedUp={signedUp}
          job={job}
        />
      ) : (
        <ShiftForm action={create} days={days} />
      )}
    </div>
  );
}

/** "1. Create stations": a sign-up's name. Its leads are picked on its row; the rest comes in step 2. */
/** A station signs people up for times (shifts) or for things to bring (items). */
const SIGNUP_KINDS = [
  { value: "shifts", label: "Time slots", hint: "People sign up for a time, like setting up from 5 to 6 PM" },
  { value: "items", label: "Items to bring", hint: "People sign up to bring something, like desserts or drinks" },
] as const;

type SignupKind = "shifts" | "items";

/** Time slots or items to bring, as two big choices. */
function SignupKindPicker({
  value,
  onChange,
  disabled = false,
  note,
  job = false,
}: {
  value: SignupKind;
  onChange: (kind: SignupKind) => void;
  disabled?: boolean;
  note: string;
  job?: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="text-sm font-semibold">{job ? "What do volunteers sign up for?" : "What do people sign up for?"}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {SIGNUP_KINDS.map((k) => (
          <label
            key={k.value}
            className={`flex gap-3 rounded-lg border p-3 ${disabled ? "opacity-60" : "cursor-pointer"} ${value === k.value ? "border-brand bg-brand-soft" : "border-field-border"}`}
          >
            <input
              type="radio"
              name="signupKind"
              value={k.value}
              checked={value === k.value}
              onChange={() => onChange(k.value)}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--brand)]"
            />
            <span>
              <span className="block text-sm font-semibold">{job ? (k.value === "shifts" ? "Shifts" : "Things to bring") : k.label}</span>
              <span className="block text-sm text-muted">{k.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-sm text-muted">{note}</p>
    </fieldset>
  );
}

/** "Time slots" or "Items to bring", for a sign-up's row. */
export const signupKindLabel = (kind: SignupKind) => SIGNUP_KINDS.find((k) => k.value === kind)!.label;

export function NewStationForm({
  action,
  openTab = false,
  job = false,
}: {
  action: Action;
  /** Go to the new sign-up's tab once it's added. */
  openTab?: boolean;
  /** A volunteer event's job (see StationForm). */
  job?: boolean;
}) {
  const [kind, setKind] = useState<SignupKind>("shifts");
  const picker = (
    <SignupKindPicker
      value={kind}
      onChange={setKind}
      job={job}
      note={job ? "You can change this later, until you add shifts or things to bring." : "You can change this later, until you add time slots or items."}
    />
  );
  return (
    <ActionForm action={action} className="space-y-4">
      {openTab && <input type="hidden" name="openTab" value="1" />}
      {/* A job starts with what volunteers sign up for, like the job's own page. */}
      {job && picker}
      <Field
        label={job ? "Job name" : "Sign-up name"}
        hint={kind === "items" ? "e.g. Potluck, Bake Sale, Supply Drive" : job ? "e.g. Parking, Litter pickup, Setup crew" : "e.g. Parking, Concessions, Ticket Table"}
      >
        <Input name="name" required maxLength={80} />
      </Field>
      {!job && picker}
      {/* The page's one main action: it stays filled, and tapping it with no name says what's missing (light check, 2026-11-08). */}
      <SubmitButton variant="go" pendingText="Adding…" data-solid>
        {job ? "Add job" : "Add sign-up"}
      </SubmitButton>
    </ActionForm>
  );
}

/** Items to bring: one row per item (Desserts, 6 needed), edited right in the row, and a row to add another. */
type EditableItem = { id: string; name: string; needed: number; claimed_count: number; update: Action; remove: () => Promise<ActionState> };

export function ItemsEditor({
  items,
  create,
  autosave = false,
}: {
  /** Each item with its own save and delete (bound on the server). */
  items: EditableItem[];
  create: Action;
  /** A volunteer event's job: each row saves itself a moment after a change, with no Save button. */
  autosave?: boolean;
}) {
  // A thing typed into the add row but not added yet: the job's bar says so, and leaving asks first.
  const unadded = useUnadded();
  return (
    <div className="rounded-lg border border-border bg-background">
      <div className={`hidden ${itemCols(autosave)} gap-3 border-b border-border px-3 py-2 text-sm font-semibold text-muted sm:grid`}>
        <span>Item</span>
        <span>Needed</span>
        {/* A volunteer event's job lists who's signed up further down the page instead. */}
        {!autosave && <span>Signed up</span>}
        <span />
      </div>
      <ul className="divide-y divide-border">
        {items.map((it) => (
          <ItemRow key={it.id} item={it} autosave={autosave} />
        ))}
        <li className="px-3 py-2.5">
          <ActionForm
            action={create}
            resetOnSuccess
            onEdit={autosave ? unadded : undefined}
            className={`grid items-center gap-3 ${autosave ? itemPhone : "grid-cols-[minmax(0,1fr)_6rem]"} ${itemCols(autosave)}`}
          >
            <Input name="name" required maxLength={100} placeholder={items.length ? "Add another item" : "Add an item, e.g. Desserts"} aria-label="New item" className={autosave ? "col-span-3 sm:col-span-1" : undefined} />
            {autosave && <NeededLabel />}
            <NumberInput name="needed" required defaultValue={1} maxLength={3} aria-label="How many needed" />
            {!autosave && <span className="hidden sm:block" />}
            <span className="flex justify-end">
              <SubmitButton variant="go" pendingText="Adding…" className="min-h-9 px-4 text-sm">
                Add
              </SubmitButton>
            </span>
          </ActionForm>
        </li>
      </ul>
    </div>
  );
}

/** On a phone, a job's thing to bring stacks: its name across the row, then "Needed", how many, and Delete. */
const itemPhone = "grid-cols-[auto_5rem_minmax(0,1fr)]";
function NeededLabel() {
  return (
    <span aria-hidden className="text-sm text-muted sm:hidden">
      Needed
    </span>
  );
}

/** The things-to-bring columns: item, needed, (signed up,) and its buttons. */
const itemCols = (autosave: boolean) => (autosave ? "sm:grid-cols-[minmax(0,1fr)_7rem_6rem]" : "sm:grid-cols-[minmax(0,1fr)_7rem_6rem_9rem]");

/** One thing to bring: its name and how many, saved with its Save button, or by itself a moment after a change. */
function ItemRow({ item: it, autosave }: { item: EditableItem; autosave: boolean }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formId = `item-${it.id}`;
  // A lost connection throws instead of answering: show it like any other failed save.
  const update: Action = async (prev, formData) => {
    try {
      return await it.update(prev, formData);
    } catch {
      return { error: "Check your connection, then try again." };
    }
  };
  // Saves now (when the wait is over, or someone's leaving). A blank name or count can't save: the job's bar says so.
  const save = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    if (!form.checkValidity()) return setPending(formId, { kind: "failed" });
    setPending(formId, { kind: "saving" });
    form.requestSubmit();
  }, [formId]);
  // Sending it again if it never gets an answer.
  useEffect(() => onRetry(formId, save), [formId, save]);
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    setPending(formId, { kind: "saving", flush: save });
    timer.current = setTimeout(save, 900);
  };
  useEffect(() => {
    if (!autosave) return;
    const form = document.getElementById(formId);
    const ok = () => setPending(formId, null);
    const failed = () => setPending(formId, { kind: "failed" });
    form?.addEventListener("form-saved", ok);
    form?.addEventListener("form-failed", failed);
    return () => {
      form?.removeEventListener("form-saved", ok);
      form?.removeEventListener("form-failed", failed);
      setPending(formId, null);
    };
  }, [autosave, formId]);
  return (
    // A job's row draws Delete beside its form, not inside it (a form can't hold another form).
    <li className={autosave ? `grid items-center gap-3 px-3 py-2.5 ${itemPhone} ${itemCols(true)}` : "px-3 py-2.5"}>
      <ActionForm
        id={formId}
        action={autosave ? update : it.update}
        resetOnSuccess={false}
        quiet={autosave}
        onEdit={autosave ? schedule : undefined}
        className={autosave ? "contents" : `grid items-center gap-3 grid-cols-[minmax(0,1fr)_6rem] ${itemCols(false)}`}
      >
        {autosave && <input type="hidden" name="auto" value="1" />}
        <Input name="name" required maxLength={100} defaultValue={it.name} aria-label="Item" className={autosave ? "col-span-3 sm:col-span-1" : undefined} />
        {autosave && <NeededLabel />}
        <NumberInput name="needed" required defaultValue={it.needed} maxLength={3} aria-label={`How many ${it.name} needed`} />
        {!autosave && (
          <span className="text-sm tabular-nums text-muted">
            {it.claimed_count >= it.needed ? <span className="font-medium text-success">Covered</span> : `${it.claimed_count} of ${it.needed}`}
          </span>
        )}
        {!autosave && (
          <span className="flex items-center justify-end gap-1">
            <SubmitButton variant="secondary" pendingText="Saving…" className="min-h-9 px-3 text-sm">
              Save
            </SubmitButton>
            <DeleteButton action={it.remove} label={`Delete ${it.name}`} confirmMessage={`Delete “${it.name}”?`} />
          </span>
        )}
      </ActionForm>
      {autosave && (
        <span className="flex items-center justify-end">
          <DeleteButton action={it.remove} label={`Delete ${it.name}`} confirmMessage={`Delete “${it.name}”?`} />
        </span>
      )}
    </li>
  );
}

/**
 * A sign-up's Coordinators: who leads it, as chips, and "+ Add", which opens a
 * window to pick people from the team or invite someone new by email (the
 * invitation also shows in Event settings → Team). Picks are saved with the
 * sign-up's Save button; an invitation goes out right away.
 */
export function CoordinatorPicker({
  label,
  initial,
  options,
  pending,
  invite,
  onChange,
  formId,
}: {
  label: string;
  initial: string[];
  options: LeadOption[];
  /** The form these picks save with, when the picker is drawn outside it. */
  formId?: string;
  /** Emails invited to lead this sign-up who haven't accepted yet. */
  pending: string[];
  invite: Action;
  onChange?: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(initial);
  // The window is only on the page while it's open.
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const nameOf = (id: string) => options.find((o) => o.id === id)?.label ?? "Team member";
  const toggle = (id: string) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    onChange?.();
  };
  // The window sits outside this form on the page, so typing in it doesn't count as editing the sign-up.
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <div className="sm:col-span-2">
      <p className="text-sm font-medium">{label}</p>
      <input type="hidden" name="leadsField" value="1" form={formId} />
      {picked.map((id) => (
        <input key={id} type="hidden" name="leadIds" value={id} form={formId} />
      ))}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {picked.map((id) => (
          <span key={id} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border bg-surface pl-3 text-sm">
            {nameOf(id)}
            <button type="button" onClick={() => toggle(id)} aria-label={`Remove ${nameOf(id)}`} className="min-h-9 rounded-full px-2.5 text-muted hover:text-danger">
              ×
            </button>
          </span>
        ))}
        {pending.map((email) => (
          <span key={email} className="inline-flex min-h-9 items-center rounded-full border border-dashed border-border px-3 text-sm text-muted">
            {email} · invited
          </span>
        ))}
        <Button type="button" variant="secondary" className="min-h-9 px-3 text-sm" onClick={() => setOpen(true)}>
          + Add
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted">They see who&apos;s signed up, and volunteers&apos; phone numbers on event day. Volunteers contact the first one.</p>
      {open &&
        createPortal(
          <dialog
            ref={(el) => {
              dialog.current = el;
              if (el && !el.open) el.showModal();
            }}
            onClose={() => setOpen(false)}
            aria-label={`Add ${label}`}
            onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
            onInput={stop}
            onChange={stop}
            onSubmit={stop}
            className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-elevated backdrop:bg-[#071a31]/50"
          >
            <div className="space-y-6 p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold">Add {label}</h2>
                <button type="button" onClick={() => dialog.current?.close()} className="min-h-10 rounded-md px-2 text-sm font-medium text-muted hover:text-foreground">
                  Close
                </button>
              </div>
              <section>
                <h3 className="text-sm font-semibold">From your team</h3>
                {options.length ? (
                  <div className="mt-2 space-y-1.5">
                    {options.map((o) => (
                      <label key={o.id} className="flex min-h-10 items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm hover:border-brand">
                        <input type="checkbox" checked={picked.includes(o.id)} onChange={() => toggle(o.id)} className="h-5 w-5 shrink-0 accent-[var(--brand)]" />
                        {o.label}
                      </label>
                    ))}
                    <p className="text-xs text-muted">{formId ? "Your picks save automatically." : "Click Save sign-up afterward to keep these."}</p>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-muted">No one on the team yet. Invite someone below.</p>
                )}
              </section>
              <section className="border-t border-border pt-5">
                <h3 className="text-sm font-semibold">Invite someone new</h3>
                <p className="mt-0.5 text-sm text-muted">
                  We email them an invitation. One tap accepts it, and they lead this sign-up. They also appear in Event settings → Team.
                </p>
                <ActionForm action={invite} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Field label="Their email" className="flex-1">
                    <Input name="email" type="email" inputMode="email" autoComplete="off" required />
                  </Field>
                  <SubmitButton pendingText="Sending…" className="sm:mb-0.5">
                    Send invitation
                  </SubmitButton>
                </ActionForm>
              </section>
              <div className="flex justify-end">
                <Button type="button" onClick={() => dialog.current?.close()}>
                  Done
                </Button>
              </div>
            </div>
          </dialog>,
          document.body,
        )}
    </div>
  );
}

export function DeleteButton({
  action,
  label,
  confirmMessage,
  text = "Delete",
  destructive = false,
  quiet = false,
}: {
  action: Action;
  label: string;
  confirmMessage: string;
  text?: string;
  /** A full-size red outlined button, for deleting something big (a whole station). */
  destructive?: boolean;
  /** Red text, no outline: a delete that shouldn't compete with the page's main actions. */
  quiet?: boolean;
}) {
  // A row's delete (the shared "Deleting" part): red text with a bin icon, full height. "Cancel" keeps its plain look.
  const row = !destructive && !quiet;
  return (
    <ActionForm action={action} confirmMessage={confirmMessage} className="contents">
      <SubmitButton
        variant={destructive ? "danger" : "quiet-danger"}
        pendingText={text === "Cancel" ? "Working…" : "Deleting…"}
        className={row ? "gap-1.5 px-1.5 text-sm" : "text-sm"}
        aria-label={row ? label : undefined}
      >
        {row && text !== "Cancel" && <BinIcon />}
        {text}
      </SubmitButton>
    </ActionForm>
  );
}

/** The bin beside a row's Delete. */
export function BinIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`${className} shrink-0`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}

export function InviteForm({
  action,
  roles,
  stations,
}: {
  action: Action;
  roles: { value: "volunteer_director" | "section_lead" | "host"; label: string }[];
  stations: { id: string; name: string }[];
}) {
  const [role, setRole] = useState(roles[0].value);
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="Their email" className="sm:col-span-2">
        <Input name="email" type="email" required autoComplete="off" inputMode="email" />
      </Field>
      {roles.length > 1 ? (
        <Field label="Role">
          <Select name="role" required value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="role" value={roles[0].value} />
      )}
      {role === "host" && (
        <p className="text-sm leading-6 text-muted sm:col-span-2">
          {CO_HOST_POWERS}
        </p>
      )}
      {role === "section_lead" && stations.length > 0 && (
        <Field label="Sign-up they'll lead" hint="Optional. You can also choose later.">
          <Select name="stationId" defaultValue="">
            <option value="">Decide later</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="sm:col-span-2">
        <SubmitButton pendingText="Sending…">Send invitation</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Copies an invitation link, falling back to selecting it for manual copy. */
export function CopyLinkButton({ url, label = "Copy invite link" }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="min-h-11 px-3 text-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          await copyDialog("Copy this invitation link", url);
        }
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

/** A small inline button (Resend, Re-invite) that shows its result next to it. */
export function SmallActionButton({
  action,
  children,
  pendingText = "Sending…",
  label,
}: {
  action: Action;
  children: React.ReactNode;
  pendingText?: string;
  label?: string;
}) {
  return (
    <ActionForm action={action} resetOnSuccess={false} className="contents">
      <SubmitButton variant="secondary" pendingText={pendingText} className="min-h-9 px-3 text-xs" aria-label={label}>
        {children}
      </SubmitButton>
    </ActionForm>
  );
}

export function RemoveButton({ action, label, confirmMessage }: { action: Action; label: string; confirmMessage: string }) {
  return (
    <ActionForm action={action} confirmMessage={confirmMessage} className="contents">
      <SubmitButton variant="ghost" pendingText="Removing…" className="min-h-9 px-2 text-xs" aria-label={label}>
        Remove
      </SubmitButton>
    </ActionForm>
  );
}

/** A single button that runs a server action, showing any error above it. */
export function ActionButton({
  action,
  children,
  variant = "primary",
  confirmMessage,
  confirmLabel,
  pendingText = "Saving…",
  className,
}: {
  action: Action;
  children: React.ReactNode;
  /** "go" (green) and "stop" (red outline) for switching something on or off; "quiet-stop" is red text. */
  variant?: "primary" | "secondary" | "go" | "stop" | "quiet-stop";
  confirmMessage?: string;
  /** The confirm window's button, naming what happens ("Close registration"). */
  confirmLabel?: string;
  pendingText?: string;
  /** For the button itself (e.g. a smaller one in a row of links). */
  className?: string;
}) {
  return (
    <ActionForm action={action} confirmMessage={confirmMessage} confirmLabel={confirmLabel} className="space-y-2" resetOnSuccess={false}>
      <SubmitButton
        variant={variant === "stop" ? "danger" : variant === "quiet-stop" ? "quiet-danger" : variant}
        pendingText={pendingText}
        className={className}
      >
        {children}
      </SubmitButton>
    </ActionForm>
  );
}

/**
 * A band contest's job as a stop on the bands' contest-day path (Parking, Check-in point, Warm-up, Gate),
 * and for Parking or a check-in point, how long before warm-up a band is due. Short choices, with what
 * the chosen one does said under the field. `formId` ties the fields to a form they're drawn outside of.
 */
export function CheckInStopFields({
  kind,
  setKind,
  initial,
  formId,
  orderHref,
}: {
  kind: string;
  setKind: (k: string) => void;
  initial?: { checkpoint_kind?: CheckpointKind | null; due_minutes_before_warm_up?: number | null } | null;
  formId?: string;
  /** The Band check-in order tab, linked from the hint. */
  orderHref?: string;
}) {
  const chosen = CHECKPOINT_KINDS.find((k) => k.value === kind);
  return (
    <>
      <Field
        label="Band check-in stop"
        hint={
          <>
            {chosen ? chosen.hint : "Not a stop: a regular job, like concessions."} A stop is a place bands go through on contest day. Its
            Coordinators check bands in there.{" "}
            {orderHref ? (
              <Link href={orderHref} scroll={false} className="font-medium text-brand underline underline-offset-4">
                Set the order of stops
              </Link>
            ) : null}
          </>
        }
      >
        <Select name="checkpointKind" form={formId} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Not a stop</option>
          {CHECKPOINT_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>
      {(kind === "parking" || kind === "stop") && (
        <Field
          label="Minutes before warm-up"
          hint={
            kind === "parking"
              ? "When a band should be fully parked. After that, it shows as Late on contest day so you can adjust."
              : "When a band should be here. Leave blank if there's no deadline."
          }
        >
          <span className="flex items-center gap-2">
            <NumberInput
              key={kind}
              name="dueMinutes"
              form={formId}
              maxLength={3}
              className="w-24!"
              defaultValue={initial?.checkpoint_kind === kind ? (initial.due_minutes_before_warm_up ?? "") : kind === "parking" ? 60 : ""}
            />
            <span className="text-sm text-muted">minutes</span>
          </span>
        </Field>
      )}
    </>
  );
}

/**
 * How many volunteers on each of a job's shifts must be 18 or older (like adults supervising teens at
 * concessions). Those spots are saved for adults: under-18s can't take them. Blank means age doesn't
 * matter. With Adults only on, it's greyed out (everyone is 18 or older already).
 */
export function AdultsNeededField({
  initial,
  formId,
  className,
  adultsOnly = false,
}: {
  initial?: number | null;
  formId?: string;
  className?: string;
  adultsOnly?: boolean;
}) {
  return (
    <Field
      label="Adults needed per shift"
      hint={
        adultsOnly
          ? "Not needed: with Adults only on, everyone on this job is 18 or older."
          : "Optional. This many spots on each shift are saved for adults (18+), like adults supervising teens. Under-18s can take the rest. People already signed up keep their spots. Leave blank if age doesn't matter."
      }
      className={className}
    >
      <span className="flex items-center gap-2">
        {/* It had a value: a blank now clears it. */}
        {initial != null && <input type="hidden" name="minAdultsWas" value="1" form={formId} />}
        <NumberInput
          name="minAdults"
          form={formId}
          maxLength={2}
          defaultValue={initial ?? ""}
          placeholder="e.g. 2"
          disabled={adultsOnly}
          className="w-24! disabled:opacity-60"
        />
        <span className="text-sm text-muted">adults</span>
      </span>
    </Field>
  );
}

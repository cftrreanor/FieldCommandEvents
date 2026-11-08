"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { BotCheck } from "@/components/bot-check";
import { SubmitButton } from "@/components/submit-button";
import { Button, Card, Field, FormMessage, Input, Textarea } from "@/components/ui";
import type { Mode } from "@/lib/conferences";
import type { BookingState } from "./actions";
import { DayCalendar, longDay } from "./day-calendar";

/** How a family can meet, as they see it. */
export const FAMILY_MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "in_person", label: "In person", hint: "Come to the classroom." },
  { value: "video", label: "Video", hint: "The link to join is in your confirmation email." },
  { value: "phone", label: "Phone call", hint: "Your child's teacher calls you." },
];

type Parent = { name: string; email: string; phone: string };
const blankParent = (): Parent => ({ name: "", email: "", phone: "" });

/** One open meeting time: its value (an ISO instant), how it reads ("3:20 PM"), and its day ("2026-11-03", "Tue, Nov 3"). */
export type OpenTime = { value: string; label: string; day: string; dayLabel: string };

/**
 * A family books a meeting: pick an open time, their child, the parents who'll
 * come (each is emailed), how they'll meet when the teacher offers more than
 * one way (and the number to call, for a phone call), and an optional note.
 * Booked times never show.
 */
export function BookingForm({
  action,
  times,
  modes,
  teacher,
  shared = false,
  place,
  zone,
  askChild = true,
  calendar = false,
  meeting = false,
  contact = null,
  preview = false,
}: {
  action: (prev: BookingState, formData: FormData) => Promise<BookingState>;
  times: OpenTime[];
  /** The ways the teacher offers; with more than one, the family picks. */
  modes: Mode[];
  /** The teacher's name, as families see it. */
  teacher: string;
  /** Its hosts also send booking emails to other addresses, so the note says so. */
  shared?: boolean;
  /** The room and school, for meeting in person. */
  place: string;
  /** The conference's time zone by name, e.g. "Central Time". */
  zone: string;
  /** The teacher asks for the child's name (Edit event details). */
  askChild?: boolean;
  /** Weekly hours: a month calendar of open days, with that day's times beside it. */
  calendar?: boolean;
  /** Meetings: "meeting" where conferences say "conference", and no school wording. */
  meeting?: boolean;
  /** Who to write to when every time is booked (shown only then). */
  contact?: string | null;
  /** The organizer previewing a draft: no Book button. */
  preview?: boolean;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, {});
  const askMode = modes.length > 1;
  const [mode, setMode] = useState<Mode | "">(() => {
    const before = modes.find((m) => m === state.values?.mode);
    return before ?? (askMode ? "" : (modes[0] ?? ""));
  });
  // Phone calls: ask for the number the teacher calls.
  const askPhone = mode === "phone";
  const [startedAt] = useState(() => Date.now());
  const [time, setTime] = useState(state.values?.startsAt ?? "");
  const [parents, setParents] = useState<Parent[]>(() => state.values?.parents ?? [blankParent()]);
  const set = (i: number, patch: Partial<Parent>) => setParents((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  // Someone took the time first: fetch the times that are still open. The
  // taken one drops out of the list, which clears the pick.
  useEffect(() => {
    if (state.taken) router.refresh();
  }, [state, router]);
  const picked = times.some((t) => t.value === time) ? time : "";
  // Weekly hours: pick a day, then a time.
  const days = [...new Map(times.map((t) => [t.day, t.dayLabel]))];
  const [day, setDay] = useState(() => times.find((t) => t.value === state.values?.startsAt)?.day ?? days[0]?.[0] ?? "");
  const shown = calendar || days.length > 1 ? times.filter((t) => t.day === day) : times;
  const openOn = (d: string) => times.filter((t) => t.day === d).length;
  const openDays = new Map(days.map(([d]) => [d, openOn(d)]));
  const pickedTime = times.find((t) => t.value === picked);
  // Pressing Book with no time picked: the form's required check focuses the
  // first time (components/required-fields.tsx); this says what's missing there.
  const [noTime, setNoTime] = useState(false);
  const hint = (m: Mode) =>
    m === "in_person" && place
      ? `Come to ${place}.`
      : m === "phone"
        ? `${teacher} calls you.`
        : meeting && m === "in_person"
          ? "Meet in person."
          : FAMILY_MODES.find((x) => x.value === m)!.hint;

  // Who each person on the booking is: parents at a conference that asks for the child, otherwise "You" and the others.
  const personLabel = (i: number) => (askChild ? `Parent or guardian ${i + 1}` : i === 0 ? "You" : `Person ${i + 1}`);

  // One open time: a radio styled as a button.
  const timeChoice = (t: OpenTime) => (
    <label
      key={t.value}
      className={`flex min-h-11 cursor-pointer items-center justify-center rounded-md border text-sm font-semibold tabular-nums has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)] ${
        picked === t.value
          ? "border-brand bg-brand text-brand-foreground"
          : noTime && !picked
            ? "border-danger hover:border-brand"
            : "border-field-border hover:border-brand"
      }`}
    >
      <input
        type="radio"
        name="time"
        value={t.value}
        checked={picked === t.value}
        onChange={() => setTime(t.value)}
        onInvalid={() => setNoTime(true)}
        required
        className="sr-only"
      />
      {t.label}
    </label>
  );

  if (state.booked) {
    const b = state.booked;
    return (
      <Card data-booked className="space-y-3 border-success/30 bg-success-soft" role="status">
        <h2 className="flex items-center gap-2 text-2xl font-semibold">
          <span aria-hidden className="inline-flex size-8 items-center justify-center rounded-full bg-success text-base text-success-foreground">
            ✓
          </span>
          You&apos;re booked
        </h2>
        <p className="text-lg font-medium">{b.when}</p>
        <p>{b.child ? `Conference for ${b.child}` : `${meeting ? "Meeting" : "Conference"} with ${teacher}`}</p>
        {/* How and where, so no one has to open the email to find out (decisions 2026-11-07). */}
        {mode && (
          <p>
            <span className="font-semibold">{FAMILY_MODES.find((x) => x.value === mode)?.label}:</span>{" "}
            {mode === "in_person"
              ? place
                ? `come to ${place}.`
                : "the place is in your confirmation email."
              : mode === "video"
                ? b.emailSent
                  ? "the link to join is in your confirmation email."
                  : "the link to join is on your booking page, below."
                : `${teacher} calls you at the number you gave.`}
          </p>
        )}
        <p className="text-sm text-muted">
          {b.emailSent
            ? `We emailed your confirmation to ${b.emails.join(" and ")}. It has the details, a calendar invite, and a link to change or cancel. We'll remind you the day before.`
            : "We couldn't send every confirmation email, but your time is booked. Save the link below to change or cancel."}
        </p>
        <a href={b.link} className="font-medium text-brand underline underline-offset-4">
          See, change, or cancel your {meeting ? "meeting" : "conference"}
        </a>
      </Card>
    );
  }

  if (!times.length) {
    return (
      <Card>
        <p className="font-medium">Every time is booked</p>
        <p className="mt-1 text-sm text-muted">
          {contact ? (
            <>
              To find another time, write to {meeting ? teacher : <>your child&apos;s teacher</>} at{" "}
              <a href={`mailto:${contact}`} className="font-medium text-brand underline underline-offset-4 [overflow-wrap:anywhere]">
                {contact}
              </a>
              .
            </>
          ) : (
            "Times open up when someone cancels, so check back later."
          )}
        </p>
        {/* Writing to the organizer is the one thing to do here: a full-size target, not just a link in a sentence. */}
        {contact && (
          <a
            href={`mailto:${contact}`}
            className="mt-3 inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-medium hover:bg-background max-sm:w-full max-sm:justify-center"
          >
            Email {meeting ? teacher : "the teacher"}
          </a>
        )}
        <p className="mt-2 text-sm text-muted">Already booked? Use the link in your confirmation email to change or cancel.</p>
      </Card>
    );
  }

  return (
    <form action={formAction} className="space-y-10">
      <input type="hidden" name="startedAt" value={startedAt} />
      <input type="hidden" name="startsAt" value={picked} />
      <input type="hidden" name="parents" value={JSON.stringify(parents)} />
      {/* Left empty by people; bots fill it in. */}
      <div aria-hidden className="hidden">
        <label>
          Website <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <section aria-labelledby="meeting-heading" className="space-y-6">
        <h2 id="meeting-heading" className="text-2xl font-semibold">
          Your meeting
        </h2>

        {calendar ? (
          <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:gap-8">
            <fieldset>
              <legend className="font-semibold">Pick a day</legend>
              <p className="text-sm text-muted">Circled days have open times.</p>
              <div className="mt-3">
                <DayCalendar
                  open={openDays}
                  selected={day}
                  onSelect={(d) => {
                    setDay(d);
                    setTime("");
                  }}
                />
              </div>
            </fieldset>
            <fieldset aria-describedby={noTime && !picked ? "time-error" : undefined} className="min-w-0">
              <legend className="font-semibold">{day ? longDay(day) : "Pick a time"}</legend>
              <p className="text-sm text-muted">All times are {zone}.</p>
              {noTime && !picked && (
                <p id="time-error" role="alert" className="mt-2 text-sm font-semibold text-danger">
                  Choose a time to book.
                </p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:max-h-[22rem] sm:grid-cols-1 sm:overflow-y-auto sm:pr-1">{shown.map(timeChoice)}</div>
            </fieldset>
          </div>
        ) : (
          <>
          {days.length > 1 && (
            <fieldset>
              <legend className="font-semibold">Pick a day</legend>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {days.map(([value, label]) => (
                  <label
                    key={value}
                    className={`flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-2 text-center text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)] ${
                      day === value ? "border-brand bg-brand text-brand-foreground" : "border-field-border hover:border-brand"
                    }`}
                  >
                    <input type="radio" name="day" value={value} checked={day === value} onChange={() => setDay(value)} className="sr-only" />
                    <span className="flex flex-col items-center py-1 leading-tight">
                      {label}
                      <span className={`text-xs font-normal ${day === value ? "" : "text-muted"}`}>{openOn(value)} open</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset aria-describedby={noTime && !picked ? "time-error" : undefined}>
            <legend className="font-semibold">Pick a time</legend>
            <p className="text-sm text-muted">Only open times are shown. All times are {zone}.</p>
            {noTime && !picked && (
              <p id="time-error" role="alert" className="mt-2 text-sm font-semibold text-danger">
                Choose a time to book.
              </p>
            )}
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {shown.map(timeChoice)}
            </div>
          </fieldset>
          </>
        )}

        {askMode && (
          <fieldset>
            <legend className="font-semibold">How would you like to meet?</legend>
            <div className={`mt-2 grid gap-2 ${modes.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              {FAMILY_MODES.filter((m) => modes.includes(m.value)).map((m) => (
                <label key={m.value} className="flex cursor-pointer gap-3 rounded-lg border border-field-border p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                  <input
                    type="radio"
                    name="mode"
                    value={m.value}
                    required
                    checked={mode === m.value}
                    onChange={() => setMode(m.value)}
                    className="team-radio mt-1"
                  />
                  <span>
                    <span className="block font-semibold">{m.label}</span>
                    <span className="block text-sm text-muted">{hint(m.value)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {askPhone && (
          <Field label="Phone number for the call" hint={`${teacher} calls you at this number. The call may come from a school or private number.`}>
            <Input name="callPhone" type="tel" required maxLength={30} defaultValue={state.values?.callPhone} autoComplete="tel" />
          </Field>
        )}
      </section>

      <section aria-labelledby="family-heading" className="space-y-6">
        <h2 id="family-heading" className="text-2xl font-semibold">
          {askChild ? "Your family" : "Who's coming"}
        </h2>

        {askChild && (
          <Field label="Your child's first and last name">
            <Input name="child" required maxLength={120} defaultValue={state.values?.child} autoComplete="off" />
          </Field>
        )}

        <fieldset className="space-y-4">
          <legend className="font-semibold">
            {askChild
              ? askPhone
                ? "Parents or guardians on the call"
                : "Parents or guardians coming"
              : askPhone
                ? "You, and anyone else on the call"
                : "You, and anyone else coming"}
          </legend>
          <p className="-mt-3 text-sm text-muted">Each person gets the confirmation, calendar invite, and reminder.</p>
          {parents.map((p, i) => (
            <fieldset key={i} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
              {/* Says whose "Name" and "Email" these are; shown once there's more than one. */}
              <legend className={parents.length > 1 ? "px-1 text-sm font-semibold text-muted" : "sr-only"}>{personLabel(i)}</legend>
              <Field label="Name">
                <Input required maxLength={120} value={p.name} onChange={(e) => set(i, { name: e.target.value })} autoComplete={i ? "off" : "name"} />
              </Field>
              <Field label="Email">
                <Input
                  required
                  type="email"
                  maxLength={254}
                  value={p.email}
                  onChange={(e) => set(i, { email: e.target.value })}
                  autoComplete={i ? "off" : "email"}
                />
              </Field>
              {/* Phone calls: the first parent's number is the one asked for above. */}
              {!(askPhone && i === 0) && (
                <Field label="Mobile phone (optional)">
                  <Input type="tel" maxLength={30} value={p.phone} onChange={(e) => set(i, { phone: e.target.value })} autoComplete={i ? "off" : "tel"} />
                </Field>
              )}
              {/* Without the child, "You" stays; only the people added can be removed. */}
              {parents.length > 1 && (askChild || i > 0) && (
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="danger"
                    aria-label={`Remove ${askChild ? `parent or guardian ${i + 1}` : `person ${i + 1}`}`}
                    onClick={() => setParents((list) => list.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </fieldset>
          ))}
          {parents.length < 4 && (
            <Button type="button" variant="secondary" onClick={() => setParents((list) => [...list, blankParent()])}>
              {askChild ? "+ Add another parent or guardian" : "+ Add someone else"}
            </Button>
          )}
        </fieldset>

        <Field
          label="Anything you'd like to talk about? (optional)"
          // Without the child's name, the note isn't about a student, so no medical caution.
          hint={`Only ${teacher}${shared ? ", their helpers, and the people they've chosen to notify" : " and their helpers"} see your note.${askChild ? " Please leave out health or medical details; share those with the school directly." : ""}`}
        >
          <Textarea name="note" rows={3} maxLength={500} defaultValue={state.values?.note} />
        </Field>
      </section>

      <div className="space-y-4">
        {preview ? (
          // The organizer's preview of a draft: everything as people will see it, except booking.
          <p className="rounded-md border border-border bg-brand-soft px-3 py-2 text-sm">Preview: booking opens when you publish.</p>
        ) : (
          <>
            <BotCheck />
            <FormMessage error={state.error} />
            <SubmitButton pendingText="Booking…" className="max-sm:w-full">
              {pickedTime ? `Book ${days.length > 1 ? `${pickedTime.dayLabel}, ` : ""}${pickedTime.label}` : "Book this time"}
            </SubmitButton>
            {/* What's still needed, beside the button (one "not ready yet" signal everywhere, decisions 2026-11-08). */}
            {(() => {
              const needed = [!pickedTime && "a time", askMode && !mode && "how you'll meet", !(parents[0]?.name.trim() && parents[0]?.email.trim()) && "your name and email"].filter(
                (x): x is string => Boolean(x),
              );
              return needed.length ? <p className="text-sm text-muted">Still needed: {listWords(needed)}</p> : null;
            })()}
          </>
        )}
      </div>
    </form>
  );
}

/** "a time", "a time and your name", "a time, how you'll meet, and your name" (Oxford comma). */
function listWords(items: string[]) {
  if (items.length < 3) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** An open time a meeting can move to: its value (when it starts) and how it reads, grouped by day. */
export type OpenSlot = { value: string; day: string; label: string };

/** The days a typed-in time can be on (the event's dates, in its time zone). */
export type DayRange = { min: string; max: string; zone: string };

const dialogClass =
  // team-window: in dark mode a raised color with a visible edge, over a darker page (globals.css).
  "team-window m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border p-0 text-foreground shadow-elevated";

/** A button that opens a dialog; the dialog closes on its own Cancel, a click outside, or a successful save. */
function DialogButton({
  label,
  title,
  className,
  children,
}: {
  label: string;
  title: string;
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  // A fresh form each time it opens.
  const [opened, setOpened] = useState(0);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  const close = () => setOpen(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpened((n) => n + 1);
          setOpen(true);
        }}
        className={className}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-label={title}
        onClose={close}
        onClick={(e) => e.target === e.currentTarget && close()}
        className={dialogClass}
      >
        {open && (
          <div key={opened} className="p-6">
            <h2 className="text-xl font-semibold">{title}</h2>
            {children(close)}
          </div>
        )}
      </dialog>
    </>
  );
}

/** The optional note added to the email the family gets. */
function NoteField({ who }: { who: string }) {
  return (
    <Field label="Add a note to the email (optional)" hint={`${who} sees it in the email we send, under your name.`}>
      <Textarea name="note" rows={3} maxLength={1000} placeholder="e.g. Sorry for the change. Something came up at that time." />
    </Field>
  );
}

/**
 * Reschedule: pick an open time, or type in a day and time (any time on the
 * event's days, even outside the open hours), with an optional note. The
 * database checks the time is free and on one of the event's days.
 */
export function RescheduleButton({
  who,
  them,
  current,
  slots,
  days,
  action,
}: {
  /** "Ava Lopez's family", or the person's name. */
  who: string;
  /** "the family", or "them". */
  them: string;
  /** The meeting's time now, as it reads. */
  current: string;
  slots: OpenSlot[];
  days: DayRange;
  action: Action;
}) {
  const [how, setHow] = useState<"open" | "custom">(slots.length ? "open" : "custom");
  const oneDay = days.min === days.max;
  const byDay = [...new Set(slots.map((s) => s.day))];
  return (
    <DialogButton
      label="Reschedule"
      title={`Reschedule the meeting with ${who}`}
      className="inline-flex min-h-11 items-center text-sm font-medium text-brand underline hover:text-brand-hover"
    >
      {(close) => (
        <ActionForm action={action} resetOnSuccess={false} onSuccess={close} className="mt-4 space-y-4">
          <p className="text-sm text-muted">Now: {current}</p>
          <fieldset className="space-y-2">
            <legend className="sr-only">New time</legend>
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
              <input
                type="radio"
                name="how"
                value="open"
                checked={how === "open"}
                onChange={() => setHow("open")}
                disabled={!slots.length}
                className="team-radio"
              />
              Pick an open time{!slots.length && <span className="font-normal text-muted"> (none left)</span>}
            </label>
            {how === "open" && (
              <Select name="slot" required aria-label="Open time" defaultValue="">
                <option value="" disabled>
                  Choose a time
                </option>
                {byDay.map((d) => (
                  <optgroup key={d} label={d}>
                    {slots
                      .filter((s) => s.day === d)
                      .map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
            )}
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
              <input type="radio" name="how" value="custom" checked={how === "custom"} onChange={() => setHow("custom")} className="team-radio" />
              Type in a {oneDay ? "time" : "day and time"}
            </label>
            {how === "custom" && (
              <div className="space-y-2">
                <div className="grid gap-3 sm:grid-cols-2">
                  {oneDay ? (
                    <input type="hidden" name="date" value={days.min} />
                  ) : (
                    <Field label="Day">
                      <Input type="date" name="date" required min={days.min} max={days.max} />
                    </Field>
                  )}
                  <Field label={`Start time (${days.zone})`}>
                    <Input type="time" name="time" required step={300} />
                  </Field>
                </div>
                <p className="text-xs text-muted">Any time {oneDay ? "that day" : "on the event's days"}, even outside your open hours. It can&apos;t overlap another meeting.</p>
              </div>
            )}
          </fieldset>
          <NoteField who={who} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Never mind
            </Button>
            <SubmitButton pendingText="Moving…">Reschedule and email {them}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </DialogButton>
  );
}

/** Cancel, with what happens spelled out and an optional note for the email. */
export function CancelMeetingButton({ who, them, action }: { who: string; them: string; action: Action }) {
  return (
    <DialogButton
      label="Cancel meeting"
      title={`Cancel the meeting with ${who}?`}
      // Quieter than Reschedule in both modes (dark mode's muted text is white, lesson L6).
      className="inline-flex min-h-11 items-center text-sm font-medium text-foreground/70 underline hover:text-danger"
    >
      {(close) => (
        <ActionForm action={action} resetOnSuccess={false} onSuccess={close} className="mt-4 space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted">
            <li>We email {them} that it&apos;s canceled, with an update for their calendar.</li>
            <li>Their details are deleted, and the time opens up again.</li>
          </ul>
          <NoteField who={who} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Keep the meeting
            </Button>
            <SubmitButton variant="warn" pendingText="Canceling…">
              Cancel and email {them}
            </SubmitButton>
          </div>
        </ActionForm>
      )}
    </DialogButton>
  );
}

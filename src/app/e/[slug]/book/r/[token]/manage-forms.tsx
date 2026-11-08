"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Field, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import type { Mode } from "@/lib/conferences";
import { FAMILY_MODES } from "../../booking-form";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Move the meeting to another open time (and, when the teacher offers more
 * than one way, change how they'll meet; switching to a phone call asks for
 * the number to call).
 */
export function ChangeBookingForm({
  action,
  current,
  times,
  mode,
  modes,
  teacher,
}: {
  action: Action;
  /** The booked time, kept as the first choice. */
  current: { value: string; label: string };
  times: { value: string; label: string }[];
  mode: Mode;
  /** The ways the teacher offers now. */
  modes: Mode[];
  /** Meetings: who calls ("Pat Lee"); conferences say "Your child's teacher". */
  teacher?: string;
}) {
  const askMode = modes.length > 1;
  const [time, setTime] = useState(current.value);
  const [how, setHow] = useState<Mode>(askMode && !modes.includes(mode) ? modes[0] : mode);
  const next = askMode ? how : (modes[0] ?? mode);
  // A call needs a number; a booking that's already a call has one.
  const askPhone = next === "phone" && mode !== "phone";
  const changed = time !== current.value || next !== mode;
  return (
    <ActionForm action={action} resetOnSuccess={false} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Time">
          <Select name="startsAt" value={time} onChange={(e) => setTime(e.target.value)}>
            <option value={current.value}>{current.label} (your time)</option>
            {times.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        {askMode && (
          <Field label="How you'll meet">
            <Select name="mode" value={how} onChange={(e) => setHow(e.target.value as Mode)}>
              {FAMILY_MODES.filter((m) => modes.includes(m.value)).map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      {askPhone && (
        <Field label="Phone number for the call" hint={`${teacher ?? "Your child's teacher"} calls you at this number. The call may come from a ${teacher ? "" : "school or "}private number.`}>
          <Input name="callPhone" type="tel" required maxLength={30} autoComplete="tel" />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton disabled={!changed} aria-describedby={changed ? undefined : "change-hint"}>
          Save the change
        </SubmitButton>
        {!changed && (
          <p id="change-hint" className="text-sm text-muted">
            {askMode ? "Pick a new time or a different way to meet first." : "Pick a new time first."}
          </p>
        )}
      </div>
    </ActionForm>
  );
}

/** Cancel the meeting: red, and the confirmation says what happens. */
export function CancelBookingButton({
  action,
  child,
  meeting = false,
}: {
  action: () => Promise<ActionState>;
  /** Null when the teacher doesn't ask for it. */
  child: string | null;
  meeting?: boolean;
}) {
  return (
    <ActionForm
      action={async () => action()}
      // Buttons that say what happens (decisions 2026-11-07, finding 4): never "Continue".
      confirmMessage={
        meeting
          ? "Cancel your meeting? Your time opens up for someone else. We'll email everyone on this booking, and your details are deleted."
          : `Cancel your conference${child ? ` for ${child}` : ""}? Your time opens up for another family. We'll email everyone on this booking, and your details are deleted.`
      }
      confirmLabel={meeting ? "Cancel my meeting" : "Cancel my conference"}
      cancelLabel={meeting ? "Keep my meeting" : "Keep my conference"}
    >
      <SubmitButton variant="danger" pendingText="Canceling…">
        {meeting ? "Cancel meeting" : "Cancel conference"}
      </SubmitButton>
    </ActionForm>
  );
}

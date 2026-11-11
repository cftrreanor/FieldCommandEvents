"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Button, Field } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { DateField } from "@/components/date-field";
import { TimeField } from "@/components/time-field";

/**
 * Parent Registration → Registration settings: when registration closes on
 * its own, and whether walk-ins can attend. Saved together from a bar pinned
 * to the bottom of the screen, which says whether anything's unsaved.
 */
export function ParentSettingsForm({
  action,
  date: savedDate,
  time: savedTime,
  walkIns: savedWalkIns,
  zone,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  /** The saved closing day and time in the event's time zone, or blank. */
  date: string;
  time: string;
  walkIns: boolean;
  /** "All times are Central Time" */
  zone: string;
}) {
  const [dirty, setDirty] = useState(false);
  const [date, setDate] = useState(savedDate);
  const [time, setTime] = useState(savedTime);
  const [walkIns, setWalkIns] = useState(savedWalkIns);
  return (
    <ActionForm action={action} resetOnSuccess={false} className="space-y-6" onEdit={() => setDirty(true)} onSuccess={() => setDirty(false)}>
      <fieldset>
        <legend className="text-sm font-semibold">Close automatically (optional)</legend>
        <p className="mt-1 text-sm text-muted">{zone}. Registration closes on its own then; you can still open or close it yourself.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Close registration on">
            <DateField name="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-56" />
          </Field>
          <Field label="At">
            <TimeField name="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-40" />
          </Field>
          {(date || time) && (
            <Button
              type="button"
              variant="quiet-danger"
              className="min-h-11 px-0"
              onClick={(e) => {
                setDate("");
                setTime("");
                setDirty(true);
                // Leaving the tab asks first, as it does after typing (setup-leave.tsx).
                e.currentTarget.form?.dispatchEvent(new Event("change", { bubbles: true }));
              }}
            >
              Remove the closing time
            </Button>
          )}
        </div>
      </fieldset>

      <fieldset className="border-t border-border pt-5">
        <legend className="text-sm font-semibold">Can parents who didn&apos;t register still attend?</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            { yes: true, label: "Yes, walk-ins can attend", hint: "Once registration closes, the page tells parents they can still come with a valid government-issued photo ID." },
            { yes: false, label: "No, registered parents only", hint: "Once registration closes, the page tells parents to contact the school." },
          ].map((o) => (
            <label
              key={o.label}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${walkIns === o.yes ? "border-brand bg-brand-soft" : "border-field-border"}`}
            >
              <input
                type="radio"
                name="walkIns"
                value={o.yes ? "yes" : "no"}
                checked={walkIns === o.yes}
                onChange={() => setWalkIns(o.yes)}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--brand)]"
              />
              <span>
                <span className="block font-semibold">{o.label}</span>
                <span className="block text-sm text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="sticky bottom-[var(--day-bar,0px)] z-10 -mx-4 -mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-b-lg border-t-2 border-border bg-surface px-4 py-3 shadow-[0_-6px_16px_rgb(0_0_0/0.10)] sm:-mx-6 sm:-mb-6 sm:px-6">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-sm" aria-live="polite">
          {dirty ? (
            <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-[#f5b301] ring-1 ring-warning/50" />
          ) : (
            <span aria-hidden className="font-bold text-success">
              ✓
            </span>
          )}
          <span className="font-semibold">{dirty ? "Unsaved changes" : "All changes saved"}</span>
        </p>
        <SubmitButton pendingText="Saving…" disabled={!dirty}>
          Save settings
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

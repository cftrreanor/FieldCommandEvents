"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { NumberInput } from "@/components/number-input";
import { SubmitButton } from "@/components/submit-button";
import { Field, Input, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { DateField } from "@/components/date-field";

/**
 * Band Registration → Registration settings: what directors see and agree to.
 * Save sits in a footer pinned to the bottom of the screen until the form ends,
 * like Event details, saying whether anything's unsaved.
 */
export function BandSettingsForm({
  action,
  chaperoneLimit,
  classifications,
  deadline,
  directorInfo,
  contact,
  contactSaved,
  one = "band",
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  chaperoneLimit: number;
  classifications: string[];
  deadline: string;
  directorInfo: string;
  /** Filled in from the host's own profile until a contact is saved. */
  contact: { name: string; phone: string; email: string };
  contactSaved: boolean;
  /** "band" or "group". */
  one?: string;
}) {
  const [dirty, setDirty] = useState(false);
  return (
    <ActionForm
      action={action}
      className="grid gap-4 sm:grid-cols-2"
      resetOnSuccess={false}
      onEdit={() => setDirty(true)}
      onSuccess={() => setDirty(false)}
    >
      <Field label="Registration deadline" hint="Optional. Registration closes automatically at the end of this day.">
        <DateField name="deadline" defaultValue={deadline} />
      </Field>
      <Field label={`Chaperone limit per ${one}`}>
        <NumberInput name="chaperoneLimit" defaultValue={chaperoneLimit} required />
      </Field>
      <Field label="Classifications" hint="Separate with commas, e.g. 1A, 2A, 3A, 4A, 5A, 6A" className="sm:col-span-2">
        <Input name="classifications" defaultValue={classifications.join(", ")} required />
      </Field>
      <Field
        label={`Information for ${one} directors`}
        hint={`Optional. Shown on the registration page and each ${one}'s page: entry fee and how to pay, arrival and unloading, bus parking, awards.`}
        className="sm:col-span-2"
      >
        <Textarea name="directorInfo" defaultValue={directorInfo} maxLength={3000} rows={6} />
      </Field>
      <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-medium">Contact for {one} directors</legend>
        <p className="-mt-2 text-sm text-muted sm:col-span-3">
          Only directors registered for this event (and your team) can see this. Call and Text buttons appear for
          directors the day before and on the day itself.
          {!contactSaved && ` We've filled in your details; change them if someone else handles ${one}s.`}
        </p>
        <Field label="Name">
          <Input name="contactName" defaultValue={contact.name} autoComplete="name" />
        </Field>
        <Field label="Mobile">
          <Input name="contactPhone" type="tel" inputMode="tel" defaultValue={contact.phone} />
        </Field>
        <Field label="Email">
          <Input name="contactEmail" type="email" defaultValue={contact.email} />
        </Field>
      </fieldset>
      <div className="sticky bottom-[var(--day-bar,0px)] z-10 -mx-4 -mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-b-lg border-t-2 border-border bg-surface px-4 py-3 shadow-[0_-6px_16px_rgb(0_0_0/0.10)] sm:col-span-2 sm:-mx-6 sm:-mb-6 sm:px-6">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-sm" aria-live="polite">
          {dirty || !contactSaved ? (
            <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-[#f5b301] ring-1 ring-warning/50" />
          ) : (
            <span aria-hidden className="font-bold text-success">
              ✓
            </span>
          )}
          <span className="font-semibold">{dirty ? "Unsaved changes" : contactSaved ? "All changes saved" : "Not saved yet"}</span>
        </p>
        <SubmitButton pendingText="Saving…" disabled={contactSaved && !dirty}>
          Save settings
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

"use client";

import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/action-state";
import { DateField } from "@/components/date-field";

/** Write a note; add a date to make it a follow-up. */
export function NoteComposer({ action }: { action: (prev: ActionState, formData: FormData) => Promise<ActionState> }) {
  return (
    <ActionForm action={action} className="space-y-2">
      <textarea
        name="body"
        required
        maxLength={5000}
        rows={3}
        placeholder="Add a note: a call, an email, what they asked for…"
        aria-label="Note"
        className="w-full rounded-sm border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-muted">
          Follow up on
          <DateField name="followUpOn" aria-label="Follow up on" className="w-52 text-foreground" />
        </label>
        <SubmitButton className="h-8 min-h-8! rounded-sm px-3">Save note</SubmitButton>
      </div>
    </ActionForm>
  );
}

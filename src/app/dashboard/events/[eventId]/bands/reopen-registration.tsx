"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Button, Field } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { DateField } from "@/components/date-field";

/**
 * After the deadline passed: reopen registration with a new deadline (or
 * none), for a host who closed it too early or is giving directors more time.
 * Sits in the registration card's button row; the new-deadline box opens on
 * its own line under the row, with its own Save and reopen button.
 */
export function ReopenRegistration({
  action,
  today,
  deadlineRequired = false,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  /** Today in the event's time zone (YYYY-MM-DD): the earliest new deadline. */
  today: string;
  /** A band contest always has a deadline. */
  deadlineRequired?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="go" className="px-3! text-xs!" aria-expanded={open} onClick={() => setOpen(!open)}>
        Reopen registration
      </Button>
      {open && (
        <ActionForm action={action} className="mt-1 basis-full space-y-3 rounded-lg border border-border bg-background p-4" onSuccess={() => setOpen(false)}>
          <Field
            label="New deadline"
            hint={deadlineRequired ? "Registration closes at the end of this day." : "Leave blank for no deadline. Registration closes at the end of this day."}
            className="max-w-xs"
          >
            <DateField name="deadline" min={today} required={deadlineRequired} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="go" pendingText="Reopening…">
              Save and reopen
            </SubmitButton>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </ActionForm>
      )}
    </>
  );
}

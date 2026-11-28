"use client";
import { useState } from "react";
import { ActionForm, useFieldErrors } from "@/components/action-form";
import { copyDialog } from "@/components/confirm-dialog";
import { toast } from "@/components/toaster";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/action-state";
import { Field, Textarea } from "@/components/ui";
import { BTN_OUTLINE, CheckIcon, LINK } from "../parts";

/**
 * "Ask Dana to choose Event Command", with an optional note: the app sends the email, then says what was sent in the
 * server's words ("Sent to Dana: a request to choose Event Command…"; consultant 5, UX F6). Copy email as a fallback.
 */
export function AskHostButton({
  action,
  plan,
  first,
  email,
  label,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  plan: string;
  first: string;
  email: string;
  label: string;
}) {
  const [sent, setSent] = useState<string | null>(null);
  const send = async (prev: ActionState, data: FormData) => {
    const r = await action(prev, data);
    if (r.ok) setSent(r.message ?? `Sent to ${first}. They'll get an email with a link to ask us about it.`);
    return r;
  };
  return (
    <div className="space-y-3">
      {sent ? (
        <p role="status" className="flex items-start gap-2 rounded-md border border-success/40 bg-success-soft px-4 py-3">
          <CheckIcon className="mt-1 size-5 text-success" /> <span>{sent}</span>
        </p>
      ) : (
        <ActionForm action={send} noToast resetOnSuccess={false} className="space-y-3">
          <input type="hidden" name="plan" value={plan} />
          <NoteField first={first} />
          <SubmitButton pendingText="Sending…">{label}</SubmitButton>
        </ActionForm>
      )}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span>
          Or email {first} yourself:{" "}
          <a href={`mailto:${email}`} className={`${LINK} [overflow-wrap:anywhere]`}>
            {email}
          </a>
        </span>
        <button
          type="button"
          className={BTN_OUTLINE}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(email);
              toast("Email address copied.");
            } catch {
              await copyDialog("Copy this email address", email);
            }
          }}
        >
          Copy email
        </button>
      </p>
    </div>
  );
}

/** "Add a note for Dana (optional)": up to 500 characters, sent with the email. */
function NoteField({ first }: { first: string }) {
  const errors = useFieldErrors();
  return (
    <Field label={`Add a note for ${first} (optional)`} error={errors.note} errorId="ask-host-note-error">
      <Textarea name="note" rows={3} maxLength={500} {...(errors.note ? { "aria-invalid": true, "aria-describedby": "ask-host-note-error" } : {})} />
    </Field>
  );
}

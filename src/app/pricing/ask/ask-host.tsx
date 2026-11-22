"use client";
import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { copyDialog } from "@/components/confirm-dialog";
import { toast } from "@/components/toaster";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/action-state";
import { CheckIcon, LINK } from "../parts";

/** "Ask Dana to choose Event Command": the app sends the email, then says "Sent to Dana". Copy email as a fallback. */
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
  const [sent, setSent] = useState(false);
  return (
    <div className="space-y-3">
      {sent ? (
        <p role="status" className="flex items-start gap-2 rounded-md border border-success/40 bg-success-soft px-4 py-3 font-semibold">
          <CheckIcon className="mt-0.5 size-5 text-success" /> Sent to {first}
        </p>
      ) : (
        <ActionForm action={action} onSuccess={() => setSent(true)} noToast>
          <input type="hidden" name="plan" value={plan} />
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
          className={`${LINK} inline-flex min-h-11 items-center`}
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

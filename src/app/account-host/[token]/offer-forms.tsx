"use client";

import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/action-state";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Accept (the main button) and Decline, for an offer of the Account Host role. */
export function OfferButtons({ accept, decline }: { accept: Action; decline: Action }) {
  return (
    <div className="flex flex-col gap-2">
      <ActionForm action={accept} resetOnSuccess={false}>
        <SubmitButton className="w-full" pendingText="Accepting…">
          Accept and become Account Host
        </SubmitButton>
      </ActionForm>
      <ActionForm
        action={decline}
        resetOnSuccess={false}
        confirmMessage="Decline the Account Host role? The Account Host stays the same, and we'll let them know."
        confirmLabel="Decline"
      >
        <SubmitButton variant="secondary" className="w-full" pendingText="Declining…">
          Decline
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

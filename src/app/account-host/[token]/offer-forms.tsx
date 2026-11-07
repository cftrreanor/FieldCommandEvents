"use client";

import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/action-state";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Accept (the main button) and Decline, for an offer of the Account Host role. */
export function OfferButtons({ accept, decline, from }: { accept: Action; decline: Action; from: string }) {
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
        confirmMessage={`Decline the Account Host role? ${from} stays the Account Host, and we'll let them know. You stay a co-host.`}
        confirmLabel="Decline"
        cancelLabel="Keep the offer open"
      >
        <SubmitButton variant="secondary" className="w-full" pendingText="Declining…">
          Decline
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

/**
 * "Withdraw this band", with a confirmation that says what happens and asks
 * the director to tick that they understand before the red button works.
 */
export function WithdrawBandButton({
  bandName,
  eventName,
  removes,
  one,
  action,
  label,
  outline = false,
}: {
  bandName: string;
  eventName: string;
  /** Registration is open and times aren't posted: the registration is removed (otherwise it's marked withdrawn). */
  removes: boolean;
  /** "band" or "group". */
  one: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  /** The button's words (default "Withdraw this [band]"). */
  label?: string;
  /** A red outline button (festivals: the one look for Remove, Withdraw, Turn off, and Delete). */
  outline?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [sure, setSure] = useState(false);
  const close = () => {
    dialog.current?.close();
    setSure(false);
  };

  return (
    <>
      <Button
        type="button"
        variant={outline ? "danger" : "quiet-danger"}
        onClick={() => dialog.current?.showModal()}
        className={outline ? "text-sm" : "min-h-11 px-0 text-sm"}
      >
        {label ?? `Withdraw this ${one}`}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="withdraw-title"
        onClick={(e) => e.target === e.currentTarget && close()}
        onClose={() => setSure(false)}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border bg-surface p-0 text-foreground shadow-elevated backdrop:bg-[#071a31]/50"
      >
        <div className="p-6">
          <h2 id="withdraw-title" className="text-xl font-semibold">
            Withdraw {bandName}?
          </h2>
          <p className="mt-3 leading-7">
            {bandName} won&apos;t take part in {eventName}.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-muted">
            {removes ? (
              <>
                <li>Your registration is removed.</li>
                <li>To take part after all, register again while registration is open.</li>
              </>
            ) : (
              <>
                <li>{one === "group" ? "Your group is marked withdrawn on the organizer's list." : "Your band is marked withdrawn on the schedule."}</li>
                <li>Only the organizer can undo this.</li>
              </>
            )}
            <li>The organizer is emailed right away.</li>
          </ul>
          <label className="mt-5 flex items-start gap-3 text-sm font-medium">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--danger)]" />
            I understand that {bandName} is withdrawing from {eventName}.
          </label>
          <ActionForm action={action} className="mt-6 flex flex-wrap justify-end gap-2" resetOnSuccess={false}>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <SubmitButton variant="warn" disabled={!sure} pendingText="Withdrawing…">
              Withdraw {one}
            </SubmitButton>
          </ActionForm>
        </div>
      </dialog>
    </>
  );
}

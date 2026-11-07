"use client";

import { useRouter } from "next/navigation";
import { createContext, use, useActionState, useEffect, useRef, useState, startTransition, type ReactNode } from "react";
import { confirmDialog, confirmFromText, shareDialog } from "@/components/confirm-dialog";
import type { ActionState } from "@/lib/action-state";
import { toast } from "./toaster";
import { FormMessage } from "./ui";

/** Lets <SubmitButton> know a manually-submitted ActionForm is saving. */
export const ActionPendingContext = createContext(false);

const FieldErrorsContext = createContext<Record<string, string>>({});

/** The current per-field errors of the surrounding ActionForm, keyed by input name. */
export function useFieldErrors() {
  return use(FieldErrorsContext);
}

/**
 * A form wired to a Server Action that returns ActionState. Shows the error or
 * success message, keeps what the user typed when there's an error, and
 * clears the form after a success. `validate` checks answers in the browser
 * first, so simple slips don't need a trip to the server. After an error, the
 * first field with a problem (or else the message) is scrolled to and focused.
 */
export function ActionForm({
  action,
  children,
  className,
  confirmMessage,
  confirmLabel,
  cancelLabel,
  resetOnSuccess = true,
  onSuccess,
  validate,
  noValidate,
  onEdit,
  quiet = false,
  onError,
  id,
}: {
  /** Lets a button outside the form (form={id}) submit it. */
  id?: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  /** Ask first, in our confirm window: "The question? What happens." */
  confirmMessage?: string;
  /** The confirm window's action button ("Delete sign-up"); "Continue" if not given. */
  confirmLabel?: string;
  /** The confirm window's back-out button (default "Never mind"). */
  cancelLabel?: string;
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
  validate?: (data: FormData) => ActionState | null;
  /** Skip the browser's own one-at-a-time pop-ups, when `validate` shows every problem itself. */
  noValidate?: boolean;
  /** Called as the user types or picks anything (after a reset too), with the form. */
  onEdit?: (form: HTMLFormElement) => void;
  /** Saves itself as people type: something else shows its errors, and the cursor never jumps to them. */
  quiet?: boolean;
  /** Called with each error the server sends back (for a form that shows them somewhere of its own). */
  onError?: (error: string) => void;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  // A problem found in the browser, shown instead of the last server answer.
  const [checked, setChecked] = useState<ActionState | null>(null);
  const shown = checked ?? state;
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const onEditRef = useRef(onEdit);
  useEffect(() => {
    onEditRef.current = onEdit;
  });

  useEffect(() => {
    // For whoever's waiting on this save (the guided setup's Skip for now).
    if (state.ok || state.error) ref.current?.dispatchEvent(new Event(state.ok ? "form-saved" : "form-failed", { bubbles: true }));
    if (state.error) onError?.(state.error);
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      // Something went public: show its link to share, not just a toast.
      if (state.share) shareDialog(state.share);
      else if (state.message) toast(state.message);
      onSuccess?.();
      if (resetOnSuccess && ref.current) onEditRef.current?.(ref.current);
      // A server redirect would jump to the top of the page; this stays put.
      if (state.goTo) router.push(state.goTo, { scroll: false });
    }
    // Only when a new answer comes back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    const form = ref.current;
    if (!shown.error || !form || quiet) return;
    const bad = new Set(Object.keys(shown.fieldErrors ?? {}));
    const field = [...form.elements].find(
      (el): el is HTMLElement => el instanceof HTMLElement && el.tabIndex >= 0 && bad.has(el.getAttribute("name") ?? ""),
    );
    const target = field ?? form.querySelector<HTMLElement>("[data-form-message]");
    target?.scrollIntoView({ block: field ? "center" : "nearest" });
    target?.focus({ preventScroll: true });
  }, [shown, quiet]);

  return (
    <form
      ref={ref}
      id={id}
      className={className}
      noValidate={noValidate}
      action={formAction}
      onInput={onEdit ? (e) => onEdit(e.currentTarget) : undefined}
      onChange={onEdit ? (e) => onEdit(e.currentTarget) : undefined}
      onSubmit={async (e) => {
        // Submit manually so React doesn't wipe the inputs when we show an error.
        e.preventDefault();
        // With the button pressed, so a form with two buttons (name="intent") knows which.
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        const problem = validate?.(data);
        setChecked(problem ?? null);
        const form = e.currentTarget;
        const failed = () => void form.dispatchEvent(new Event("form-failed", { bubbles: true }));
        if (problem) return failed();
        if (confirmMessage && !(await confirmDialog(confirmFromText(confirmMessage, { ...(confirmLabel ? { confirmLabel } : {}), ...(cancelLabel ? { cancelLabel } : {}) })))) return failed();
        startTransition(() => formAction(data));
      }}
    >
      <ActionPendingContext value={pending}>
        {/* Success shows as a toast (top right); errors stay with the form. */}
        {!quiet && <FormMessage error={shown.error} />}
        <FieldErrorsContext value={shown.fieldErrors ?? {}}>{children}</FieldErrorsContext>
      </ActionPendingContext>
    </form>
  );
}

"use client";

import { usePathname } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { feedbackWho, sendFeedback, type FeedbackState } from "@/app/feedback-actions";
import { ActionPendingContext } from "@/components/action-form";
import { BotCheck } from "@/components/bot-check";
import { SubmitButton } from "@/components/submit-button";
import { Button, Field, FormMessage, Input, Textarea } from "@/components/ui";

const KINDS = [
  { value: "bug", label: "Something's broken" },
  { value: "idea", label: "Idea" },
  { value: "question", label: "Question" },
] as const;

const OPEN_EVENT = "open-feedback";

/**
 * Feedback from every page. On wide screens (1280 px and up, where it sits in the margin): a small tab on the
 * right edge, clear of the save bars pinned to the bottom of setup pages. On phones and tablets, where a tab
 * would cover content (panel, 2026-11-10): a "Send feedback" line at the very end of the page, and a menu item
 * (FeedbackLink). Both open the same short form.
 */
export function FeedbackButton() {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  // A fresh form each time it opens after a send.
  const [round, setRound] = useState(0);
  const [who, setWho] = useState<{ email: string | null } | null>(null);
  const open = async () => {
    dialog.current?.showModal();
    setWho(await feedbackWho());
  };
  const close = () => dialog.current?.close();
  useEffect(() => {
    const onOpen = () => {
      dialog.current?.showModal();
      void feedbackWho().then(setWho);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="fixed right-0 bottom-1/3 z-30 hidden origin-bottom-right translate-x-0 -rotate-90 rounded-t-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground shadow-elevated hover:bg-brand-hover xl:block print:hidden"
        style={{ marginRight: "env(safe-area-inset-right, 0px)" }}
      >
        Feedback
      </button>
      {/* Phones: in the page, after everything else, above the event-day tab bar when it's showing. */}
      <p className="px-4 pt-2 pb-6 text-center text-sm text-muted xl:hidden print:hidden" style={{ marginBottom: "var(--day-bar, 0px)" }}>
        Spotted a problem or have an idea?{" "}
        <button type="button" onClick={open} className="inline-flex min-h-11 items-center font-medium text-brand underline underline-offset-4">
          Send feedback
        </button>
      </p>
      <dialog
        ref={dialog}
        aria-labelledby="feedback-title"
        onClick={(e) => e.target === e.currentTarget && close()}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border bg-surface p-0 text-foreground shadow-elevated backdrop:bg-[#071a31]/50"
      >
        <FeedbackForm key={round} page={pathname} signedInAs={who?.email ?? null} onClose={close} onAnother={() => setRound((n) => n + 1)} />
      </dialog>
    </>
  );
}

/** Opens the feedback form from anywhere, such as a menu. */
export function FeedbackLink({ className, children = "Send feedback" }: { className?: string; children?: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>
      {children}
    </button>
  );
}

function FeedbackForm({
  page,
  signedInAs,
  onClose,
  onAnother,
}: {
  page: string;
  signedInAs: string | null;
  onClose: () => void;
  onAnother: () => void;
}) {
  const [state, formAction, pending] = useActionState<FeedbackState, FormData>(sendFeedback, {});
  const [kind, setKind] = useState<string>("bug");
  const [shot, setShot] = useState<File | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);

  if (state.ok) {
    return (
      <div className="space-y-3 p-6 text-center" role="status">
        <p className="text-3xl font-bold text-success">✓</p>
        <h2 id="feedback-title" className="text-xl font-semibold">
          Thanks, we got it
        </h2>
        <p className="text-sm text-muted">
          {state.sentTo ? `We emailed you a copy at ${state.sentTo}. ` : ""}We read every message.
        </p>
        <div className="flex justify-center gap-3">
          <Button type="button" variant="secondary" onClick={onAnother}>
            Send more
          </Button>
          <Button
            type="button"
            onClick={() => {
              onClose();
              onAnother();
            }}
          >
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        data.set("page", page);
        data.delete("screenshotPicker");
        if (shot) data.set("screenshot", shot);
        startTransition(() => formAction(data));
      }}
    >
      <ActionPendingContext value={pending}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="feedback-title" className="text-xl font-semibold">
            Send us feedback
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-9 px-2 text-xl leading-none text-muted hover:text-foreground">
            ×
          </button>
        </div>
        {/* Bot trap: hidden from people, tempting to scripts. */}
        <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
          <label>
            Website <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <fieldset>
          <legend className="sr-only">What kind of feedback</legend>
          <div className="grid grid-cols-3 gap-2">
            {KINDS.map((k) => (
              <label
                key={k.value}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-2 py-2 text-center text-sm font-semibold ${
                  kind === k.value ? "border-2 border-brand bg-brand-soft" : "border-field-border hover:border-brand"
                }`}
              >
                <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} className="sr-only" />
                {k.label}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={kind === "bug" ? "What happened?" : kind === "idea" ? "What's your idea?" : "What's your question?"}>
          <Textarea name="message" required minLength={3} maxLength={5000} rows={4} />
        </Field>
        <Field label="Screenshot (optional)" hint={shotError ?? "A picture of the screen helps us fix it faster."}>
          <input
            name="screenshotPicker"
            type="file"
            accept="image/png,image/jpeg"
            onChange={async (e) => {
              setShotError(null);
              const picked = e.target.files?.[0];
              if (!picked) return setShot(null);
              try {
                setShot(await shrink(picked));
              } catch {
                setShot(null);
                setShotError("That picture didn't work. Try a PNG or JPEG.");
              }
            }}
            className="block w-full text-sm file:mr-3 file:min-h-10 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:text-sm file:font-medium"
          />
        </Field>
        {signedInAs ? (
          <p className="text-sm text-muted">We&apos;ll reply to {signedInAs}.</p>
        ) : (
          <Field label="Your email (optional)" hint="So we can reply. We'll also send you a copy.">
            <Input name="email" type="email" inputMode="email" autoComplete="email" />
          </Field>
        )}
        <BotCheck />
        <FormMessage error={state.error} />
        <SubmitButton className="w-full" pendingText="Sending…">
          Send feedback
        </SubmitButton>
        <p className="text-xs text-muted">We&apos;ll also send the page you&apos;re on and your browser type, to help us fix it.</p>
      </ActionPendingContext>
    </form>
  );
}

/** Screenshots go up as a JPEG no wider than 1600 pixels, so even a big phone screenshot sends quickly. */
async function shrink(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.82, 0.65, 0.5]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size < 900_000) return new File([blob], "screenshot.jpg", { type: "image/jpeg" });
  }
  throw new Error("Screenshot too large");
}

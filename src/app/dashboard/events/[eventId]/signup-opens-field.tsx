"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { saveVolunteerSignupOpensOn } from "@/app/dashboard/actions";
import { confirmDialog } from "@/components/confirm-dialog";
import { DateField } from "@/components/date-field";
import { setPending } from "@/components/pending-edits";
import { formatDate } from "@/lib/time";

const CONNECTION = "Check your connection, then try again.";

/**
 * "Sign-up opens": the optional day volunteer sign-up opens by itself (volunteer events and fairs; owner decision 2,
 * 2026-11-20). It saves as soon as a day is picked or cleared, says so on its own line, and refreshes the page so
 * every button and "When you publish" line beside it says the same day. A day the server refuses puts the saved
 * one back, with why. On a live event, Clear asks first: it keeps sign-up closed.
 */
export function SignupOpensField({
  eventId,
  initial,
  today,
  lastDay,
  rangeMessage,
  firstDay = null,
  live = false,
  blankLine = "Saved. Sign-up opens when you publish",
  hint,
  aside,
  className = "",
  id: anchor,
}: {
  /** An id to link to ("Change the day"). */
  id?: string;
  eventId: string;
  /** The saved day, or "" for none. */
  initial: string;
  /** Today in the event's time zone (YYYY-MM-DD). */
  today: string;
  /** The last day sign-up can open on (signupLastDay: the event's last day, or the day before a fair). */
  lastDay: string;
  /** The one message for a day out of range (signupRangeMessage). */
  rangeMessage: string;
  /** A volunteer event's first day: a day on or after it gets a heads-up (sign-up would open during the event). */
  firstDay?: string | null;
  /** The event is published: no "(optional)", and Clear asks first. */
  live?: boolean;
  /** Said after clearing the day on a draft. */
  blankLine?: string;
  hint: string;
  /** Beside the box ("Open sign-up now"). */
  aside?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const latest = useRef(initial);
  // A new saved day from the page (another tab, Open now) replaces what's shown.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setSaved(initial);
    setValue(initial);
  }
  useEffect(() => () => setPending(id, null), [id]);

  const save = async (v: string) => {
    latest.current = v;
    setValue(v);
    setError(null);
    if (v === saved) {
      setStatus("idle");
      return;
    }
    if (v && ((v < today && v !== saved) || v > lastDay)) {
      setValue(saved);
      setError(rangeMessage);
      return;
    }
    setStatus("saving");
    setPending(id, { kind: "saving" });
    let r: Awaited<ReturnType<typeof saveVolunteerSignupOpensOn>>;
    try {
      r = await saveVolunteerSignupOpensOn(eventId, v);
    } catch {
      r = { error: CONNECTION };
    }
    setPending(id, null);
    if (latest.current !== v) return;
    if (r.error) {
      setValue(saved);
      latest.current = saved;
      setStatus("idle");
      setError(r.error);
      // Someone else changed sign-up meanwhile: show what it is now.
      if (r.changed) startTransition(() => router.refresh());
      return;
    }
    setSaved(v);
    setStatus("saved");
    startTransition(() => router.refresh());
  };

  const clear = async () => {
    if (
      live &&
      !(await confirmDialog({
        title: "Clear the day?",
        message: "Sign-up stays closed until you open it. Nobody is emailed.",
        confirmLabel: "Clear the day",
        cancelLabel: "Keep the day",
      }))
    )
      return;
    void save("");
  };

  const duringEvent = Boolean(firstDay && value && value >= firstDay);

  return (
    <div id={anchor} className={`scroll-mt-6 ${className}`}>
      <label htmlFor={`${id}-box`} className="block text-sm font-semibold">
        Sign-up opens{!live && <span className="font-normal text-muted"> (optional)</span>}
      </label>
      <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
        {hint}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <DateField
          id={`${id}-box`}
          value={value}
          min={saved && saved < today ? saved : today}
          max={lastDay}
          onChange={(e) => void save(e.target.value)}
          aria-describedby={[`${id}-hint`, duringEvent && `${id}-during`, error && `${id}-error`].filter(Boolean).join(" ")}
          aria-invalid={error ? true : undefined}
          rangeMessage={rangeMessage}
          className="max-w-xs"
        />
        {value && (
          <button
            type="button"
            onClick={() => void clear()}
            className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-brand underline underline-offset-4"
          >
            Clear<span className="sr-only"> the day sign-up opens</span>
          </button>
        )}
        {aside}
      </div>
      {duringEvent && (
        <p id={`${id}-during`} className="mt-1 text-sm font-medium text-warning">
          <span aria-hidden>◆ </span>That&apos;s on or after the event&apos;s first day ({formatDate(firstDay!, { weekday: undefined, year: undefined })}), so
          volunteers can&apos;t sign up ahead of time
        </p>
      )}
      {/* On its own line, so it never pushes the box around. */}
      <p aria-live="polite" className="text-sm text-muted [&:not(:empty)]:mt-1">
        {status === "saving"
          ? "Saving…"
          : status === "saved"
            ? saved
              ? `Saved. Sign-up opens ${formatDate(saved, { year: undefined })}`
              : live
                ? "Saved. Sign-up stays closed until you open it"
                : blankLine
            : ""}
      </p>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm font-semibold text-danger">
          <span aria-hidden>▲ </span>Not saved. {error}
        </p>
      )}
    </div>
  );
}

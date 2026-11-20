"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { saveVolunteerSignupOpensOn } from "@/app/dashboard/actions";
import { DateField } from "@/components/date-field";
import { setPending } from "@/components/pending-edits";
import { formatDate } from "@/lib/time";

const CONNECTION = "Check your connection, then try again.";

/**
 * "Sign-up opens": the optional day volunteer sign-up opens by itself (volunteer events and fairs; owner decision 2,
 * 2026-11-20). It saves as soon as a day is picked or cleared, says so on its own line, and refreshes the page so
 * every button and "When you publish" line beside it says the same day. A day the server refuses puts the saved
 * one back, with why.
 */
export function SignupOpensField({
  eventId,
  initial,
  today,
  lastDay,
  hint,
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
  /** The event's last day: sign-up can't open after it. */
  lastDay: string;
  hint: string;
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
    if (v && v < today && v !== saved) {
      setValue(saved);
      setError("Pick today or a later date.");
      return;
    }
    if (v && v > lastDay) {
      setValue(saved);
      setError(`Pick a day on or before the event's last day (${formatDate(lastDay, { weekday: undefined, year: undefined })}).`);
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
      return;
    }
    setSaved(v);
    setStatus("saved");
    startTransition(() => router.refresh());
  };

  return (
    <div id={anchor} className={`scroll-mt-6 ${className}`}>
      <label htmlFor={`${id}-box`} className="block text-sm font-semibold">
        Sign-up opens <span className="font-normal text-muted">(optional)</span>
      </label>
      <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
        {hint}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <DateField
          id={`${id}-box`}
          value={value}
          min={saved && saved < today ? saved : today}
          max={lastDay}
          onChange={(e) => void save(e.target.value)}
          aria-describedby={[`${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ")}
          aria-invalid={error ? true : undefined}
          rangeMessage={`Pick a day from today to the event's last day (${formatDate(lastDay, { weekday: undefined, year: undefined })}).`}
          className="max-w-xs"
        />
        {value && (
          <button
            type="button"
            onClick={() => void save("")}
            className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-brand underline underline-offset-4"
          >
            Clear<span className="sr-only"> the day sign-up opens</span>
          </button>
        )}
      </div>
      {/* On its own line, so it never pushes the box around. */}
      <p aria-live="polite" className="text-sm text-muted [&:not(:empty)]:mt-1">
        {status === "saving" ? "Saving…" : status === "saved" ? (saved ? `Saved. Sign-up opens ${formatDate(saved, { year: undefined })}` : "Saved. No opening day") : ""}
      </p>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm font-semibold text-danger">
          <span aria-hidden>▲ </span>Not saved. {error}
        </p>
      )}
    </div>
  );
}

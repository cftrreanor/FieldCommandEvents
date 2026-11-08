"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { setPending, useLeaveGuard } from "@/components/pending-edits";

// Setup steps that save themselves (lessons L3 and L18): a moment after each change the form is
// sent, and one bar under it says Saving…, Saved, Not saved yet, or Not saved (Retry), with the
// next step on the right. Used by Event details and the meeting setup steps.

export type AutoStatus = { kind: "idle" | "waiting" | "saving" | "saved" } | { kind: "incomplete"; what: string } | { kind: "failed"; error: string; retry: boolean };

/** Saves the form a moment after each change, once every required box is filled in. */
export function useAutosaveForm(on: boolean, what = "A change") {
  const key = useId();
  const [status, setStatus] = useState<AutoStatus>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  useLeaveGuard(what);

  const submit = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const f = form.current;
    if (!f) return;
    // Any box the browser would refuse (text areas and menus too, or the form would quietly not send).
    const bad = [...f.elements].find(
      (el): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) && !el.checkValidity(),
    );
    if (bad) {
      // The box's name only (a Field's label also holds its hint).
      const label = bad.labels?.[0];
      const what = (label?.querySelector("[data-field-label]") ?? label)?.textContent?.replace("*", "").trim() || "A box";
      setStatus({ kind: "incomplete", what });
      setPending(key, { kind: "incomplete", flush: submit });
      return;
    }
    setStatus({ kind: "saving" });
    setPending(key, { kind: "saving" });
    f.requestSubmit();
  };

  useEffect(() => () => setPending(key, null), [key]);
  return {
    status,
    retry: submit,
    edited: (f: HTMLFormElement) => {
      if (!on) return;
      form.current = f;
      setStatus({ kind: "waiting" });
      setPending(key, { kind: "saving", flush: submit });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(submit, 1200);
    },
    saved: () => {
      // A newer change waiting to save keeps it "waiting".
      if (timer.current) return;
      setStatus({ kind: "saved" });
      setPending(key, null);
    },
    failed: (error: string) => {
      // Trying again only helps when the connection dropped; a refusal says why and waits for a change.
      const retry = error.startsWith("Something went wrong");
      setStatus({ kind: "failed", error: retry ? "Check your connection, then select Retry." : error, retry });
      setPending(key, { kind: "failed", flush: retry ? submit : undefined });
    },
  };
}

/** The pinned bar under a draft's Details: whether everything is saved. */
export function AutosaveBar({ status, retry, next }: { status: AutoStatus; retry: () => void; next?: { href: string; label: string } }) {
  return (
    <div className="sticky bottom-[var(--day-bar,0px)] z-10 -mx-4 -mb-4 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 rounded-b-lg border-t-2 border-border bg-surface px-4 py-3 shadow-[0_-6px_16px_rgb(0_0_0/0.10)] sm:-mx-6 sm:-mb-6 sm:px-6">
      <div className="min-w-0 flex-1 text-sm" role="status">
        {status.kind === "failed" ? (
          <p className="flex flex-wrap items-center gap-x-2 font-semibold text-danger">
            <span>
              <span aria-hidden>▲ </span>Not saved. {status.error}
            </span>
            {status.retry && (
              <button type="button" onClick={retry} className="inline-flex min-h-11 items-center rounded-md border-[1.5px] border-danger px-3">
                Retry
              </button>
            )}
          </p>
        ) : status.kind === "incomplete" ? (
          <p className="font-medium text-warning">
            <span aria-hidden>◆ </span>Not saved yet. Fill in “{status.what}”.
          </p>
        ) : status.kind === "saving" || status.kind === "waiting" ? (
          <p className="text-muted">Saving…</p>
        ) : status.kind === "saved" ? (
          <p className="font-medium">
            <span aria-hidden className="text-success">
              ✓{" "}
            </span>
            Saved
          </p>
        ) : (
          <p className="text-muted">Changes save automatically</p>
        )}
      </div>
      {next && (
        <Link href={next.href} className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand-hover">
          {next.label} →
        </Link>
      )}
    </div>
  );
}


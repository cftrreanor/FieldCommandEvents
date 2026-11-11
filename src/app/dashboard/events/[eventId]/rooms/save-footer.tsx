"use client";

import Link from "next/link";
import { Button } from "@/components/ui";

/** Where a self-saving editor stands. */
export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "incomplete"; what: string }
  | { kind: "failed"; error: string; retry: boolean };

const BAR = "sticky bottom-[var(--day-bar,0px)] z-10 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 bg-surface px-4 py-3 shadow-[0_-6px_16px_rgb(0_0_0/0.10)]";

/**
 * The pinned bar under the rooms and the group times (the event setup pattern: status on the left, one button on
 * the right). Before the schedule is posted, it saves as you go; once posted, it shows only when there's a change
 * to save, with the Save button (L18). `inCard` sits flush along the bottom of the card it's in.
 */
export function SaveFooter({
  status,
  retry,
  next,
  todo,
  notPosted = false,
  posted,
  inCard = true,
}: {
  status: SaveStatus;
  retry?: () => void;
  /** During setup: the next step ("Registration"). */
  next?: { href: string; label: string };
  /** Nothing saved yet, and what to do first ("Add your first room"). */
  todo?: string | null;
  /** Live, not posted: "Saves as you go · not posted yet". */
  notPosted?: boolean;
  /** Posted, with a change waiting: what it is, and the Save button. */
  posted?: { summary: string; onSave: () => void; onUndo: () => void; busy: boolean } | null;
  inCard?: boolean;
}) {
  const edge = inCard ? "-mx-4 -mb-4 mt-6 rounded-b-lg border-t-2 border-border sm:-mx-6 sm:-mb-6 sm:px-6" : "mt-6 rounded-lg border-2 border-border sm:px-6";
  if (posted) {
    return (
      <div className={`${BAR} ${edge}`}>
        <p className="min-w-0 flex-1 basis-full text-sm sm:basis-auto" role="status">
          <span className="font-medium text-warning">
            <span aria-hidden>◆ </span>Not saved yet:
          </span>{" "}
          {posted.summary}
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={posted.onUndo} disabled={posted.busy}>
            Undo my changes
          </Button>
          <Button type="button" onClick={posted.onSave} disabled={posted.busy} aria-busy={posted.busy}>
            {posted.busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    );
  }
  const tail = notPosted ? " · not posted yet" : "";
  return (
    <div className={`${BAR} ${edge}`}>
      <div className={`min-w-0 flex-1 text-sm ${todo || status.kind === "incomplete" || status.kind === "failed" ? "basis-full sm:basis-auto" : ""}`} role="status">
        {status.kind === "failed" ? (
          <p className="flex flex-wrap items-center gap-x-2 font-semibold text-danger">
            <span>
              <span aria-hidden>▲ </span>Not saved. {status.error}
            </span>
            {status.retry && retry && (
              <button type="button" onClick={retry} className="inline-flex min-h-11 items-center rounded-md border-[1.5px] border-danger px-3">
                Retry
              </button>
            )}
          </p>
        ) : status.kind === "incomplete" ? (
          <p className="font-medium text-warning">
            <span aria-hidden>◆ </span>Not saved yet. {status.what}
          </p>
        ) : status.kind === "saving" ? (
          <p className="text-muted">Saving…{tail}</p>
        ) : status.kind === "saved" ? (
          <p className="font-medium">
            <span aria-hidden className="text-success">
              ✓{" "}
            </span>
            Saved{tail}
          </p>
        ) : todo ? (
          <p className="font-medium text-warning">
            <span aria-hidden>◆ </span>Not saved yet. {todo}
          </p>
        ) : (
          <p className="text-muted">Saves as you go{tail}</p>
        )}
      </div>
      {next && (
        <Link
          href={next.href}
          className={`ml-auto inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold ${
            todo && status.kind !== "saved" ? "border border-field-border bg-surface hover:bg-background" : "bg-brand text-brand-foreground hover:bg-brand-hover"
          }`}
        >
          <span className="hidden sm:inline">Next up:&nbsp;</span>
          {next.label} →
        </Link>
      )}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { confirmDialog } from "@/components/confirm-dialog";
import { LineIcon } from "@/components/line-icon";
import { Button, Field, Input } from "@/components/ui";
import { joinNames } from "@/lib/visitor-words";
import { saveParentAdultName, setParentFrontOffice } from "./actions";

// Parent Registration's visitor tools (docs/design-decisions/2026-11-14-visitor-attendance.md): the downloads,
// the names to check, and the front-office mark. Each one changes data through a Host/Co-host-only database function.

const FILLED = "bg-brand text-brand-foreground hover:bg-brand-hover";
const OUTLINED = "border border-field-border bg-surface hover:border-brand hover:bg-background";

/**
 * A download built on the server (and noted in the download log). Once the file has started, the page refreshes so
 * "last downloaded" and the new-since counts are current.
 */
export function DownloadLink({ href, primary = false, children }: { href: string; primary?: boolean; children: ReactNode }) {
  const router = useRouter();
  return (
    <a
      href={href}
      download
      onClick={() => window.setTimeout(() => router.refresh(), 2500)}
      className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 text-center text-sm font-semibold transition active:translate-y-px ${primary ? FILLED : OUTLINED}`}
    >
      {children}
    </a>
  );
}

export type NameToCheck = { id: string; typed: string; first: string; last: string };

/** One name the app split: "Save name" (fixed) or "It's right" (confirmed as it is). */
function NameFix({ eventId, name }: { eventId: string; name: NameToCheck }) {
  const [first, setFirst] = useState(name.first);
  const [last, setLast] = useState(name.last);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const changed = first.trim() !== name.first || last.trim() !== name.last;
  const save = (f: string, l: string) =>
    start(async () => {
      setError(null);
      try {
        const r = await saveParentAdultName(eventId, name.id, f, l);
        if (r.error) setError(r.error);
      } catch {
        setError("That didn't save. Check your connection and try again.");
      }
    });
  return (
    <li className="rounded-md border border-border bg-surface p-3">
      <p className="text-sm">
        Typed as <span className="font-semibold">&ldquo;{name.typed}&rdquo;</span>
      </p>
      <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="First name">
          <Input value={first} onChange={(e) => setFirst(e.target.value)} aria-invalid={Boolean(error) || undefined} autoComplete="off" />
        </Field>
        <Field label="Last name">
          <Input value={last} onChange={(e) => setLast(e.target.value)} aria-invalid={Boolean(error) || undefined} autoComplete="off" />
        </Field>
        <div className="flex flex-wrap gap-2">
          {changed ? (
            <Button type="button" disabled={pending} onClick={() => save(first, last)}>
              {pending ? "Saving…" : "Save name"}
            </Button>
          ) : (
            <Button type="button" variant="secondary" disabled={pending} onClick={() => save(name.first, name.last)}>
              {pending ? "Saving…" : "It's right"}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

/** Names the app split from one box, where the split could be wrong. Above the downloads, so they're fixed first. */
export function NamesToCheck({ eventId, names }: { eventId: string; names: NameToCheck[] }) {
  const [all, setAll] = useState(false);
  if (!names.length) return null;
  // A long list shows three at a time, so the downloads stay in sight.
  const shown = all ? names : names.slice(0, 3);
  return (
    <div className="rounded-lg border border-warning/40 bg-warning-soft p-3">
      <p className="flex gap-2 text-sm font-semibold">
        <LineIcon name="warning" className="mt-0.5 size-5 shrink-0 text-warning" />
        {names.length === 1 ? "1 name to check before you download" : `${names.length} names to check before you download`}
      </p>
      <p className="mt-1 text-sm">
        {names.length === 1
          ? "We guessed where this first name ends. Check which part is the last name."
          : "We guessed where each of these first names ends. Check which part is the last name."}
      </p>
      <ul className="mt-3 space-y-2">
        {shown.map((n) => (
          <NameFix key={n.id} eventId={eventId} name={n} />
        ))}
      </ul>
      {shown.length < names.length && (
        <Button type="button" variant="ghost" className="mt-1 px-1 text-brand underline-offset-4 hover:underline" onClick={() => setAll(true)}>
          Show all {names.length} names to check
        </Button>
      )}
    </div>
  );
}

/**
 * The quiet per-adult control: "Stop Ben at the door" (after a confirm window) or "Let Ben check in". Hosts and
 * Co-hosts, until check-in locks after the event.
 */
export function FrontOfficeControl({
  eventId,
  adult,
  others,
}: {
  eventId: string;
  adult: { id: string; name: string; firstName: string; sentToOffice: boolean; checkedIn: boolean };
  /** The registration's other adults who can still check in. */
  others: string[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const first = adult.firstName || adult.name;

  async function change(on: boolean) {
    if (on) {
      const ok = await confirmDialog({
        title: `Send ${adult.name} to the front office?`,
        bullets: [
          `At Check-in, ${first}'s name shows "Please ask ${first} to go to the front office." instead of a Check in button`,
          ...(adult.checkedIn ? [`${first}'s check-in is cleared`] : []),
          `No reason is saved or shown, and ${first} isn't emailed`,
          ...(others.length ? [`${joinNames(others)} can still check in`] : []),
          `To undo it, choose "Let ${first} check in"`,
        ],
        cancelLabel: "Cancel",
        confirmLabel: `Stop ${first} at the door`,
        danger: true,
      });
      if (!ok) return;
    }
    start(async () => {
      setError(null);
      try {
        const r = await setParentFrontOffice(eventId, adult.id, on);
        if (r.error) setError(r.error);
      } catch {
        setError("That didn't go through. Check your connection and try again.");
      }
    });
  }

  return (
    <div className="-ml-1 flex flex-col items-start gap-1">
      {adult.sentToOffice ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => change(false)}
          className="inline-flex min-h-11 items-center px-1 text-sm font-medium text-brand underline-offset-4 hover:underline disabled:opacity-60"
        >
          {pending ? "Saving…" : `Let ${first} check in`}
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => change(true)}
          className="inline-flex min-h-11 items-center px-1 text-sm font-medium underline decoration-field-border underline-offset-4 hover:decoration-brand disabled:opacity-60"
        >
          {pending ? "Saving…" : `Stop ${first} at the door`}
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The badge on an adult sent to the front office: words and a strong ring, readable in both themes. */
export function FrontOfficeBadge() {
  return (
    <span className="inline-flex items-center rounded-full border-2 border-foreground bg-surface px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap">
      Sent to the front office
    </span>
  );
}

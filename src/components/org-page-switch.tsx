"use client";

import Link from "next/link";
import { useEffect, useId, useState, type ReactNode } from "react";
import { setEventOnOrgPage } from "@/app/dashboard/org-page-actions";
import { LineIcon } from "@/components/line-icon";
import { setPending } from "@/components/pending-edits";
import { cohostLine, needWords, reasonWords, shortDay, SWITCH_LABEL, WHO_CHOOSES, type EventOrgPageStatus } from "@/lib/org-page-words";

// One event's "Show on organization page" switch, everywhere it appears (the Organization page's list, Event
// settings, and the Publish step). It saves as you go; a failed save snaps the switch back to what's really saved
// and says so ("Still on your page. Couldn't turn this off"), and the save status sits on its own line (review
// fixes 6 and 7). A Co-host of one event sees it locked, with who can change it.

/** What a listed event shows: open spots, things still needed, the day sign-up opens, and whether a shift is under way. */
export type OrgPageNeed = { spots: number; items: number; opensOn: string | null; now?: boolean } | null;

type Save = { kind: "idle" } | { kind: "saving"; on: boolean } | { kind: "saved" } | { kind: "failed"; tried: boolean; error: string; retry: boolean };

/**
 * The switch itself: status in words beside it ("On" or "Off"). Locked, it plainly can't be used: a dashed, grey
 * track and knob, and the lock before the label (built-page review), on or off.
 */
export function SwitchButton({
  on,
  onToggle,
  locked = false,
  name,
}: {
  on: boolean;
  onToggle?: (next: boolean) => void;
  locked?: boolean;
  /** The event's name, for screen readers ("Show on organization page: Book Fair"). */
  name?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled={locked || undefined}
      onClick={() => !locked && onToggle?.(!on)}
      className={`inline-flex min-h-11 items-center gap-2.5 text-left ${locked ? "cursor-not-allowed" : ""}`}
    >
      <span
        aria-hidden
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 ${
          locked ? `border-dashed border-disabled ${on ? "bg-disabled/40" : "bg-transparent"}` : on ? "border-brand bg-brand" : "border-field-border bg-background"
        }`}
      >
        <span
          className={`absolute size-4 rounded-full ${on ? "left-[22px]" : "left-[3px]"} ${locked ? "bg-disabled" : on ? "bg-brand-foreground" : "bg-field-border"}`}
        />
      </span>
      <span className={`text-sm font-medium ${locked ? "text-muted" : ""}`}>
        {locked && <LineIcon name="lock" inline className="mr-1.5 size-4 text-muted" />}
        {SWITCH_LABEL}
        {name && <span className="sr-only">: {name}</span>}
        <span className="font-normal"> · {on ? "On" : "Off"}</span>
        {locked && <span className="sr-only"> (you can&apos;t change this)</span>}
      </span>
    </button>
  );
}

/** Where the event stands, in words: "✓ On your page · 2 spots open", or why it isn't listed. */
export function StatusLine({ status, need, you = true, draft = false }: { status: EventOrgPageStatus; need?: OrgPageNeed; you?: boolean; draft?: boolean }) {
  const why = reasonWords(status.reason, { needsReview: status.needs_review, you, draft });
  if (why) return <span className={status.on_org_page && status.reason !== "page_off" ? "" : "font-medium"}>{why}</span>;
  const detail = need?.opensOn
    ? `Sign-up opens ${shortDay(need.opensOn)}`
    : need && need.now && !need.spots && !need.items
      ? "Happening now"
      : need
        ? needWords(need.spots, need.items)
        : null;
  return (
    <span>
      <span aria-hidden className="text-success">
        ✓{" "}
      </span>
      {you ? "On your page" : "On the organization page"}
      {detail ? ` · ${detail}` : ""}
    </span>
  );
}

export function OrgPageEventControl({
  eventId,
  eventName,
  status: initial,
  need,
  head,
  layout = "row",
  orgPageHref,
  onStatus,
  describe,
  draft = false,
}: {
  eventId: string;
  eventName: string;
  /** The account's name (kept for callers; the lock note no longer needs it). */
  orgName?: string;
  status: EventOrgPageStatus;
  need?: OrgPageNeed;
  /** The row's name and kind (the Organization page's list): the switch sits beside it on wide screens. */
  head?: ReactNode;
  layout?: "row" | "stack";
  /** For people who can open the Organization page: a link to it beside a page-off line. */
  orgPageHref?: string;
  /** Tells the page around it when the saved state changes (the Publish step's lines). */
  onStatus?: (s: EventOrgPageStatus) => void;
  /** Words in place of the status line (the Publish step says what publishing will do). */
  describe?: (s: EventOrgPageStatus) => ReactNode;
  /** The event isn't published yet (nobody can open its link). */
  draft?: boolean;
}) {
  const key = useId();
  // The saved state: from the page, or the latest answer from a save (whichever is newer).
  const [status, setStatus] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setStatus(initial);
  }
  const [save, setSave] = useState<Save>({ kind: "idle" });
  useEffect(() => () => setPending(key, null), [key]);

  const toggle = async (next: boolean) => {
    setSave({ kind: "saving", on: next });
    setPending(key, { kind: "saving" });
    try {
      const res = await setEventOnOrgPage(eventId, next);
      if (res.status) {
        setStatus(res.status);
        onStatus?.(res.status);
      }
      if (res.error) {
        setSave({ kind: "failed", tried: next, error: res.error, retry: res.error.startsWith("Something went wrong") });
        setPending(key, { kind: "failed", flush: () => void toggle(next) });
      } else {
        setSave({ kind: "saved" });
        setPending(key, null);
      }
    } catch {
      // The connection dropped: nothing changed that we know of, so the switch shows what was saved.
      setSave({ kind: "failed", tried: next, error: "", retry: true });
      setPending(key, { kind: "failed", flush: () => void toggle(next) });
    }
  };

  const locked = !status.can_change;
  const line = describe ? describe(status) : <StatusLine status={status} need={need} you={!locked} draft={draft} />;
  const shownOn = save.kind === "saving" ? save.on : status.on_org_page;
  const pageOff = !status.page_on;

  const saveLine =
    save.kind === "saving" ? (
      <p role="status" className="text-sm text-muted">
        Saving…
      </p>
    ) : save.kind === "saved" ? (
      <p role="status" className="text-sm font-medium">
        <span aria-hidden className="text-success">
          ✓{" "}
        </span>
        Saved
      </p>
    ) : save.kind === "failed" ? (
      <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-danger">
        <span>
          <span aria-hidden>▲ </span>
          {status.on_org_page ? "Still on your page." : "Still off your page."}{" "}
          {save.tried ? "Couldn't turn this on." : "Couldn't turn this off."} {save.retry ? "Check your connection, then select Retry." : save.error}
        </span>
        {save.retry && (
          <button type="button" onClick={() => void toggle(save.tried)} className="inline-flex min-h-11 items-center rounded-md border-[1.5px] border-danger px-3">
            Retry<span className="sr-only"> {eventName}</span>
          </button>
        )}
      </div>
    ) : null;

  const lockNote = locked && status.account_host && (
    <div className="mt-3 rounded-md border border-border bg-background p-3 text-sm leading-6">
      <p>
        <LineIcon name="lock" inline />
        {cohostLine(eventName)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <a
          href={`mailto:${status.account_host.email}?subject=${encodeURIComponent(`${eventName} on our organization page`)}`}
          className="inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand"
        >
          Email {status.account_host.name?.split(/\s+/)[0] || "the Account Host"}
        </a>
        <span className="text-muted [overflow-wrap:anywhere]">{status.account_host.email}</span>
      </div>
    </div>
  );

  if (pageOff) {
    // Nothing to switch while the page is off: say so, with the way there for those who can open it.
    return (
      <div className={layout === "row" ? "px-4 py-3" : ""}>
        {head}
        <p className="text-sm leading-6">{line}</p>
        {orgPageHref && !locked && (
          // Its own line, so it never wraps mid-sentence (built-page review).
          <p>
            <Link href={orgPageHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4">
              Go to Organization page
            </Link>
          </p>
        )}
      </div>
    );
  }

  if (layout === "stack") {
    return (
      <div>
        {head}
        <p className="text-sm leading-6">{line}</p>
        <div className="mt-1">
          <SwitchButton on={shownOn} locked={locked} onToggle={(v) => void toggle(v)} name={eventName} />
        </div>
        {saveLine}
        {lockNote}
      </div>
    );
  }

  return (
    <div className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        {head}
        <p className="text-sm leading-6">{line}</p>
      </div>
      <div>
        <SwitchButton on={shownOn} locked={locked} onToggle={(v) => void toggle(v)} name={eventName} />
      </div>
      {/* Its own line, the full width of the row, so it never squeezes the event's name. */}
      {saveLine && <div className="sm:col-span-2">{saveLine}</div>}
      {status.needs_review && !locked && save.kind === "idle" && (
        <div className="sm:col-span-2">
          <button
            type="button"
            onClick={() => void toggle(false)}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4"
          >
            Leave it off<span className="sr-only"> {eventName}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** The Publish step's "When you publish" line about the organization page, with the event's switch. */
export function PublishOrgLine({ orgId, ...props }: { eventId: string; eventName: string; orgName: string; orgId: string; status: EventOrgPageStatus }) {
  return (
    <OrgPageEventControl
      {...props}
      layout="stack"
      orgPageHref={props.status.can_change ? `/dashboard/organization?org=${orgId}` : undefined}
      describe={(s) => {
        const page = s.can_change ? "your organization page" : "the organization page";
        if (!s.page_on) return `It isn't listed anywhere: ${page} is off.`;
        if (s.on_org_page) return `It's shown on ${page}, with its open spots.`;
        if (s.needs_review && !s.can_change) return `It won't be on the organization page until ${WHO_CHOOSES} turns it on. Anyone with the link can still open it.`;
        return `It won't be on ${page}. Anyone with the link can still open it.`;
      }}
    />
  );
}

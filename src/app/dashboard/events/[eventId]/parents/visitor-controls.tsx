"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition, type ReactNode } from "react";
import { confirmDialog } from "@/components/confirm-dialog";
import { LineIcon } from "@/components/line-icon";
import { Button, Field, Input } from "@/components/ui";
import { likelySplits, type NameSplit } from "@/lib/name-split";
import { joinNames, letCheckIn, plural, SEND_TO_OFFICE, SENT_TO_OFFICE } from "@/lib/visitor-words";
import { confirmParentReportCopy, saveParentAdultName, setParentFrontOffice } from "./actions";

// Parent Registration's visitor tools (docs/design-decisions/2026-11-14-visitor-attendance.md): the downloads,
// the names to check, the front-office mark, and "Our school has a copy". Each one changes data through a
// Host/Co-host-only database function.

const FILLED = "bg-brand text-brand-foreground hover:bg-brand-hover";
const OUTLINED = "border border-field-border bg-surface hover:border-brand hover:bg-background";

/** Names to check with a choice made or an edit typed, but not saved yet (by adult id). Every visitor list download asks about them. */
const unsaved = new Set<string>();
function setUnsaved(id: string, on: boolean) {
  if (on) unsaved.add(id);
  else unsaved.delete(id);
}

/**
 * A download built on the server (and noted in the download log). Once the file has started, the page refreshes so
 * "last downloaded" and the new-since counts are current. A visitor list download (`namesToCheck` given) first asks
 * when names still need checking or a name's edit isn't saved, since the file goes to the school's visitor system.
 */
export function DownloadLink({
  href,
  primary = false,
  namesToCheck,
  children,
}: {
  href: string;
  primary?: boolean;
  /** Visitor list downloads: how many names still need checking. */
  namesToCheck?: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const refreshSoon = () => window.setTimeout(() => router.refresh(), 2500);
  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (namesToCheck === undefined || (!namesToCheck && !unsaved.size)) {
      refreshSoon();
      return;
    }
    e.preventDefault();
    const unchecked = Math.max(namesToCheck - unsaved.size, 0);
    const ok = await confirmDialog({
      title: "Download before the names are checked?",
      message: "The school's visitor system may check these adults under the wrong last name.",
      bullets: [
        ...(unchecked ? [`${plural(unchecked, "name isn't", "names aren't")} checked yet. The file marks ${unchecked === 1 ? "it" : "them"} "Check first and last name"`] : []),
        ...(unsaved.size ? [`${plural(unsaved.size, "name you changed isn't", "names you changed aren't")} saved yet, so the file has the old ${unsaved.size === 1 ? "split" : "splits"}`] : []),
      ],
      cancelLabel: "Check names first",
      confirmLabel: "Download anyway",
    });
    if (!ok) {
      document.getElementById("names-to-check")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    window.location.assign(href);
    refreshSoon();
  }
  return (
    <a
      href={href}
      download
      onClick={onClick}
      className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 text-center text-sm font-semibold transition active:translate-y-px ${primary ? FILLED : OUTLINED}`}
    >
      {children}
    </a>
  );
}

export type NameToCheck = { id: string; typed: string; first: string; last: string };

const same = (a: NameSplit, b: NameSplit) => a.first === b.first && a.last === b.last;

/**
 * One name the app split: the likely splits to choose from (the app's guess first) or Edit, then "Save name". Nothing
 * is chosen to start with, so a wrong guess is never one tap away.
 */
function NameFix({ eventId, name }: { eventId: string; name: NameToCheck }) {
  const group = useId();
  const choices = likelySplits(name.typed);
  // An index into choices, "edit", or nothing chosen yet.
  const [choice, setChoice] = useState<number | "edit" | null>(choices.length ? null : "edit");
  const [first, setFirst] = useState(name.first);
  const [last, setLast] = useState(name.last);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const picked: NameSplit | null = choice === "edit" ? { first: first.trim(), last: last.trim() } : choice === null ? null : choices[choice];
  const dirty = typeof choice === "number" || (choice === "edit" && (first !== name.first || last !== name.last));

  useEffect(() => {
    setUnsaved(name.id, dirty);
    return () => setUnsaved(name.id, false);
  }, [name.id, dirty]);

  const save = () => {
    if (!picked) {
      setError("Choose which part is the last name, or choose Edit.");
      return;
    }
    if (!picked.first || !picked.last) {
      setError("Fill in both the first and last name.");
      return;
    }
    start(async () => {
      setError(null);
      try {
        const r = await saveParentAdultName(eventId, name.id, picked.first, picked.last);
        if (r.error) setError(r.error);
      } catch {
        setError("That didn't save. Check your connection and try again.");
      }
    });
  };

  const radio = "mt-1 size-4 shrink-0 accent-brand";
  const option = "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm";
  return (
    <li className="rounded-md border border-border bg-surface p-3">
      <fieldset>
        <legend className="text-sm">
          Typed as <span className="font-semibold">&ldquo;{name.typed}&rdquo;</span>
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {choices.map((c, i) => (
            <label key={i} className={`${option} ${choice === i ? "border-brand bg-brand-soft" : "border-field-border"}`}>
              <input type="radio" name={group} className={radio} checked={choice === i} onChange={() => setChoice(i)} />
              <span>
                First name <span className="font-semibold">{c.first}</span>
                <span className="text-muted"> · </span>
                Last name <span className="font-semibold">{c.last}</span>
                {same(c, { first: name.first, last: name.last }) && i === 0 && <span className="block text-xs text-muted">Our guess</span>}
              </span>
            </label>
          ))}
          <label className={`${option} ${choice === "edit" ? "border-brand bg-brand-soft" : "border-field-border"}`}>
            <input type="radio" name={group} className={radio} checked={choice === "edit"} onChange={() => setChoice("edit")} />
            <span>Edit: type the first and last name</span>
          </label>
        </div>
      </fieldset>
      {choice === "edit" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="First name">
            <Input value={first} onChange={(e) => setFirst(e.target.value)} aria-invalid={Boolean(error) || undefined} autoComplete="off" />
          </Field>
          <Field label="Last name">
            <Input value={last} onChange={(e) => setLast(e.target.value)} aria-invalid={Boolean(error) || undefined} autoComplete="off" />
          </Field>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save name"}
        </Button>
        {dirty && !pending && <span className="text-sm text-muted">Not saved yet</span>}
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
    <div id="names-to-check" className="scroll-mt-20 rounded-lg border border-warning/40 bg-warning-soft p-3">
      <p className="flex gap-2 text-sm font-semibold">
        <LineIcon name="warning" className="mt-0.5 size-5 shrink-0 text-warning" />
        {names.length === 1 ? "1 name to check before you download" : `${names.length} names to check before you download`}
      </p>
      <p className="mt-1 text-sm">
        {names.length === 1
          ? "We guessed where this first name ends. Choose which part is the last name, then Save name."
          : "We guessed where each of these first names ends. Choose which part is the last name, then Save name."}
      </p>
      <ul className="mt-3 space-y-2">
        {shown.map((n) => (
          <NameFix key={n.id} eventId={eventId} name={n} />
        ))}
      </ul>
      {shown.length < names.length && (
        <button
          type="button"
          className="mt-1 inline-flex min-h-11 items-center px-1 text-sm font-medium text-brand underline underline-offset-4"
          onClick={() => setAll(true)}
        >
          Show all {names.length} names to check
        </button>
      )}
    </div>
  );
}

/**
 * The quiet per-adult control: "Send to the front office" (after a confirm window) or "Let Ben check in". Hosts and
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
          `At Check-in, ${first}'s name shows "Send to the front office. Please ask ${first} to go there." in place of a Check in button`,
          ...(adult.checkedIn ? [`${first}'s check-in is cleared`] : []),
          `No reason is saved or shown, and ${first} isn't emailed`,
          ...(others.length ? [`${joinNames(others)} can still check in`] : []),
          `To undo it, choose "${letCheckIn(first)}"`,
        ],
        cancelLabel: "Cancel",
        confirmLabel: SEND_TO_OFFICE,
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

  const link = "inline-flex min-h-11 min-w-11 items-center px-1 py-2 text-sm font-medium underline-offset-4 disabled:opacity-60";
  return (
    <div className="-ml-1 flex flex-col items-start">
      {adult.sentToOffice ? (
        <button type="button" disabled={pending} onClick={() => change(false)} className={`${link} text-brand hover:underline`}>
          {pending ? "Saving…" : letCheckIn(first)}
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => change(true)}
          aria-label={`Send ${adult.name} to the front office`}
          className={`${link} underline decoration-field-border hover:decoration-brand`}
        >
          {pending ? "Saving…" : SEND_TO_OFFICE}
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
      {SENT_TO_OFFICE}
    </span>
  );
}

/**
 * "Our school has a copy": after the event, a Host or Co-host confirms the school saved the report. The save warning
 * stays until then (for everyone on the event), and the week-before-deletion email is gentler after.
 */
export function CopyConfirmButton({ eventId, deleteOn }: { eventId: string; deleteOn: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    const ok = await confirmDialog({
      title: "Does your school have a copy of the report?",
      bullets: [
        "A printed copy, a saved PDF, or the downloaded spreadsheet, kept where your school keeps its records",
        "The reminder to save it goes away for everyone on this event, and your name and today's date show in its place",
        `The report is still deleted on ${deleteOn}`,
      ],
      cancelLabel: "Cancel",
      confirmLabel: "Our school has a copy",
    });
    if (!ok) return;
    start(async () => {
      setError(null);
      try {
        const r = await confirmParentReportCopy(eventId);
        if (r.error) setError(r.error);
      } catch {
        setError("That didn't save. Check your connection and try again.");
      }
    });
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="secondary" disabled={pending} onClick={confirm}>
        {pending ? "Saving…" : "Our school has a copy"}
      </Button>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

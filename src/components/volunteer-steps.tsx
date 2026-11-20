"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { markCopyStep } from "@/app/dashboard/duplicate-actions";
import { usePendingCounts } from "@/components/pending-edits";
import { SETUP_STEPS as STEPS, type SetupStepFacts, type StepsKind } from "@/lib/setup-steps";

/**
 * An event before it's published: its steps along the top (Details, its middle step, a band contest's
 * optional Volunteers, the optional Sponsors on accounts with the add-on, and the event page to publish; up to 6), each a link, with the one you're on marked
 * "Now". Status is said in words at every width, not by color alone. Optional steps never block.
 */
export function SetupSteps({
  eventId,
  kind,
  facts,
  preview = false,
}: {
  eventId: string;
  kind: StepsKind;
  facts: SetupStepFacts;
  /** The new-event form, before the event exists: step 1 is "Now", the rest "Not yet", and none are links yet. */
  preview?: boolean;
}) {
  const pathname = usePathname();
  // Something on this page isn't saved: the step it's on doesn't say ready.
  const pending = usePendingCounts();
  const unsaved = pending.failed + pending.incomplete + pending.unadded > 0;
  const base = `/dashboard/events/${eventId}`;
  // Sponsors is a step only on accounts with the add-on (it never blocks).
  const steps = STEPS[kind].filter((s) => !facts.skip?.includes(s.key) && (s.key !== "sponsors" || facts.sponsorsOn));
  // Event settings (Details with ?section=) is a settings page, not the Details step: it has its own list.
  const query = useSearchParams();
  // The same rule as the page: any section asked for, by ?section= or an old ?step= link.
  const settings = query.has("section") || query.has("step");
  const here = preview ? 0 : settings ? -1 : steps.findIndex((s) => pathname === `${base}${s.path}`);
  // A duplicated draft's copied steps: "Copied: check it" until opened; opening one checks it off ("Opened").
  const [openedNow, setOpenedNow] = useState<string[]>([]);
  const hereKey = here >= 0 ? steps[here].key : null;
  const hereCopied = hereKey && !preview ? facts.copied?.[hereKey] : undefined;
  useEffect(() => {
    // Opening a copied step marks it opened (once); the bar says so straight away.
    if (hereKey && hereCopied === "copied") {
      markCopyStep(eventId, hereKey)
        .then((r) => r.ok && setOpenedNow((o) => (o.includes(hereKey) ? o : [...o, hereKey])))
        .catch(() => {});
    }
  }, [eventId, hereKey, hereCopied]);
  if (here < 0) return null;
  const copiedState = (key: string) => {
    const c = preview ? undefined : facts.copied?.[key];
    return c === "copied" && openedNow.includes(key) ? "opened" : c;
  };
  const last = steps.length - 1;
  // A copied step that still holds "[new date]": "Add the new date" until every one is filled in (publishing waits).
  const newDates = (key: string) => (preview ? 0 : (facts.newDates?.[key] ?? 0));
  const done = steps.map((s, i) =>
    preview
      ? false
      : copiedState(s.key) === "copied" || newDates(s.key) > 0
        ? false
        : i === 0
          ? true
          : i === last
            ? false
            : (facts.done?.[s.key] ?? (s.key === "volunteers" ? Boolean(facts.volunteersDone) : facts.middleDone)),
  );
  // Still "Copied: check it" (not opened yet): the same rule as the Ready card and the publish window.
  // (Optional steps that hold "[new date]" need work too: publishing waits for them.)
  const copiedSteps = steps.filter((s) => copiedState(s.key) === "copied" && newDates(s.key) === 0);
  // The strip under each step: copied steps have their own look (outlined in the brand color, tinted).
  const strip = (s: (typeof steps)[number], i: number) =>
    i === here
      ? "h-2 bg-brand"
      : done[i]
        ? "h-1.5 bg-success"
        : needsWork.includes(s)
          ? "h-1.5 bg-warning"
          : copiedState(s.key) === "copied"
            ? "h-1.5 border-[1.5px] border-brand bg-brand-soft"
            : s.optional
              ? "h-1.5 border-[1.5px] border-dashed border-muted bg-surface"
              : "h-1.5 border border-field-border bg-surface";
  // What a required step still needs ("Add your hours"), from its own note or the middle step's.
  const stepNote = (key: string, i: number) =>
    newDates(key) > 0 ? "Add the new date" : facts.notes && key in facts.notes ? (facts.notes[key] ?? null) : i === 1 ? facts.middleNote : null;
  const doneCount = done.filter(Boolean).length;
  // Required steps that still need something, named: shown in words on phones too, not only on wider screens.
  const needsWork = steps.filter(
    (s, i) => !preview && ((!s.optional && i > 0 && i < last) || newDates(s.key) > 0) && !done[i] && Boolean(stepNote(s.key, i)),
  );
  const stepList = (className: string) => (
          <ol className={className}>
            {steps.map((s, i) => {
              const now = i === here;
              // A required middle step that still needs something: amber, saying what. An optional one stays neutral.
              const needs = needsWork.includes(s);
              const copied = copiedState(s.key);
              // One wording for the copied state everywhere: "Copied: check it" (after "Optional · " too).
              const copiedNote = copied === "copied" ? "Copied: check it" : null;
              const optionalNote = s.optional && !done[i] ? (copiedNote ? `Optional · ${copiedNote}` : ((s.key === "volunteers" ? facts.volunteersNote : facts.notes?.[s.key]) ?? "Optional")) : null;
              // The step you're on says "Now", "Now · ready" once it has everything it needs, or "Now · not saved".
              const note =
                done[i] && !now
                  ? copied === "opened"
                    ? "Opened"
                    : "Done"
                  : now && unsaved
                    ? "Now · not saved"
                    : needs
                      ? // "Now" first under the step you're on, then what it needs.
                        now
                        ? `Now · ${lowerFirst(stepNote(s.key, i) ?? "")}`
                        : stepNote(s.key, i)
                      : now
                        ? copied === "copied"
                          ? `Now · ${s.optional ? "optional · " : ""}Copied: check it`
                          : done[i] && i < last
                            ? "Now · all set"
                            : optionalNote
                              ? `Now · ${optionalNote.charAt(0).toLowerCase()}${optionalNote.slice(1)}`
                              : "Now"
                        : (optionalNote ?? copiedNote ?? "Not yet");
              return (
                <li key={s.key} className="min-w-0">
                  <span aria-hidden className={`block rounded-full ${strip(s, i)}`} />
                  {now || preview ? (
                    <span aria-current={now ? "step" : undefined} className={`mt-1 flex min-h-11 items-center text-sm ${now ? "font-semibold" : "font-medium text-muted"}`}>
                      {s.label}
                    </span>
                  ) : (
                    <Link href={`${base}${s.path}`} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4 hover:text-brand">
                      {s.label}
                    </Link>
                  )}
                  <span className={`block text-xs leading-5 ${done[i] && !now ? "text-success" : needs ? "font-medium text-warning" : copied === "copied" ? "font-medium text-foreground" : "text-muted"}`}>
                    {done[i] && !now && <span aria-hidden>✓ </span>}
                    {needs && <span aria-hidden>◆ </span>}
                    {note}
                  </span>
                </li>
              );
            })}
          </ol>
  );
  return (
    <nav aria-label="Event setup" className="mb-6 print:hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <p className="text-sm">
          <span className="font-semibold">
            Step {here + 1} of {steps.length}:
          </span>{" "}
          {steps[here].label}
          {steps[here].optional && <span className="text-muted"> (optional)</span>}
          {here === 1 && facts.count && <span className="text-muted"> · {facts.count}</span>}
          <span className="sr-only">
            . {doneCount} of {steps.length} done.
          </span>
        </p>
        {/* Team, emails, and maps are in Event settings: in reach from every step (the Publish step has its own button). */}
        {!preview && here < last && (
          <Link href={`${base}/edit?section=details`} className="inline-flex min-h-11 items-center text-sm font-medium text-brand underline underline-offset-4">
            Event settings
          </Link>
        )}
      </div>
      {/* Phones: one row of strips, then every step in a list you can open (the two-column grid read wrongly). */}
      <ol aria-hidden className="mt-2 flex gap-1 sm:hidden">
        {steps.map((s, i) => (
          <li key={s.key} className={`flex-1 rounded-full ${strip(s, i)}`} />
        ))}
      </ol>
      {/* Phones: the step you're on first ("Now · add a job"), then any other step that needs something. */}
      {needsWork.includes(steps[here]) && (
        <p className="mt-2 text-sm font-medium text-warning sm:hidden">
          <span aria-hidden>◆ </span>Now · {lowerFirst(stepNote(steps[here].key, here) ?? "")}
        </p>
      )}
      {needsWork.some((s) => s !== steps[here]) && (
        <p className="mt-1 text-sm font-medium text-warning sm:hidden">
          <span aria-hidden>◆ </span>
          {needsWork.includes(steps[here]) ? "Also needs work" : needsWork.length === 1 ? "1 step needs work" : `${needsWork.length} steps need work`}:{" "}
          {needsWork
            .filter((s) => s !== steps[here])
            .map((s) => s.label)
            .join(", ")}
        </p>
      )}
      {copiedSteps.length > 0 && (
        // Phones name the copied steps in words too.
        <p className="mt-1 text-sm font-medium sm:hidden">
          Copied: check it · {copiedSteps.map((s) => s.label).join(", ")}
        </p>
      )}
      <details className="group sm:hidden">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-brand">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
            ›
          </span>
          See all steps
        </summary>
        {stepList("grid grid-cols-1 gap-y-1")}
      </details>
      {stepList(`mt-2 hidden gap-x-3 gap-y-1 sm:grid ${steps.length >= 6 ? "sm:grid-cols-6" : steps.length === 5 ? "sm:grid-cols-5" : steps.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`)}
    </nav>
  );
}

/** "Add a job" → "add a job"; a note that starts with a name ("BBQ crew needs a shift") keeps its capitals. */
function lowerFirst(text: string) {
  return /^(Add|Choose|Fix|Pick|Put|Tick)\b/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

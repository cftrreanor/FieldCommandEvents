"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { usePendingCounts } from "@/components/pending-edits";
import { SETUP_STEPS as STEPS, type SetupStepFacts, type StepsKind } from "@/lib/setup-steps";

/**
 * An event before it's published: its steps along the top (Details, its middle step, a band contest's
 * optional Volunteers, and the event page to publish), each a link, with the one you're on marked
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
  const steps = STEPS[kind];
  // Event settings (Details with ?section=) is a settings page, not the Details step: it has its own list.
  const settings = useSearchParams().has("section");
  const here = preview ? 0 : settings ? -1 : steps.findIndex((s) => pathname === `${base}${s.path}`);
  if (here < 0) return null;
  const last = steps.length - 1;
  const done = steps.map((s, i) =>
    preview ? false : i === 0 ? true : i === last ? false : (facts.done?.[s.key] ?? (s.key === "volunteers" ? Boolean(facts.volunteersDone) : facts.middleDone)),
  );
  // What a required step still needs ("Add your hours"), from its own note or the middle step's.
  const stepNote = (key: string, i: number) => (facts.notes && key in facts.notes ? (facts.notes[key] ?? null) : i === 1 ? facts.middleNote : null);
  const doneCount = done.filter(Boolean).length;
  // Required steps that still need something, named: shown in words on phones too, not only on wider screens.
  const needsWork = steps.filter((s, i) => !preview && !s.optional && i > 0 && i < last && !done[i] && Boolean(stepNote(s.key, i)));
  const stepList = (className: string) => (
          <ol className={className}>
            {steps.map((s, i) => {
              const now = i === here;
              // A required middle step that still needs something: amber, saying what. An optional one stays neutral.
              const needs = needsWork.includes(s);
              const optionalNote = s.optional && !done[i] ? ((s.key === "volunteers" ? facts.volunteersNote : facts.notes?.[s.key]) ?? "Optional") : null;
              // The step you're on says "Now", "Now · ready" once it has everything it needs, or "Now · not saved".
              const note =
                done[i] && !now
                  ? "Done"
                  : now && unsaved
                    ? "Now · not saved"
                    : needs
                      ? // "Now" first under the step you're on, then what it needs.
                        now
                        ? `Now · ${lowerFirst(stepNote(s.key, i) ?? "")}`
                        : stepNote(s.key, i)
                      : now
                        ? done[i] && i < last
                          ? "Now · ready"
                          : optionalNote
                            ? `Now · ${optionalNote.charAt(0).toLowerCase()}${optionalNote.slice(1)}`
                            : "Now"
                        : (optionalNote ?? "Not yet");
              return (
                <li key={s.key} className="min-w-0">
                  <span
                    aria-hidden
                    className={`block rounded-full ${now ? "h-2 bg-brand" : done[i] ? "h-1.5 bg-success" : needs ? "h-1.5 bg-warning" : s.optional ? "h-1.5 border-[1.5px] border-dashed border-muted bg-surface" : "h-1.5 border border-field-border bg-surface"}`}
                  />
                  {now || preview ? (
                    <span aria-current={now ? "step" : undefined} className={`mt-1 flex min-h-11 items-center text-sm ${now ? "font-semibold" : "font-medium text-muted"}`}>
                      {s.label}
                    </span>
                  ) : (
                    <Link href={`${base}${s.path}`} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4 hover:text-brand">
                      {s.label}
                    </Link>
                  )}
                  <span className={`block text-xs leading-5 ${done[i] && !now ? "text-success" : needs ? "font-medium text-warning" : "text-muted"}`}>
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
          <li
            key={s.key}
            className={`flex-1 rounded-full ${i === here ? "h-2 bg-brand" : done[i] ? "h-1.5 bg-success" : needsWork.includes(s) ? "h-1.5 bg-warning" : s.optional ? "h-1.5 border-[1.5px] border-dashed border-muted bg-surface" : "h-1.5 border border-field-border bg-surface"}`}
          />
        ))}
      </ol>
      {needsWork.length > 0 && (
        <p className="mt-2 text-sm font-medium text-warning sm:hidden">
          <span aria-hidden>◆ </span>
          {needsWork.length === 1 ? "1 step needs work" : `${needsWork.length} steps need work`}: {needsWork.map((s) => s.label).join(", ")}
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
      {stepList(`mt-2 hidden gap-x-3 gap-y-1 sm:grid ${steps.length === 5 ? "sm:grid-cols-5" : steps.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`)}
    </nav>
  );
}

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

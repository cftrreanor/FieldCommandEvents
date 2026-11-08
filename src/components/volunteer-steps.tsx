"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePendingCounts } from "@/components/pending-edits";
import { SETUP_STEPS as STEPS, type SetupStepFacts, type StepsKind } from "@/lib/setup-steps";

/**
 * An event before it's published: its steps along the top (Details, its middle step, a band contest's
 * optional Volunteers, and the event page to publish), each a link, with the one you're on marked
 * "Now". Status is said in words at every width, not by color alone. Optional steps never block.
 */
export function SetupSteps({ eventId, kind, facts }: { eventId: string; kind: StepsKind; facts: SetupStepFacts }) {
  const pathname = usePathname();
  // Something on this page isn't saved: the step it's on doesn't say ready.
  const pending = usePendingCounts();
  const unsaved = pending.failed + pending.incomplete + pending.unadded > 0;
  const base = `/dashboard/events/${eventId}`;
  const steps = STEPS[kind];
  const here = steps.findIndex((s) => pathname === `${base}${s.path}`);
  if (here < 0) return null;
  const last = steps.length - 1;
  const done = steps.map((s, i) =>
    i === 0 ? true : i === last ? false : (facts.done?.[s.key] ?? (s.key === "volunteers" ? Boolean(facts.volunteersDone) : facts.middleDone)),
  );
  // What a required step still needs ("Add your hours"), from its own note or the middle step's.
  const stepNote = (key: string, i: number) => (facts.notes && key in facts.notes ? (facts.notes[key] ?? null) : i === 1 ? facts.middleNote : null);
  const doneCount = done.filter(Boolean).length;
  return (
    <nav aria-label="Event setup" className="mb-6 print:hidden">
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
      <ol className={`mt-2 grid gap-x-3 gap-y-1 ${steps.length === 5 ? "grid-cols-2 sm:grid-cols-5" : steps.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
        {steps.map((s, i) => {
          const now = i === here;
          // A required middle step that still needs something: amber, saying what. An optional one stays neutral.
          const needs = !s.optional && i > 0 && i < last && !done[i] && Boolean(stepNote(s.key, i));
          const optionalNote = s.optional && !done[i] ? ((s.key === "volunteers" ? facts.volunteersNote : facts.notes?.[s.key]) ?? "Optional") : null;
          // The step you're on says "Now", "Now · ready" once it has everything it needs, or "Now · not saved".
          const note =
            done[i] && !now
              ? "Done"
              : now && unsaved
                ? "Now · not saved"
                : needs
                  ? stepNote(s.key, i)
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
              {now ? (
                <span aria-current="step" className="mt-1 flex min-h-11 items-center text-sm font-semibold">
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
    </nav>
  );
}

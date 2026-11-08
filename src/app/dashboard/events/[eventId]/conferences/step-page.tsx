import type { ReactNode } from "react";
import { SavedBy } from "@/components/saved-by";

/**
 * One setup step of a meeting or conference, in the same layout as the volunteer and band steps
 * (lesson L15): the step bar above (from the event's layout), a back link, the step's title, a
 * line about it, then its card.
 */
export function StepPage({ eventId, title, intro, children }: { eventId: string; eventName?: string; title: string; intro: ReactNode; children: ReactNode }) {
  return (
    // data-required-marks: a small asterisk on each box that has to be filled in (globals.css).
    // As wide as the step bar above it, like the volunteer and band steps.
    <div className="mx-auto max-w-5xl" data-required-marks>
      {/* No "Back to" link while setting up: it would jump ahead to Publish. The step bar is the way around. */}
      <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{title}</h1>
      <SavedBy eventId={eventId} area="conference" className="mt-2" />
      <p className="mt-2 max-w-3xl text-muted">{intro}</p>
      {/* The cards span the step bar's width, as on the Details step, so the page doesn't sit off to the left (QA issue 351). */}
      <div className="mt-6 space-y-6">{children}</div>
    </div>
  );
}

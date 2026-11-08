import Link from "next/link";
import type { ReactNode } from "react";
import { SavedBy } from "@/components/saved-by";

/**
 * One setup step of a meeting or conference, in the same layout as the volunteer and band steps
 * (lesson L15): the step bar above (from the event's layout), a back link, the step's title, a
 * line about it, then its card.
 */
export function StepPage({ eventId, eventName, title, intro, children }: { eventId: string; eventName: string; title: string; intro: ReactNode; children: ReactNode }) {
  return (
    // data-required-marks: a small asterisk on each box that has to be filled in (globals.css).
    // As wide as the step bar above it, like the volunteer and band steps.
    <div className="mx-auto max-w-5xl" data-required-marks>
      <Link href={`/dashboard/events/${eventId}`} className="text-sm text-muted hover:text-foreground">
        ← Back to {eventName}
      </Link>
      <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">{title}</h1>
      <SavedBy eventId={eventId} area="conference" className="mt-2" />
      <p className="mt-2 max-w-3xl text-muted">{intro}</p>
      <div className="mt-6 max-w-3xl space-y-6">{children}</div>
    </div>
  );
}

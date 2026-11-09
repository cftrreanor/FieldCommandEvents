import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { saveDaysOff, saveMeetingContact, saveMeetingTimes } from "../actions";
import { DaysOffForm, MeetingContactForm, MeetingTimesForm } from "../conference-forms";
import { loadMeetingSetup } from "../load";
import { StepPage } from "../step-page";

export const metadata: Metadata = { title: "More options" };

/**
 * Setup step 4, optional: the extras (decisions 2026-11-07 and 2026-11-08). The contact email, and with
 * weekly hours, days off and the booking window. Time between meetings and breaks moved to Meeting times
 * (owner, 2026-11-09). The basics are enough to publish,
 * so this never blocks.
 */
export default async function MeetingOptionsStep({ params }: PageProps<"/dashboard/events/[eventId]/conferences/options">) {
  const { eventId } = await params;
  const s = await loadMeetingSetup(eventId);
  // Published, or unpublished with people still booked: changes wait for Save, on Meeting setup.
  if (s.published || s.booked > 0) redirect(`${s.base}?tab=times`);
  // One day: no More options step; its contact email is on Publish (owner, 2026-11-09).
  if (!s.weekly) redirect(`/dashboard/events/${eventId}#publish`);
  const publishHref = `/dashboard/events/${eventId}#publish`;
  return (
    <StepPage
      eventId={eventId}
      eventName={s.event.name}
      title="More options"
      intro={
        <>
          Optional. Everything here can wait, or stay as it is.{" "}
          <Link href={publishHref} className="font-medium text-brand underline underline-offset-4">
            Skip to Publish
          </Link>
        </>
      }
    >
      <Card>
        <h2 className="text-lg font-semibold">When every time is booked</h2>
        <p className="mt-1 mb-4 text-sm text-muted">What people see if they open your link and nothing is left.</p>
        <MeetingContactForm
          action={saveMeetingContact.bind(null, eventId)}
          initial={s.settings.contact_email ?? null}
          autosave
        />
      </Card>
      {s.weekly && (
        <Card>
          <h2 className="text-lg font-semibold">Days off</h2>
          <p className="mt-1 mb-4 text-sm text-muted">Holidays, trips, or school vacations. No meetings are booked on them. Leave Through blank for a single day.</p>
          <DaysOffForm action={saveDaysOff.bind(null, eventId)} closedDates={s.settings.closed_dates} meeting={s.meeting} autosave />
        </Card>
      )}
      {/* Weekly hours only: how far ahead people can book. Time between meetings and breaks are on Meeting times (owner, 2026-11-09). */}
      {s.weekly && (
        <Card>
          <h2 className="text-lg font-semibold">How far ahead people book</h2>
          <p className="mt-1 mb-4 text-sm text-muted">How much notice people give, and how far ahead they can book.</p>
          <MeetingTimesForm
            action={saveMeetingTimes.bind(null, eventId)}
            initial={s.settings}
            date={s.event.starts_on}
            endDate={s.event.ends_on}
            start={s.start}
            end={s.end}
            booked={s.booked}
            weeklyIncluded={s.plan?.weekly_hours ?? true}
            planName={s.plan?.active_name ?? null}
            meeting={s.meeting}
            part="extras"
            autosave={{ next: { href: publishHref, label: "Next up: Publish" } }}
          />
        </Card>
      )}
    </StepPage>
  );
}

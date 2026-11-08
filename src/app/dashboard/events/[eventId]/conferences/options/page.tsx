import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { modesOf } from "@/lib/conferences";
import { saveDaysOff, saveMeetingPhone, saveMeetingTimes } from "../actions";
import { DaysOffForm, MeetingPhoneForm, MeetingTimesForm } from "../conference-forms";
import { loadMeetingSetup } from "../load";
import { StepPage } from "../step-page";

export const metadata: Metadata = { title: "More options" };

/**
 * Setup step 4, optional: the extras (decisions 2026-11-07, finding 5). Every week instead of one
 * day, time between meetings, breaks, phone calls, and with weekly hours, days off. The basics are
 * enough to publish, so this never blocks.
 */
export default async function MeetingOptionsStep({ params }: PageProps<"/dashboard/events/[eventId]/conferences/options">) {
  const { eventId } = await params;
  const s = await loadMeetingSetup(eventId);
  if (s.published) redirect(`${s.base}?tab=times`);
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
        <h2 className="text-lg font-semibold">Phone calls</h2>
        <p className="mt-1 mb-4 text-sm text-muted">As well as {s.settings.meeting_modes?.length ? "the ways you picked on Where you'll meet" : "in person or video"}.</p>
        <MeetingPhoneForm action={saveMeetingPhone.bind(null, eventId)} on={modesOf(s.settings).includes("phone")} meeting={s.meeting} />
      </Card>
      {s.weekly && (
        <Card>
          <h2 className="text-lg font-semibold">Days off</h2>
          <p className="mt-1 mb-4 text-sm text-muted">Holidays, trips, or a break. No meetings are booked on them. Leave Through blank for a single day.</p>
          <DaysOffForm action={saveDaysOff.bind(null, eventId)} closedDates={s.settings.closed_dates} meeting={s.meeting} autosave />
        </Card>
      )}
      <Card>
        <h2 className="text-lg font-semibold">Days, breaks, and time between meetings</h2>
        <p className="mt-1 mb-4 text-sm text-muted">The same times every week instead of one day, a gap between meetings, and breaks.</p>
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
    </StepPage>
  );
}

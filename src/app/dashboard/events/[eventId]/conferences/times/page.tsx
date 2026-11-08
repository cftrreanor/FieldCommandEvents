import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { zoneName } from "@/lib/time";
import { saveMeetingTimes } from "../actions";
import { MeetingTimesForm } from "../conference-forms";
import { loadMeetingSetup } from "../load";
import { StepPage } from "../step-page";

export const metadata: Metadata = { title: "Meeting times" };

/** Setup step 2: the day and hours, and how long each meeting is. Saves itself (nobody has booked yet). */
export default async function MeetingTimesStep({ params }: PageProps<"/dashboard/events/[eventId]/conferences/times">) {
  const { eventId } = await params;
  const s = await loadMeetingSetup(eventId);
  // Once published, people may have booked: changes wait for Save, on Meeting setup.
  if (s.published) redirect(`${s.base}?tab=times`);
  return (
    <StepPage
      eventId={eventId}
      eventName={s.event.name}
      title="Meeting times"
      intro={`The day and hours you're free, and how long each meeting is. Your hours are cut into times ${s.meeting ? "people" : "families"} can book. All times are ${zoneName(s.tz)}.`}
    >
      <Card>
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
          part="basics"
          autosave={{ next: { href: `${s.base}/place`, label: "Next up: Where you'll meet" } }}
        />
      </Card>
    </StepPage>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { isPlacesConfigured } from "@/lib/places";
import { saveMeetingPlace } from "../actions";
import { MeetingPlaceForm } from "../conference-forms";
import { lastRoom, loadMeetingSetup } from "../load";
import { StepPage } from "../step-page";

export const metadata: Metadata = { title: "Where you'll meet" };

/** Setup step 3: in person (the place and room), video (one link), phone calls, or any mix. */
export default async function MeetingPlaceStep({ params }: PageProps<"/dashboard/events/[eventId]/conferences/place">) {
  const { eventId } = await params;
  const s = await loadMeetingSetup(eventId);
  if (s.published || s.booked > 0) redirect(`${s.base}?tab=place`);
  return (
    <StepPage
      eventId={eventId}
      eventName={s.event.name}
      title="Where you'll meet"
      intro="In person, on video, by phone, or any mix."
    >
      <Card>
        <MeetingPlaceForm
          action={saveMeetingPlace.bind(null, eventId)}
          initial={s.settings}
          hours={s.hours}
          venue={{ name: s.event.venue_name, address: s.event.venue_address, placeId: s.event.venue_place_id, lat: s.event.venue_lat, lng: s.event.venue_lng }}
          venueSearchEnabled={isPlacesConfigured}
          timezone={s.tz}
          meeting={s.meeting}
          lastRoom={s.settings.room ? null : await lastRoom(s.supabase, s.event.organization_id, eventId)}
          saved={!s.placeTodo}
          autosave={{ next: { href: `${s.base}/options`, label: "Next up: More options" } }}
        />
      </Card>
    </StepPage>
  );
}

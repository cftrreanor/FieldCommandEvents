import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { Badge, Card } from "@/components/ui";
import { type BookedTime, meetingStarts, meetingSummary, modesLabel, modesOf, notReady, placeMissing, weeklyMeetingCount, weeklySummary } from "@/lib/conferences";
import { loadConferenceSettings } from "@/lib/conference-settings";
import { getEventAccess, getOrigin } from "@/lib/data";
import { isPlacesConfigured } from "@/lib/places";
import { hasConferences, isMeeting } from "@/lib/event-types";
import { displayTime } from "@/lib/schedule";
import { loadAccountPlan } from "@/lib/plan";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateRange, utcToZonedDate, utcToZonedTime, zoneName } from "@/lib/time";
import { publishAndOpen, setEventPublished } from "../../../actions";
import { ActionButton, CopyLinkButton } from "../forms";
import { copyAsWeekly, saveDaysOff, saveMeetingContact, saveMeetingPlace, saveMeetingTimes } from "./actions";
import { conferenceBookedCount } from "@/lib/conference-access";
import { ConferenceSetup, DaysOffForm, MeetingContactForm, MeetingPlaceForm, MeetingTimesForm, PublishWhenSaved } from "./conference-forms";
import { SetupTabs } from "../../_components/setup-tabs";
import { SavedBy } from "@/components/saved-by";
import { lastRoom } from "./load";

export const metadata: Metadata = { title: "Setup" };

/**
 * A teacher sets up their parent-teacher conferences (or meetings), like Band
 * Registration: a card with where it stands, the booking link, and Publish;
 * then tabs for meeting times, where they'll meet, and (with weekly hours) days off.
 */
export default async function ConferencesPage({ params, searchParams }: PageProps<"/dashboard/events/[eventId]/conferences">) {
  const { eventId } = await params;
  const { tab, copy } = await searchParams;
  const access = await getEventAccess(eventId);
  if (!access.isHost) redirect(`/dashboard/events/${eventId}`);

  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, organization_id, slug, name, status, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_name, venue_address, venue_place_id, venue_lat, venue_lng")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) missing();
  if (!hasConferences(event.event_type)) redirect(`/dashboard/events/${eventId}`);
  const meeting = isMeeting(event.event_type);
  const who = meeting ? "people" : "families";

  const { saved, settings, error } = await loadConferenceSettings(supabase, eventId);
  if (error) missing();

  const tz = event.timezone;
  const start = utcToZonedTime(event.window_start, tz);
  const end = utcToZonedTime(event.window_end, tz);
  const weekly = settings.schedule === "weekly";
  const hours = weekly ? "during your weekly hours" : `${displayTime(start)} – ${displayTime(end)}`;
  const starts = meetingStarts(start, end, settings);
  const perWeek = weeklyMeetingCount(settings.weekly_hours, settings);
  const timesDone = Boolean(saved?.times_saved_at);
  const published = event.status === "published";
  // Before publishing, setup is a series of steps that save themselves (decisions 2026-11-07): go to the one still to do.
  const [booked, plan, { data: planReason }] = await Promise.all([
    conferenceBookedCount(supabase, eventId),
    loadAccountPlan(supabase, event.organization_id),
    // Why the plan won't let it publish (weekly hours, one at a time...), or null.
    published ? Promise.resolve({ data: null }) : supabase.rpc("org_can_publish", { p_event: eventId }),
  ]);
  // (Unpublished but with people still booked: here, with Save buttons, so nothing moves under them unasked.)
  if (!published && booked === 0) {
    const stepBase = `/dashboard/events/${eventId}/conferences`;
    redirect(
      !timesDone || (weekly && !settings.weekly_hours.length)
        ? `${stepBase}/times`
        : placeMissing(saved, event.venue_address, event.event_type)
          ? `${stepBase}/place`
          : `/dashboard/events/${eventId}#publish`,
    );
  }
  const weeklyIncluded = plan?.weekly_hours ?? true;
  const placeTodo = placeMissing(saved, event.venue_address, event.event_type);

  const missingNow = notReady(saved, event.venue_address, event.event_type);
  const blocked = missingNow ?? (typeof planReason === "string" ? planReason : null);
  const daysOffHere = weekly;
  const offCount = settings.closed_dates.length;
  // The open tab: ?tab=, else what's still to do.
  const tabs = ["times", "place", ...(daysOffHere ? ["daysoff"] : [])];
  const current = tabs.find((t) => t === tab) ?? (!timesDone ? "times" : placeTodo ? "place" : "times");
  const base = `/dashboard/events/${eventId}/conferences`;
  // Where the missing piece is set up, for the note under the buttons.
  const fixTab = !missingNow ? null : !timesDone || (weekly && !settings.weekly_hours.length) ? "times" : "place";
  const bookingUrl = `${await getOrigin()}/e/${event.slug}/book`;
  const [qrSvg, qrPng] = await Promise.all([
    QRCode.toString(bookingUrl, { type: "svg", margin: 1, width: 160 }),
    QRCode.toDataURL(bookingUrl, { margin: 2, width: 1024 }),
  ]);
  const smallButton = "inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-3 text-sm font-medium hover:bg-background";
  const count = weekly ? `${perWeek} ${perWeek === 1 ? "time" : "times"} each week` : meetingSummary(starts, settings.meeting_minutes);

  return (
    // data-required-marks: a small asterisk on each box that has to be filled in (globals.css).
    <div className="mx-auto max-w-3xl" data-required-marks>
      <Link href={`/dashboard/events/${eventId}`} className="text-sm text-muted hover:text-foreground">
        ← Back to {event.name}
      </Link>
      <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">{meeting ? "Meeting setup" : "Conference setup"}</h1>
      <SavedBy eventId={eventId} area="conference" className="mt-2" />
      {copy === "failed" && (
        <p role="status" className="mt-4 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
          We couldn&apos;t make a weekly copy. Making a new event takes the account&apos;s Account Host or a co-host on the account. Ask them to make it.
        </p>
      )}
      <p className="mt-2 text-muted">
        {weekly
          ? `${weeklySummary(settings.weekly_hours)} · ${formatDateRange(event.starts_on, event.ends_on)}`
          : `${formatDate(event.starts_on)} · ${hours}`}{" "}
        · All times are {zoneName(tz)}.
      </p>

      <ConferenceSetup>
        {/* Where it stands, the booking link, and Publish. */}
        <Card className="mt-6">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={published ? "live" : "neutral"}>{published ? "Published" : "Not published"}</Badge>
            <span className="text-muted">
              {timesDone ? count : "No meeting times yet"}
              {published && timesDone ? ` · ${booked} booked` : ""}
            </span>
          </p>
          <div className="mt-4">
            <p className="text-sm font-medium">Booking link</p>
            <p className="mt-1 break-all text-sm text-muted">{bookingUrl}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {/* Once published, seeing who's booked is the main job here (decisions 2026-11-08). */}
              {published && (
                <Link
                  href={`${base}/meetings`}
                  className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand-hover"
                >
                  Your meetings{booked ? ` (${booked} booked)` : ""}
                </Link>
              )}
              <CopyLinkButton url={bookingUrl} label="Copy link" />
              <a href={`/e/${event.slug}/book`} target="_blank" className={smallButton}>
                Preview booking page
              </a>
              {!published && !blocked && (
                <PublishWhenSaved>
                  <ActionButton action={publishAndOpen.bind(null, eventId)} variant="go" className="px-3! text-xs!" pendingText="Publishing…">
                    Publish
                  </ActionButton>
                </PublishWhenSaved>
              )}
            </div>
            {!published && blocked && (
              <p className="mt-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
                To publish: {blocked}{" "}
                {fixTab && fixTab !== current && (
                  <Link href={`${base}?tab=${fixTab}`} scroll={false} className="font-medium underline">
                    {fixTab === "times" ? "Go to Meeting times" : "Go to Where you'll meet"}
                  </Link>
                )}
              </p>
            )}
            {/* Tucked away to keep the top of the page short; open it to show or download the code. */}
            <details className="group mt-1">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground">
                <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
                  ›
                </span>
                QR code
              </summary>
              <div className="mt-2 flex flex-col items-start gap-2">
                <div
                  className="rounded-lg border border-border bg-white p-2"
                  aria-label="QR code for the booking link"
                  role="img"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
                <a href={qrPng} download={`${event.slug}-booking-qr.png`} className="inline-flex min-h-11 items-center text-xs font-medium text-brand underline-offset-4 hover:underline">
                  Download QR code
                </a>
              </div>
            </details>
          </div>
          {/* Apart from the everyday buttons, and saying what happens to the people already booked (decisions 2026-11-07). */}
          {published && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm text-muted">
                Unpublishing hides your booking page.{" "}
                {booked > 0
                  ? `The ${booked} ${booked === 1 ? "meeting" : "meetings"} already booked stay booked, and no one is emailed.`
                  : "No one has booked yet."}
              </p>
              <PublishWhenSaved>
                <ActionButton
                  action={setEventPublished.bind(null, eventId, false)}
                  variant="stop"
                  pendingText="Unpublishing…"
                  confirmMessage={`Unpublish your ${meeting ? "meetings" : "conference"}? Your booking page will be hidden.${booked > 0 ? ` The ${booked} ${booked === 1 ? "meeting" : "meetings"} already booked stay booked, and no one is emailed.` : ""} You can publish again anytime.`}
                >
                  Unpublish
                </ActionButton>
              </PublishWhenSaved>
            </div>
          )}
        </Card>

        <div className="mt-10">
          <SetupTabs
            label={meeting ? "Meeting setup" : "Conference setup"}
            tabs={[
              {
                key: "times",
                label: "Meeting times",
                status: timesDone ? (weekly ? `Every week · ${perWeek} ${perWeek === 1 ? "time" : "times"}` : count) : "Needs to be done",
                mark: timesDone ? "done" : "todo",
                href: `${base}?tab=times`,
                active: current === "times",
              },
              {
                key: "place",
                label: "Where you'll meet",
                status: placeTodo ? "Needs to be done" : (modesLabel(modesOf(settings)) ?? "Done"),
                mark: placeTodo ? "todo" : "done",
                href: `${base}?tab=place`,
                active: current === "place",
              },
              // Days off are only for weekly hours: a one-day conference has none.
              ...(daysOffHere
                ? [
                    {
                      key: "daysoff",
                      label: "Days off",
                      status: offCount ? `${offCount} ${offCount === 1 ? "day off" : "days off"}` : "Optional",
                      mark: offCount ? ("done" as const) : undefined,
                      href: `${base}?tab=daysoff`,
                      active: current === "daysoff",
                    },
                  ]
                : []),
            ]}
          />
          <Card className="mt-6">
            {current === "times" && (
              <>
                <h2 className="text-lg font-semibold">Meeting times</h2>
                <p className="mt-1 mb-4 text-sm text-muted">
                  One day or the same times every week, how long each meeting is, and any breaks. Your hours are cut into times {who} can book.
                </p>
                <MeetingTimesForm
                  bookedTimes={await bookedTimes(supabase, eventId, tz)}
                  copyAction={copyAsWeekly.bind(null, eventId)}
                  action={saveMeetingTimes.bind(null, eventId)}
                  initial={settings}
                  date={event.starts_on}
                  endDate={event.ends_on}
                  start={start}
                  end={end}
                  booked={booked}
                  weeklyIncluded={weeklyIncluded}
                  planName={plan?.active_name ?? null}
                  meeting={meeting}
                />
              </>
            )}
            {current === "place" && (
              <>
                <h2 className="text-lg font-semibold">Where you&apos;ll meet</h2>
                <p className="mt-1 mb-4 text-sm text-muted">
                  Your room, a video link, phone calls, or any mix. {meeting ? "People" : "Families"} wait until you&apos;re ready for them, or you call them.
                </p>
                <MeetingPlaceForm
                  action={saveMeetingPlace.bind(null, eventId)}
                  initial={settings}
                  hours={hours}
                  venue={{
                    name: event.venue_name,
                    address: event.venue_address,
                    placeId: event.venue_place_id,
                    lat: event.venue_lat,
                    lng: event.venue_lng,
                  }}
                  venueSearchEnabled={isPlacesConfigured}
                  timezone={tz}
                  meeting={meeting}
                  lastRoom={settings.room ? null : await lastRoom(supabase, event.organization_id, eventId)}
                  saved={!placeTodo}
                />
              </>
            )}
            {current === "daysoff" && (
              <>
                <h2 className="text-lg font-semibold">Days off</h2>
                <p className="mt-1 mb-4 text-sm text-muted">
                  Optional. Holidays, field trips, or a break like winter break. No meetings are booked on them. Leave Through blank for a single day.
                </p>
                <DaysOffForm action={saveDaysOff.bind(null, eventId)} closedDates={settings.closed_dates} meeting={meeting} />
              </>
            )}
          </Card>
        </div>
        <Card className="mt-6">
          <h2 className="text-lg font-semibold">When every time is booked</h2>
          <p className="mt-1 mb-4 text-sm text-muted">What people see if they open your link and nothing is left.</p>
          <MeetingContactForm action={saveMeetingContact.bind(null, eventId)} initial={settings.contact_email ?? null} />
        </Card>
      </ConferenceSetup>
    </div>
  );
}

/** Each booked meeting's person, day, and start, in the event's time zone (to name any new times leave out). */
async function bookedTimes(supabase: Awaited<ReturnType<typeof createClient>>, eventId: string, tz: string): Promise<BookedTime[]> {
  const { data } = await supabase
    .from("conference_bookings")
    .select("starts_at, child_name, parents")
    .eq("event_id", eventId)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at");
  return ((data ?? []) as { starts_at: string; child_name: string | null; parents: { name: string }[] }[]).map((b) => ({
    who: b.child_name || b.parents[0]?.name || "Someone",
    date: utcToZonedDate(b.starts_at, tz),
    time: utcToZonedTime(b.starts_at, tz),
  }));
}

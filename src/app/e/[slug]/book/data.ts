import "server-only";
import { bookingEmail, withCallPhone, bookingLink, emailTeacher, type Booking, type BookingEvent, type Teacher } from "@/lib/conference-bookings";
import { asksChildName, loadConferenceSettings } from "@/lib/conference-settings";
import { getOrigin } from "@/lib/data";
import { pause, sendEmail } from "@/lib/email";
import { loadNotifyRecipients } from "@/lib/notify-recipients";
import { createAdminClient } from "@/lib/supabase/server";
import { utcToZonedDate } from "@/lib/time";
import { hasConferences, isMeeting } from "@/lib/event-types";

export type ConferenceEvent = BookingEvent & {
  id: string;
  slug: string;
  status: string;
  event_type: string;
  starts_on: string;
  ends_on: string;
  window_start: string;
  window_end: string;
  public_notes: string | null;
  organization_id: string;
};

const EVENT_COLUMNS = "id, slug, name, status, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_name, venue_address, public_notes, created_by, organization_id";

/**
 * A conference as the server sees it: the event, its settings (with the video
 * link, so never hand these to the browser whole) and the teacher. Families
 * aren't signed in, so this reads with the server's key.
 */
export async function loadConference(by: { slug: string } | { id: string }) {
  const admin = createAdminClient();
  const q = admin.from("events").select(EVENT_COLUMNS);
  const { data: event } = await ("slug" in by ? q.eq("slug", by.slug) : q.eq("id", by.id)).maybeSingle();
  if (!event || !hasConferences(event.event_type)) return null;
  const [{ settings: s }, { data: teacher }, askChild, notify] = await Promise.all([
    loadConferenceSettings(admin, event.id),
    event.created_by
      ? admin.from("profiles").select("full_name, email").eq("id", event.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
    asksChildName(admin, event.id),
    loadNotifyRecipients(event.id),
  ]);
  const meeting = isMeeting(event.event_type);
  const t: Teacher = {
    name: teacher?.full_name?.trim() || (meeting ? "Your organizer" : "Your teacher"),
    email: teacher?.email ?? null,
    shared: Boolean(notify.get("bookings")?.extraEmails.length),
  };
  return { event: event as ConferenceEvent, settings: s, teacher: t, askChild };
}

/** A family's booking from their link. */
export async function loadBooking(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const admin = createAdminClient();
  const { data } = await withCallPhone((columns) =>
    admin.from("conference_bookings").select(`${columns}, event_id`).eq("access_token", token).maybeSingle(),
  );
  return data as (Booking & { event_id: string }) | null;
}

/**
 * After the teacher changes the conference's day, the database moves each
 * booking to the new day (20261210000000_conference_bookings_follow_day.sql).
 * Each family, and the teacher, gets an updated calendar invite. Returns how
 * many meetings moved and whether every email went.
 */
export async function emailMovedMeetings(eventId: string, except: string[] = []) {
  const conf = await loadConference({ id: eventId });
  if (!conf) return { moved: 0, allSent: true };
  const admin = createAdminClient();
  const { data } = await withCallPhone((columns) =>
    admin.from("conference_bookings").select(`${columns}, access_token`).eq("event_id", eventId).order("starts_at"),
  );
  // Not those being emailed a link to pick a new time instead (one email each).
  const bookings = ((data ?? []) as unknown as (Booking & { access_token: string })[]).filter(
    (b) => utcToZonedDate(b.starts_at, conf.event.timezone) === conf.event.starts_on && !except.includes(b.id),
  );
  const origin = await getOrigin();
  let allSent = true;
  for (const [i, b] of bookings.entries()) {
    if (i) await pause();
    const link = bookingLink(origin, conf.event.slug, b.access_token);
    for (const p of b.parents) {
      const message = await bookingEmail("changed", b, conf.event, conf.settings, conf.teacher, link, p, true);
      allSent = (await sendEmail({ to: p.email, ...message, eventId: conf.event.id })) && allSent;
      await pause();
    }
    await emailTeacher("changed", b, conf, origin, true);
  }
  return { moved: bookings.length, allSent };
}

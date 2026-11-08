import "server-only";
import { redirect } from "next/navigation";
import { conferenceBookedCount } from "@/lib/conference-access";
import { loadConferenceSettings } from "@/lib/conference-settings";
import { notReady, placeMissing } from "@/lib/conferences";
import { getEventAccess } from "@/lib/data";
import { hasConferences, isMeeting } from "@/lib/event-types";
import { displayTime } from "@/lib/schedule";
import { loadAccountPlan } from "@/lib/plan";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { utcToZonedTime } from "@/lib/time";

/** What Meeting setup and its steps need: the event, its settings, and where setup stands. */
export async function loadMeetingSetup(eventId: string) {
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
  const { saved, settings, error } = await loadConferenceSettings(supabase, eventId);
  if (error) missing();
  const tz = event.timezone;
  const start = utcToZonedTime(event.window_start, tz);
  const end = utcToZonedTime(event.window_end, tz);
  const weekly = settings.schedule === "weekly";
  const [booked, plan] = await Promise.all([conferenceBookedCount(supabase, eventId), loadAccountPlan(supabase, event.organization_id)]);
  return {
    supabase,
    event,
    saved,
    settings,
    meeting: isMeeting(event.event_type),
    tz,
    start,
    end,
    weekly,
    hours: weekly ? "during your weekly hours" : `${displayTime(start)} – ${displayTime(end)}`,
    booked,
    plan,
    published: event.status === "published",
    timesDone: Boolean(saved?.times_saved_at) && !(weekly && !settings.weekly_hours.length),
    placeTodo: placeMissing(saved, event.venue_address, event.event_type),
    missingNow: notReady(saved, event.venue_address, event.event_type),
    base: `/dashboard/events/${eventId}/conferences`,
  };
}

/** The room and directions from the account's most recent other conference or meeting, if any. */
export async function lastRoom(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, eventId: string) {
  const { data: others } = await supabase
    .from("events")
    .select("id")
    .eq("organization_id", orgId)
    .in("event_type", ["conference", "meeting"])
    .neq("id", eventId);
  if (!others?.length) return null;
  const { data } = await supabase
    .from("conference_settings")
    .select("room")
    .in("event_id", others.map((e) => e.id))
    .not("room", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.room ?? null;
}

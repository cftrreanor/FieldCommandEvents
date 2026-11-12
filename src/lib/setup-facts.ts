import "server-only";
import { getEventAccess } from "@/lib/data";
import { notReady, placeMissing } from "@/lib/conferences";
import { loadConferenceSettings } from "@/lib/conference-settings";
import { hasBooths, hasConferences, hasRooms } from "@/lib/event-types";
import type { SetupFacts } from "@/lib/setup-checklist";
import { createClient } from "@/lib/supabase/server";
import { tooLongRooms, type Room } from "@/lib/rooms";
import { isSponsorKind } from "@/lib/sponsors";
import { loadEventSponsors } from "@/lib/sponsors-data";
import { utcToZonedDate } from "@/lib/time";

/**
 * Everything the setup checklist ticks from, read fresh for one event.
 * Hosts only (null for anyone else), so the event page and every page
 * around it show the same checklist.
 */
export async function loadSetupFacts(eventId: string): Promise<SetupFacts | null> {
  if (!(await getEventAccess(eventId)).isHost) return null;
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select(
      "id, organization_id, status, event_type, volunteer_signup_open, band_registration_open, performance_order_published, director_info, band_registration_deadline, band_registration_opens_on, classifications, finals_published, finalists_revealed, parent_registration_open, parent_registration_closes_at, venue_address, timezone, starts_on",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return null;
  const type = event.event_type as string;
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const head = { count: "exact" as const, head: true };
  const conferenceHere = hasConferences(type);
  const [jobs, checkInStops, shifts, staff, invites, cohosts, files, finalsSlots, pathRooms, booths, conference, rooms, scheduleSlots, directorInvites, twoAtOnce, sponsorData] = await Promise.all([
    loadJobs(supabase, eventId),
    count(supabase.from("stations").select("id", head).eq("event_id", eventId).not("checkpoint_kind", "is", null)),
    count(supabase.from("shifts").select("id", head).eq("event_id", eventId)),
    count(supabase.from("event_staff").select("user_id", head).eq("event_id", eventId)),
    count(supabase.from("invitations").select("id", head).eq("event_id", eventId).is("accepted_at", null)),
    count(supabase.from("organization_members").select("user_id", head).eq("organization_id", event.organization_id).eq("role", "admin")),
    count(supabase.from("event_files").select("id", head).eq("event_id", eventId)),
    type === "band_contest" ? count(supabase.from("finals_slots").select("event_id", head).eq("event_id", eventId)) : 0,
    hasRooms(type) ? count(supabase.from("rooms").select("id", head).eq("event_id", eventId).not("path_order", "is", null)) : 0,
    hasBooths(type) ? count(supabase.from("fair_booths").select("id", head).eq("event_id", eventId)) : 0,
    hasConferences(type)
      ? loadConferenceSettings(supabase, eventId).then((r) => r.saved)
      : null,
    hasRooms(type) ? count(supabase.from("rooms").select("id", head).eq("event_id", eventId)) : 0,
    hasRooms(type)
      ? count(supabase.from("room_slots").select("band_id", head).eq("event_id", eventId))
      : type === "band_contest"
        ? count(supabase.from("performance_slots").select("band_id", head).eq("event_id", eventId))
        : 0,
    // Director invitations sent or waiting for the opening day.
    type === "band_contest" ? count(supabase.from("band_invitations").select("id", head).eq("event_id", eventId)) : 0,
    hasRooms(type) ? roomTwoAtOnce(supabase, eventId) : null,
    // The Sponsors add-on (band contests, festivals, and fairs): the optional step and "When you publish".
    isSponsorKind(type) ? loadEventSponsors(eventId, event.organization_id, type) : null,
  ]);
  // Why the account's plan won't let this publish (packages: what's included, one at a time), or null.
  // For "one at a time", the event that's already published, to link to.
  const planBlock = event.status === "published" ? null : await publishBlock(supabase, eventId, type, event.organization_id);
  return {
    eventId,
    eventType: type,
    published: event.status === "published",
    stations: jobs.length,
    shifts,
    readyJobs: jobs.filter((j) => j.showing && j.ready).length,
    emptyJobs: jobs.filter((j) => j.showing && !j.ready).map(({ id, name, items }) => ({ id, name, items })),
    checkInStops,
    directorInvites,
    team: staff + cohosts,
    invitesPending: invites,
    files,
    volunteerSignupOpen: event.volunteer_signup_open,
    bandRegistrationOpen: Boolean(event.band_registration_open),
    scheduleShared: Boolean(event.performance_order_published),
    finalsSlots,
    finalsPublished: Boolean(event.finals_published),
    finalistsRevealed: Boolean(event.finalists_revealed),
    directorInfo: Boolean(event.director_info?.trim()),
    registrationDeadline: Boolean(event.band_registration_deadline),
    registrationDeadlineOn: event.band_registration_deadline ?? null,
    startsOn: event.starts_on,
    // Only a day still to come: one that's here already just means "open".
    registrationOpensOn:
      event.band_registration_opens_on && event.band_registration_opens_on > utcToZonedDate(new Date().toISOString(), event.timezone)
        ? event.band_registration_opens_on
        : null,
    registrationDeadlinePast: Boolean(
      event.band_registration_deadline && event.band_registration_deadline < utcToZonedDate(new Date().toISOString(), event.timezone),
    ),
    classifications: (event.classifications ?? []).length,
    pathRooms,
    rooms,
    roomTwoAtOnce: twoAtOnce,
    scheduleSlots,
    conferenceTimesSaved: Boolean(conference?.times_saved_at),
    conferenceWeekly: conference?.schedule === "weekly",
    booths,
    parentRegistrationOpen: event.parent_registration_open,
    parentClosesAt: Boolean(event.parent_registration_closes_at),
    conferenceMissing: conferenceHere ? notReady(conference, event.venue_address, event.event_type) : null,
    // The setup steps split it: what Meeting times and Where you'll meet each still need.
    conferenceTimesMissing: conferenceHere
      ? !conference?.times_saved_at
        ? conference?.schedule === "weekly"
          ? "Add your weekly hours and dates"
          : "Add your day and hours"
        : conference.schedule === "weekly" && !conference.weekly_hours.length
          ? "Add your weekly hours"
          : null
      : null,
    conferencePlaceMissing: conferenceHere ? placeMissing(conference, event.venue_address, event.event_type) : null,
    planBlock,
    sponsors: sponsorData
      ? {
          on: sponsorData.enabled,
          count: sponsorData.sponsors.length,
          showing: sponsorData.showing,
          presentedBy: sponsorData.presentedBy?.showPublic ? sponsorData.presentedBy.name : null,
        }
      : null,
  };
}

/**
 * Each job (station): whether volunteers can see it, and whether it has a shift
 * or a thing to bring yet (what it needs before it's worth showing).
 */
async function loadJobs(supabase: Awaited<ReturnType<typeof createClient>>, eventId: string) {
  const [{ data: stations }, { data: shifts }, { data: items }] = await Promise.all([
    // Every column: showing arrives with the 20270105000000 update.
    supabase.from("stations").select("*").eq("event_id", eventId).order("sort_order").order("created_at"),
    supabase.from("shifts").select("station_id").eq("event_id", eventId),
    supabase.from("station_items").select("station_id").eq("event_id", eventId),
  ]);
  const filled = new Set([...(shifts ?? []), ...(items ?? [])].map((r) => r.station_id));
  return (stations ?? []).map((st) => ({
    id: st.id as string,
    name: st.name as string,
    showing: (st as { showing?: boolean }).showing !== false,
    ready: filled.has(st.id),
    items: (st as { signup_kind?: string }).signup_kind === "items",
  }));
}

async function publishBlock(supabase: Awaited<ReturnType<typeof createClient>>, eventId: string, type: string, orgId: string): Promise<SetupFacts["planBlock"]> {
  const { data: reason, error } = await supabase.rpc("org_can_publish", { p_event: eventId });
  // Before 20261223000000_packages.sql: the database still checks when they publish.
  if (error || typeof reason !== "string") return null;
  // The one that hasn't ended yet (finished ones don't count toward "one at a time").
  const other = reason.includes("at a time")
    ? (
        (
          await supabase
            .from("events")
            .select("id, name, ends_on, timezone")
            .eq("organization_id", orgId)
            .eq("event_type", type)
            .eq("status", "published")
            .neq("id", eventId)
            .order("starts_on")
        ).data ?? []
      ).find((e) => e.ends_on >= utcToZonedDate(new Date().toISOString(), e.timezone))
    : null;
  return { reason, other: other ? { id: other.id, name: other.name } : null };
}

/** A festival's first room on the path that's longer than the time between groups (two groups at once), by name. */
async function roomTwoAtOnce(supabase: Awaited<ReturnType<typeof createClient>>, eventId: string) {
  const [{ data: rooms }, { data: ev }] = await Promise.all([
    supabase.from("rooms").select("id, name, note, path_order, minutes").eq("event_id", eventId).not("path_order", "is", null),
    supabase.from("events").select("room_interval_minutes").eq("id", eventId).maybeSingle(),
  ]);
  if (!ev) return null;
  return tooLongRooms((rooms ?? []) as Room[], ev.room_interval_minutes)[0]?.name ?? null;
}

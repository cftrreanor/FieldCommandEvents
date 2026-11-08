import type { Metadata } from "next";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { SuccessToast } from "@/components/toaster";
import { redirect } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getEventAccess, getOrigin } from "@/lib/data";
import QRCode from "qrcode";
import { CopyLink } from "@/components/copy-link";
import { ScrollTo } from "@/components/scroll-to";
import { missing } from "@/lib/schema-check";
import { conferenceBookedCount } from "@/lib/conference-access";
import { createClient } from "@/lib/supabase/server";
import {
  eachDate,
  formatDate,
  formatDateRange,
  formatTime,
  formatTimeRange,
  utcToZonedDate,
  utcToZonedTime,
  zoneName,
} from "@/lib/time";
import { AutoRefresh } from "@/components/auto-refresh";
import { eventPhase, nextUp, onTrack, sortStations, stationTiles, type BandDay, type Checkpoint, type Stop } from "@/lib/contest-day";
import { AttentionList, DayTiles, StatusLine } from "./contest-day/on-track";
import { publishAndOpen, publishAndOpenSignups, publishSignupLater, setVolunteerSignupOpen } from "../../actions";
import { openBandRegistrationNow, publishAndOpenBandRegistration, setBandRegistrationOpen } from "../../band-actions";
import { setParentRegistrationOpen } from "./parents/actions";
import { ActionButton } from "./forms";
import { type Shift } from "./station-panel";
import { EventBannerSlot } from "@/components/event-banner-slot";
import { liveEventBanners } from "@/lib/event-banners";
import { BoothsCard } from "./booths/booths-card";
import { FileLinks } from "@/components/file-links";
import { bookingWords, eventTypeLabel, groupWords, hasBands, hasBooths, hasConferences, hasEnsembles, hasParents, hasRooms, leadWords, usesJobs } from "@/lib/event-types";
import { meetingStarts, meetingSummary, modesLabel, modesOf, notReady, placeMissing, weeklySummary } from "@/lib/conferences";
import { loadConferenceSettings } from "@/lib/conference-settings";
import { groupDay, groupDaySummary, type GroupCheckin, type GroupSlot } from "@/lib/group-day";
import { closesAtLabel, parentRegistrationClosed } from "@/lib/parents";
import { parentStats, type ParentStats } from "@/lib/parent-stats";
import { filesFor, uploadedLines, type EventFile } from "@/lib/event-files";
import { bandRegistrationMissing, publishEffects, setupChecklist, twoWeeksBefore, type SetupFacts } from "@/lib/setup-checklist";
import { volunteerTotals } from "@/lib/volunteer-totals";
import { opensLater, registrationIsOpen } from "@/lib/bands";
import { SetupGuide } from "@/components/setup-guide";
import { DayRail } from "@/components/event-day-nav";
import { loadDayActions } from "@/lib/event-day-actions";
import { SavedBy } from "@/components/saved-by";
import { brand } from "@/lib/brand";
import { loadSetupFacts } from "@/lib/setup-facts";
import { LineIcon } from "@/components/line-icon";

export const metadata: Metadata = { title: "Event setup" };

type Person = { full_name: string; email: string; phone: string | null } | null;
type StaffRow = { user_id: string; role: "volunteer_director" | "section_lead"; created_at: string; profiles: Person };
type HostRow = { user_id: string; role: "owner" | "admin"; created_at: string; profiles: Person };
type Invitation = {
  id: string;
  email: string;
  role: "volunteer_director" | "section_lead" | null;
  as_host: boolean;
  station_id: string | null;
  token: string;
  expires_at: string;
};

/** Everything saved on the event, for the one "Last change" line under its name. */
const SAVE_AREAS = ["details", "publish", "volunteers", "bands", "schedule", "parents", "booths", "conference", "team", "files", "announcements"] as const;

const ROLE_LABEL = { volunteer_director: "Volunteer Lead", section_lead: "Coordinator" } as const;

export default async function EventPage({ params, searchParams }: PageProps<"/dashboard/events/[eventId]">) {
  const { eventId } = await params;
  // Back from demo mode (demo-actions backToMe).
  const query = await searchParams;
  const demoEnded = query.demo === "ended";
  // Just published (here or from a setup page).
  const justPublished = query.published === "1";
  const user = await requireUser();
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, organization_id, slug, name, status, event_type, ready_minutes_before, volunteer_signup_open, parent_registration_open, parent_registration_closes_at, timezone, starts_on, ends_on, window_start, window_end, venue_name, venue_address, venue_place_id, band_registration_open, band_registration_deadline, band_registration_opens_on, classifications, performance_order_published, director_info, finals_published, finalists_revealed",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!event) missing();
  const bandsHere = hasBands(event.event_type);
  // Band contests and group events both take registrations; groups move through rooms.
  const groupsHere = hasEnsembles(event.event_type);
  const roomsHere = hasRooms(event.event_type);
  const conferenceHere = hasConferences(event.event_type);
  // Set up in steps (the step bar along the top is the one tracker until it's published): no second checklist beside it.
  const steppedSetup = conferenceHere || event.event_type === "volunteer" || event.event_type === "band_contest";
  const booking = bookingWords(event.event_type);
  const words = groupWords(event.event_type);

  const access = await getEventAccess(eventId);
  // Only the event's hosts and team: anyone else (even signed in) goes back to their own dashboard.
  if (!access.isHost && !(await supabase.rpc("is_event_staff", { ev: eventId })).data) redirect("/dashboard");
  const [
    { data: stationData },
    { data: shifts },
    { data: staff },
    { data: invitations },
    { data: bandData },
    { data: leadRows },
    { data: hostData },
    { data: stopData },
    { data: slotData },
  ] = await Promise.all([
    supabase
      .from("stations")
      // Every column: showing arrives with the 20270105000000 update.
      .select("*")
      .eq("event_id", eventId)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("shifts")
      .select("id, station_id, title, description, starts_at, ends_at, max_capacity, registered_count")
      .eq("event_id", eventId)
      .order("starts_at"),
    supabase.from("event_staff").select("user_id, role, created_at, profiles(full_name, email, phone)").eq("event_id", eventId),
    access.canManage
      ? supabase
          .from("invitations")
          .select("id, email, role, as_host, station_id, token, expires_at")
          .eq("event_id", eventId)
          .is("accepted_at", null)
          .order("created_at")
      : Promise.resolve({ data: [] as Invitation[] }),
    // No contact details: headcounts for hosts and Volunteer Leads, names and status for everyone on the team.
    supabase.rpc("event_bands", { ev: eventId }),
    supabase.from("station_leads").select("station_id, user_id").eq("event_id", eventId).order("created_at"),
    // Only hosts can read the organization's members.
    access.isHost
      ? supabase
          .from("organization_members")
          .select("user_id, role, created_at, profiles(full_name, email, phone)")
          .eq("organization_id", event.organization_id)
          .order("created_at")
      : Promise.resolve({ data: [] }),
    supabase.from("band_stops").select("band_id, station_id, round, performed, reached_at").eq("event_id", eventId),
    supabase.from("performance_slots").select("band_id, performance_order, warm_up_at, perform_at").eq("event_id", eventId).order("performance_order"),
  ]);
  // Things to bring count toward the volunteer totals, like shifts.
  const { data: itemRows } = await supabase.from("station_items").select("id, station_id, name, needed, claimed_count").eq("event_id", eventId).order("sort_order");
  // Each station with everyone leading it (first-added first).
  const stations = sortStations(stationData ?? []).map((st) => ({
    ...st,
    lead_ids: (leadRows ?? []).filter((l) => l.station_id === st.id).map((l) => l.user_id),
  }));
  const bands = (bandData ?? []) as BandTotals[];
  const dayBands = (bandData ?? []) as (BandDay & { school_name: string; band_name: string | null })[];
  // Contest day: are bands parked and at warm-up on time? (Hosts and Volunteer Leads.)
  const path = stations.filter((s): s is typeof s & Checkpoint => !!s.checkpoint_kind);
  const slots = new Map((slotData ?? []).map((s) => [s.band_id, s]));
  const now = new Date();
  const phase = eventPhase(event, now);
  const stops = (stopData ?? []) as Stop[];
  const status = onTrack(dayBands, stops, path, (id) => slots.get(id), event.ready_minutes_before, now, phase);
  const tiles = stationTiles(dayBands, stops, path, (id) => slots.get(id), event.ready_minutes_before, now, phase);
  const upNext =
    phase === "day"
      ? nextUp(
          (slotData ?? []).flatMap((s) => {
            const band = dayBands.find((b) => b.id === s.band_id);
            return band ? [{ band, perform_at: s.perform_at, order: s.performance_order }] : [];
          }),
          stops,
        )
      : null;
  const gate = path.find((c) => c.checkpoint_kind === "gate");

  const tz = event.timezone;
  // Maps and documents: hosts see every file (hidden ones too); the team, the ones shared with them.
  const files: EventFile[] = access.isHost
    ? (((await supabase.from("event_files").select("id, event_id, label, path, file_name, content_type, size_bytes, audiences, visible_from, uploaded_by, uploaded_at").eq("event_id", eventId).order("created_at")).data ?? []) as EventFile[])
    : await filesFor([eventId], ["public", "team"], () => tz);
  const uploaded = access.isHost ? await uploadedLines(files, tz) : undefined;
  const days = eachDate(event.starts_on, event.ends_on);
  const multiDay = days.length > 1;
  const windowLabel = formatTimeRange(event.window_start, event.window_end, tz);

  // Totals count only the jobs volunteers can see (hosts and leads read hidden ones too), the same way as Volunteer jobs.
  const totals = volunteerTotals(stations as { id: string; showing?: boolean }[], shifts ?? [], itemRows ?? []);
  const liveShifts = totals.liveShifts;
  const signedUp = totals.filled;

  // Coordinators: their sign-ups (volunteers by shift) are on the Contest day page.
  const myStations = stations.filter((s) => s.lead_ids.includes(user.id));
  const myVolunteers = (shifts ?? [])
    .filter((sh) => myStations.some((st) => st.id === sh.station_id))
    .reduce((n, sh) => n + sh.registered_count, 0);

  const shiftsByStation = new Map<string, Shift[]>();
  for (const s of (shifts ?? []) as Shift[]) {
    shiftsByStation.set(s.station_id, [...(shiftsByStation.get(s.station_id) ?? []), s]);
  }
  const totalSlots = totals.capacity;
  const staffRows = (staff ?? []) as unknown as StaffRow[];
  const hosts = ((hostData ?? []) as unknown as HostRow[]).sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
  const stationName = (id: string | null) => stations.find((s) => s.id === id)?.name;

  // Team card: what needs doing, then who joined this past week.
  const openInvites = (invitations ?? []) as Invitation[];
  const expiredInvites = openInvites.filter((inv) => new Date(inv.expires_at) < new Date());
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const joined = [
    ...hosts.filter((h) => h.role === "admin").map((h) => ({ ...h, label: "co-host" })),
    ...staffRows.map((s) => ({ ...s, label: s.role === "section_lead" ? leadWords(event.event_type).one : ROLE_LABEL[s.role] })),
  ]
    .filter((j) => new Date(j.created_at) >= weekAgo && j.user_id !== user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 3);
  const teamUpdates: TeamUpdate[] = [
    // Coordinators are optional, so a sign-up without one isn't flagged here.
    ...(expiredInvites.length
      ? [
          {
            tone: "warn" as const,
            text: `${expiredInvites.length === 1 ? "1 invitation has" : `${expiredInvites.length} invitations have`} expired. Resend them from Team setup.`,
            tab: expiredInvites[0].as_host ? "hosts" : expiredInvites[0].role === "volunteer_director" ? "volunteer-leads" : "section-leads",
          },
        ]
      : []),
    ...joined.map((j) => ({
      tone: "good" as const,
      text: `${j.profiles?.full_name || j.profiles?.email || "Someone"} joined as ${j.label === "co-host" ? "a co-host" : `a ${j.label}`} · ${formatDate(utcToZonedDate(j.created_at, tz), { year: undefined })}`,
      tab: null,
    })),
  ];
  const today = utcToZonedDate(new Date().toISOString(), tz);
  const isEventDay = today >= event.starts_on && today <= event.ends_on;
  // Group events: who's arrived and who's running over (the Event day page has the details).
  const groupStatus = roomsHere
    ? await Promise.all([
        supabase.from("room_slots").select("room_id, band_id, starts_at, ends_at").eq("event_id", eventId),
        supabase.from("group_checkins").select("band_id, room_id, created_at, actor_name").eq("event_id", eventId),
      ]).then(([{ data: gs }, { data: gc }]) =>
        (gs ?? []).length ? groupDaySummary(groupDay((gs ?? []) as GroupSlot[], (gc ?? []) as GroupCheckin[], now, isEventDay)) : null,
      )
    : null;
  const groupName = (id: string) => dayBands.find((b) => b.id === id)?.band_name ?? "A group";
  const [{ count: volunteerCount }, { data: checkins }] = access.canManage
    ? await Promise.all([
        supabase.from("volunteers").select("id", { count: "exact", head: true }).eq("event_id", eventId),
        isEventDay
          ? supabase.from("volunteer_assignments").select("checked_in_at, shifts!inner(event_id)").eq("shifts.event_id", eventId)
          : Promise.resolve({ data: [] }),
      ])
    : [{ count: 0 }, { data: [] }];
  // School visitor events: parents registered and checked in at the door.
  const parentsHere = hasParents(event.event_type);
  const parentRows = parentsHere
    ? ((await supabase.from("parent_registrations").select("created_at, checked_in_at, adult_count, other_adults, children").eq("event_id", eventId)).data ?? [])
    : [];
  const parentNumbers = parentStats(parentRows);
  // Coordinators see children's details (and work the door) on event day only.
  const doorLocked = parentsHere && !access.canManage && !isEventDay;
  const checkedIn = { done: (checkins ?? []).filter((c) => c.checked_in_at).length, of: (checkins ?? []).length };
  // Spots saved for adults each shift still needs (after the 20270110000000 update).
  const adultNeeds = new Map(
    (((await supabase.rpc("shift_adult_needs", { p_event_id: eventId })).data ?? []) as { shift_id: string; adults_needed: number }[]).map((r) => [
      r.shift_id,
      r.adults_needed,
    ]),
  );
  // The emptiest shifts first: where to send the next volunteers.
  const needsPeople = [
    ...(liveShifts as Shift[])
      .filter((s) => s.registered_count < s.max_capacity)
      .map((s) => ({
        id: s.id,
        label: `${stationName(s.station_id) ?? "Station"} · ${s.title}`,
        when: `${multiDay ? `${formatDate(utcToZonedDate(s.starts_at, tz), { year: undefined })} · ` : ""}${formatTimeRange(s.starts_at, s.ends_at, tz)}${
          (adultNeeds.get(s.id) ?? 0) > 0 ? ` · needs ${adultNeeds.get(s.id)} more adult${adultNeeds.get(s.id) === 1 ? "" : "s"}` : ""
        }`,
        sort: s.starts_at,
        filled: s.registered_count,
        capacity: s.max_capacity,
      })),
    ...totals.liveItems
      .filter((i) => i.claimed_count < i.needed)
      .map((i) => ({ id: i.id, label: `${stationName(i.station_id) ?? "Station"} · ${i.name}`, when: "Things to bring", sort: "~", filled: i.claimed_count, capacity: i.needed })),
  ]
    .sort((a, b) => a.filled / a.capacity - b.filled / b.capacity || a.sort.localeCompare(b.sort))
    .slice(0, 3);

  const publicUrl = `${await getOrigin()}/e/${event.slug}`;

  // Conferences: meeting times and where they meet (hosts and the team can read them).
  const conference = conferenceHere
    ? (await loadConferenceSettings(supabase, eventId)).saved
    : null;
  // A count only: the bookings themselves are the teacher's alone.
  const conferenceBooked = conferenceHere ? await conferenceBookedCount(supabase, eventId) : 0;

  // On the day itself, the day's jobs take the checklist's place beside the page.
  const dayActions = await loadDayActions(eventId);
  // Hosts: the setup checklist and what publishing will do (the same facts every event page's strip uses).
  const setup: SetupFacts | null = access.isHost ? await loadSetupFacts(eventId) : null;
  const checklist = setup ? setupChecklist(setup) : null;

  const past = today > event.ends_on;
  const published = event.status === "published";
  // On the day (and once it's over), what's happening comes first; before it, setup and publishing.
  const dayFirst = isEventDay || (past && published);

  // Links to share: one row for each kind of person the event has a public page for, at the top
  // once it's live. A page that isn't usable yet says why instead of offering a dead link.
  const base = `/dashboard/events/${eventId}`;
  const shareRows: ShareRow[] = [
    groupsHere
      ? {
          who: "Spectators",
          what: roomsHere ? "Room schedule and what's on now" : "Performance schedule and what's on now",
          url: publicUrl,
          on: event.performance_order_published,
          off: "Shows the schedule once you publish it",
          fix: { label: "Publish the schedule", href: `${base}/${roomsHere ? "rooms#order-heading" : "schedule"}` },
        }
      : conferenceHere
        ? { who: booking.Bookers, what: "Book a time", url: publicUrl, on: true }
        : hasBooths(event.event_type)
          ? { who: "Everyone", what: "What's at the event: booths and partners", url: publicUrl, on: true }
          : { who: "Everyone", what: "Event page: date, place, and maps", url: publicUrl, on: true },
    ...(groupsHere
      ? [
          {
            who: `${words.One} directors`,
            what: "Registration",
            url: `${publicUrl}/bands`,
            on: event.band_registration_open,
            off: "Registration is closed",
            fix: { label: "Open it", href: `${base}/bands` },
          },
        ]
      : []),
    ...(parentsHere
      ? [
          {
            who: "Parents",
            what: "Registration",
            url: `${publicUrl}/parents`,
            on: !parentRegistrationClosed(event),
            off: "Registration is closed",
            fix: { label: "Open it", href: `${base}/parents` },
          },
        ]
      : []),
    ...(!conferenceHere && (stations.length > 0 || event.event_type === "volunteer")
      ? [
          {
            who: "Volunteers",
            what: event.event_type === "volunteer" ? "Sign-up: shifts and things to bring" : "Sign-up",
            url: `${publicUrl}/volunteer`,
            on: event.volunteer_signup_open,
            off: "Sign-up is closed",
            fix: { label: "Open it", href: `${base}/volunteering` },
          },
        ]
      : []),
  ];
  const shareQrs =
    published && access.canManage
      ? await Promise.all(shareRows.map((r) => (r.on ? QRCode.toDataURL(r.url, { margin: 2, width: 1024 }) : Promise.resolve(null))))
      : [];
  // A live band contest: who the host can invite (directors from earlier contests and their imported list).
  const contestLive = published && event.event_type === "band_contest" && access.isHost;
  const inviteable = contestLive ? await countInviteable(eventId) : null;
  const regLater = contestLive && event.band_registration_open && opensLater(event) ? event.band_registration_opens_on : null;
  // The registration card's facts for a live contest (none when there's nothing to say).
  const regFacts = (() => {
    if (!contestLive || !inviteable) return null;
    const classes = (event.classifications ?? []) as string[];
    const empty = classes.filter((c) => !bands.some((b) => b.classification === c));
    const closing = event.band_registration_deadline && (registrationIsOpen(event) || regLater) ? closesOn(event.band_registration_deadline, today) : null;
    const classLine =
      bands.length > 0 && classes.length > 1
        ? empty.length
          ? <>No {words.many} yet in <span className="font-semibold">{listAnd(empty)}</span></>
          : `${words.Many} in every classification`
        : null;
    return closing || classLine || inviteable.waiting ? { closing, classLine, waiting: inviteable.waiting } : null;
  })();
  const daysToGo = Math.round((Date.parse(event.starts_on) - Date.parse(today)) / 864e5);
  const words2 = leadWords(event.event_type);

  // Hosts and Volunteer Leads: live announcements as one line (they posted them); the rest of the team sees them in full.
  const announcements = access.canManage ? await liveEventBanners(eventId, "section_leads") : [];

  // Everything that needs someone to act, in one list near the top.
  const attention: { text: string; href: string }[] = access.canManage && !conferenceHere
    ? [
        ...teamUpdates
          .filter((u) => u.tone === "warn")
          .map((u) => ({ text: u.text, href: `/dashboard/events/${eventId}/team${u.tab ? `?tab=${u.tab}` : ""}` })),
        ...(published && !past && daysToGo <= 7 && totalSlots > signedUp
          ? [
              {
                text: `${totalSlots - signedUp} volunteer ${totalSlots - signedUp === 1 ? "spot is" : "spots are"} still open`,
                href: `/dashboard/events/${eventId}/volunteering`,
              },
            ]
          : []),
      ]
    : [];

  const dayTitle = bandsHere ? "Contest day" : "Event day";
  const showDay =
    (bandsHere && (access.canManage || myStations.length > 0)) ||
    (roomsHere && !!groupStatus) ||
    (!bandsHere && !conferenceHere && (access.canManage || myStations.length > 0));

  const day = showDay ? (
    <PageSection id="day" title={dayTitle}>
      {bandsHere ? (
        <Card className={`space-y-4 ${isEventDay ? "border-brand" : ""}`}>
          {access.canManage && bands.length > 0 ? (
            <>
              {isEventDay && <AutoRefresh seconds={30} />}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <StatusLine
                  status={status}
                  hasPath={path.length > 0}
                  dayLabel={formatDate(event.starts_on, { year: undefined })}
                  time={(iso) => formatTime(iso, tz)}
                />
                <div className="flex flex-wrap gap-2">
                  <Link href={`/dashboard/events/${eventId}/contest-day`} className={dayFirst ? BTN : BTN_OUTLINE}>
                    Open contest day
                  </Link>
                  {!past && (
                    <Link href={`/dashboard/events/${eventId}/announcements`} className={BTN_OUTLINE}>
                      Broadcast message
                    </Link>
                  )}
                </div>
              </div>
              {phase !== "before" && path.length > 0 && (
                <DayTiles
                  tiles={tiles}
                  next={
                    upNext && {
                      order: upNext.order,
                      school: upNext.band.school_name,
                      band: upNext.band.band_name,
                      perform_at: upNext.perform_at,
                      atGate: !!gate && stops.some((x) => x.band_id === upNext.band.id && x.station_id === gate.id && x.round === "prelims"),
                    }
                  }
                  eventId={eventId}
                  time={(iso) => formatTime(iso, tz)}
                />
              )}
              <AttentionList status={status} eventId={eventId} limit={3} />
              {access.isHost && status.late.length > 0 && (
                <Link
                  href={`/dashboard/events/${eventId}/contest-day?station=overview`}
                  className="inline-flex text-sm font-medium text-brand underline-offset-4 hover:underline"
                >
                  Running behind? Push the schedule back
                </Link>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 text-sm leading-6">
                {myStations.length > 0 ? (
                  <p>
                    <span className="font-medium">You lead {myStations.map((s) => s.name).join(", ")}.</span>{" "}
                    <span className="text-muted">
                      {myVolunteers} {myVolunteers === 1 ? "volunteer" : "volunteers"} signed up.
                    </span>
                  </p>
                ) : (
                  <p className="text-muted">No bands registered yet. Live progress shows here once they do.</p>
                )}
                {myStations.some((s) => s.checkpoint_kind) && (
                  <p className="text-muted">
                    {!bands.length
                      ? "No bands registered yet."
                      : phase === "day"
                        ? `${status.parked} of ${status.expected} bands parked · ${tiles.find((t) => t.label === "Performed")?.done ?? 0} of ${status.expected} performed.`
                        : `${bands.length} band${bands.length === 1 ? "" : "s"} registered.`}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/dashboard/events/${eventId}/contest-day`} className={dayFirst ? BTN : BTN_OUTLINE}>
                  Open contest day
                </Link>
                {access.canManage && !past && (
                  <Link href={`/dashboard/events/${eventId}/announcements`} className={BTN_OUTLINE}>
                    Broadcast message
                  </Link>
                )}
              </div>
            </div>
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          {roomsHere && groupStatus && (
            <Card className={`flex flex-wrap items-center justify-between gap-4 ${isEventDay ? "border-brand" : ""}`}>
              {isEventDay && <AutoRefresh seconds={30} />}
              <div className="space-y-1 text-sm leading-6">
                <p>
                  <span className="font-medium">
                    {groupStatus.here} of {groupStatus.total} groups here
                  </span>
                  {groupStatus.finished > 0 && <span className="text-muted"> · {groupStatus.finished} finished every room</span>}
                </p>
                {groupStatus.late.length > 0 && (
                  <p className="text-danger">Not here yet: {groupStatus.late.map((d) => groupName(d.bandId)).join(", ")}</p>
                )}
                {groupStatus.behind.length > 0 && (
                  <p className="text-danger">Running over: {[...new Set(groupStatus.behind.map((b) => groupName(b.bandId)))].join(", ")}</p>
                )}
                {!isEventDay && <p className="text-muted">Check groups in and track each room on {formatDate(event.starts_on, { year: undefined })}.</p>}
              </div>
              <Link href={`/dashboard/events/${eventId}/event-day`} className={dayFirst ? BTN : BTN_OUTLINE}>
                Open event day
              </Link>
            </Card>
          )}
          {(access.canManage || myStations.length > 0) && (
            <Card className={isEventDay && !(roomsHere && groupStatus) ? "border-brand" : ""}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1 text-sm leading-6">
                  {access.canManage ? (
                    <p>
                      {isEventDay ? (
                        <span className="font-medium">
                          {checkedIn.done} of {checkedIn.of} volunteers checked in.
                        </span>
                      ) : past ? (
                        <span className="font-medium">
                          {signedUp} {signedUp === 1 ? "volunteer" : "volunteers"} signed up for this event.
                        </span>
                      ) : (
                        <>
                          <span className="font-medium">Check volunteers in at the desk on {formatDate(event.starts_on, { year: undefined })}.</span>{" "}
                          <span className="text-muted">Walk-ups can fill open spots, and you can release no-shows.</span>
                        </>
                      )}
                    </p>
                  ) : null}
                  {myStations.length > 0 && (
                    <p>
                      <span className="font-medium">You lead {myStations.map((s) => s.name).join(", ")}.</span>{" "}
                      <span className="text-muted">
                        {myVolunteers} {myVolunteers === 1 ? "volunteer" : "volunteers"} signed up.
                      </span>
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* One main button on the day (the check-in most used), the rest outlined. */}
                  {[
                    // Visitor days: the parent door is the main check-in.
                    parentsHere && !doorLocked && { href: `/dashboard/events/${eventId}/parents/check-in`, label: "Parent door check-in" },
                    access.canManage && { href: `/dashboard/events/${eventId}/volunteers`, label: "Volunteer check-in" },
                    myStations.length > 0 && { href: `/dashboard/events/${eventId}/contest-day`, label: "What I lead" },
                    hasBooths(event.event_type) && { href: `/dashboard/events/${eventId}/booths/check-in`, label: "Partner check-in" },
                    access.canManage && !past && { href: `/dashboard/events/${eventId}/announcements`, label: "Broadcast message" },
                  ]
                    .filter((l): l is { href: string; label: string } => Boolean(l))
                    .map((l, i) => (
                      <Link key={l.href} href={l.href} className={i === 0 && dayFirst && !(roomsHere && groupStatus) ? BTN : BTN_OUTLINE}>
                        {l.label}
                      </Link>
                    ))}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </PageSection>
  ) : null;

  // Who's coming: the sign-ups each kind of event runs on.
  const conferenceReady = !!conference?.times_saved_at && (published || conferenceBooked > 0);
  const signups = conferenceHere ? (
    access.isHost ? (
      <PageSection id="signups" title={booking.child ? "Conference setup" : "Meeting setup"}>
        <Card className={isEventDay ? "border-brand" : ""}>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:shrink-0">
            <div className="space-y-1 text-sm leading-6">
              {conference?.times_saved_at ? (
                <p className="font-medium">
                  {conference.schedule === "weekly"
                    ? `Every week · ${published ? `${conferenceBooked} booked` : weeklySummary(conference.weekly_hours)}`
                    : meetingSummary(
                        meetingStarts(utcToZonedTime(event.window_start, tz), utcToZonedTime(event.window_end, tz), conference),
                        conference.meeting_minutes,
                      )}
                  {modesOf(conference).length > 0 && ` · ${modesLabel(modesOf(conference))}`}
                </p>
              ) : (
                <p className="font-medium">Day and hours not set yet</p>
              )}
              {/* What's missing is the button itself (in the step bar's words), so it isn't said twice. */}
              {!notReady(conference, event.venue_address, event.event_type) && (
                <p className="text-muted">{published ? `${booking.Bookers} book from your public page link.` : "Ready to publish."}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {conferenceReady && (
                <Link href={`/dashboard/events/${eventId}/conferences/meetings`} className={dayFirst ? BTN : BTN_OUTLINE}>
                  Your meetings
                </Link>
              )}
              {/* One button, named after the step it opens: the same names as the step bar (light check, 2026-11-08). */}
              {(() => {
                const timesTodo = !published && (!conference?.times_saved_at || (conference.schedule === "weekly" && !conference.weekly_hours.length));
                const placeTodo = !published && !timesTodo && placeMissing(conference, event.venue_address, event.event_type);
                const step = published
                  ? { href: "", label: event.event_type === "meeting" ? "Meeting setup" : "Conference setup" }
                  : timesTodo
                    ? { href: "/times", label: "Add your hours" }
                    : placeTodo
                      ? { href: "/place", label: "Choose where you'll meet" }
                      : { href: "/times", label: "Meeting times" };
                return (
                  // An outline, as on the volunteer and band cards: the Publish box above has the one main button.
                  <Link href={`/dashboard/events/${eventId}/conferences${step.href}`} className={BTN_OUTLINE}>
                    {step.label}
                  </Link>
                );
              })()}
            </div>
          </div>
          {/* Once it's live: how full it is, the same way the volunteer card shows its spots (owner, 2026-11-08). */}
          {published && conference?.times_saved_at && conference.schedule !== "weekly" && (() => {
            const total = meetingStarts(utcToZonedTime(event.window_start, tz), utcToZonedTime(event.window_end, tz), conference).length;
            if (!total) return null;
            const pct = total ? Math.round((conferenceBooked / total) * 100) : 0;
            return (
              <div className="mt-4 space-y-4 border-t border-border pt-4">
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {conferenceBooked} of {total} times booked
                    </p>
                    <p className="text-sm tabular-nums text-muted">{pct}%</p>
                  </div>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full border border-border bg-background" role="progressbar" aria-label="Meeting times booked" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-brand"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-background px-3 py-2">
                    <dt className="text-xs text-muted">Meetings booked</dt>
                    <dd className="text-xl font-semibold tabular-nums">{conferenceBooked}</dd>
                  </div>
                  <div className="rounded-lg bg-background px-3 py-2">
                    <dt className="text-xs text-muted">Open times</dt>
                    <dd className="text-xl font-semibold tabular-nums">{Math.max(total - conferenceBooked, 0)}</dd>
                  </div>
                </dl>
              </div>
            );
          })()}
        </Card>
      </PageSection>
    ) : null
  ) : parentsHere ? (
    <PageSection id="signups" title={access.isHost ? "Parent registration" : "Parent check-in"}>
      <Card className={isEventDay ? "border-brand" : ""}>
        {isEventDay && <AutoRefresh seconds={30} />}
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:shrink-0">
          <div className="space-y-1 text-sm leading-6">
            <p className="font-medium">
              {doorLocked
                ? "Door check-in opens on event day."
                : isEventDay
                  ? `${parentNumbers.adultsArrived} of ${parentNumbers.adults} adults checked in.`
                  : `${parentNumbers.families} ${parentNumbers.families === 1 ? "family" : "families"} registered.`}
            </p>
            <p className="text-muted">
              {!published
                ? "Parents can register once the event is published."
                : !parentRegistrationClosed(event)
                  ? `Registration is open${event.parent_registration_closes_at ? ` until ${closesAtLabel(event.parent_registration_closes_at, event.timezone)}` : ""}. Parents are reminded to bring a photo ID.`
                  : "Registration is closed."}
            </p>
            <p className="text-muted">
              <LineIcon name="lock" inline />
              {doorLocked
                ? `Children's details open for ${words2.many} on event day (${formatDate(event.starts_on, { year: undefined })}), for door check-in.`
                : `Children's details are seen only by your team (${words2.many} on event day) and deleted 30 days after the event.`}
            </p>
          </div>
          {!doorLocked && (
            <div className="flex flex-wrap gap-2">
              {access.isHost && (
                <Link href={`/dashboard/events/${eventId}/parents`} className={BTN_OUTLINE}>
                  Parent Registration
                </Link>
              )}
              {/* Door check-in is its own page, like volunteer check-in. */}
              <Link href={`/dashboard/events/${eventId}/parents/check-in`} className={BTN_OUTLINE}>
                {access.isHost ? "Check-in" : "Open door check-in"}
              </Link>
            </div>
          )}
        </div>
        {!doorLocked && parentNumbers.families > 0 && <ParentNumbers stats={parentNumbers} eventDay={isEventDay} />}
        {access.isHost && published && !past && (
          <div className="mt-5">
            <OpenClose
              shareName={contestLive ? "word" : "links"}
              on={event.parent_registration_open}
              onText="Registration open"
              offText="Registration closed"
              action={setParentRegistrationOpen.bind(null, eventId, !event.parent_registration_open)}
              openLabel="Open registration"
              closeLabel="Close registration"
              confirm="Close parent registration? Families can't register until you open it again."
            />
          </div>
        )}
      </Card>
    </PageSection>
  ) : groupsHere ? (
    <PageSection id="signups" title={access.isHost ? `${words.One} registration` : words.Many}>
      <Card className="space-y-5">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:shrink-0">
          <p className="text-sm leading-6">
            <span className="font-medium">
              {bands.length ? `${bands.length} ${bands.length === 1 ? words.one : words.many} registered.` : `No ${words.many} registered yet.`}
            </span>{" "}
            <span className="text-muted">
              {access.isHost
                ? event.event_type === "band_contest"
                  ? published
                    ? registrationIsOpen(event) || regLater
                      ? "Change registration settings or invite directors."
                      : "Change registration settings."
                    : setup?.registrationOpensOn
                      ? `Registration opens ${formatDate(setup.registrationOpensOn, { year: undefined })}.`
                      : "Registration opens when you publish."
                  : `Settings, opening registration, and inviting ${words.one} directors.`
                : roomsHere
                  ? "See each group's times in every room."
                  : "See the performance order and each band's status on the day."}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {roomsHere && !access.isHost && (
              <Link href={`/dashboard/events/${eventId}/rooms`} className={BTN_OUTLINE}>
                Room schedule
              </Link>
            )}
            {(access.isHost || !roomsHere) && (
              <Link href={`/dashboard/events/${eventId}/${access.isHost ? "bands" : "schedule"}`} className={BTN_OUTLINE}>
                {access.isHost ? `Manage ${words.many}` : "Band schedule"}
              </Link>
            )}
          </div>
        </div>
        {regFacts && (
          // A live contest's registration at a glance: when it closes, where bands are missing, and who hasn't answered.
          <div className="space-y-2 border-t border-border pt-4 text-sm leading-6">
            {(regFacts.closing || regFacts.classLine) && (
              <p>
                {regFacts.closing && <span className="font-semibold">{regFacts.closing}</span>}
                {regFacts.closing && regFacts.classLine && " · "}
                {regFacts.classLine}
              </p>
            )}
            {regFacts.waiting > 0 && (
              <p>
                <span className="font-semibold">
                  {regFacts.waiting} invited {regFacts.waiting === 1 ? "director hasn't" : "directors haven't"} registered
                </span>
                {registrationIsOpen(event) ? (
                  <>
                    {" · "}
                    <Link href={`/dashboard/events/${eventId}/bands?tab=invite`} className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
                      See who hasn&apos;t registered
                    </Link>
                  </>
                ) : regLater ? null : (
                  <span className="text-muted"> · Reopen registration to remind them</span>
                )}
              </p>
            )}
          </div>
        )}
        {access.canManage && bands.length > 0 && <LogisticsTotals bands={bands} noTrucks={roomsHere} />}
        {access.isHost && published && !past && regLater ? (
          // Set to open on a later day: say when, and the two things to do about it. Nothing to close yet.
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="neutral">Opens {formatDate(regLater, { year: undefined })}</Badge>
              <Link href={`/dashboard/events/${eventId}/bands?tab=settings`} className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
                Change opening day
              </Link>
            </p>
            <ActionButton action={openBandRegistrationNow.bind(null, eventId)} variant="secondary" pendingText="Opening…" confirmMessage={`Open ${words.one} registration now? Directors can register from today instead of ${formatDate(regLater, { year: undefined })}, and any invitations you scheduled go out now.`} confirmLabel="Open registration now">
              Open registration now
            </ActionButton>
          </div>
        ) : (
          access.isHost &&
          published &&
          !past && (
            <OpenClose
              shareName={contestLive ? "word" : "links"}
              on={event.band_registration_open}
              onText="Registration open"
              offText="Registration closed"
              action={setBandRegistrationOpen.bind(null, eventId, !event.band_registration_open)}
              openLabel="Open registration"
              closeLabel="Close registration"
              confirmLabel="Close registration"
              confirm={`Close ${words.one} registration early? Directors can't register or change their registration until you reopen it.`}
            />
          )
        )}
      </Card>
    </PageSection>
  ) : hasBooths(event.event_type) ? (
    <PageSection id="signups" title="Booths and partners">
      <BoothsCard eventId={eventId} isDay={isEventDay} />
    </PageSection>
  ) : null;
  const signupsLabel = conferenceHere ? (booking.child ? "Conference" : "Meetings") : parentsHere ? "Parents" : groupsHere ? words.Many : "Booths";

  const schedule =
    groupsHere && access.isHost ? (
      <PageSection id="schedule" title={roomsHere ? "Rooms and schedule" : "Performance schedule"}>
        <Card className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={event.performance_order_published ? "success" : "neutral"}>
              {event.performance_order_published ? "Published" : "Not published"}
            </Badge>
            <span className="text-sm text-muted">
              {roomsHere
                ? "Your rooms, the path every group follows, and each group's times."
                : "The running order, breaks, and finals. Directors are emailed their times when you publish the schedule."}
            </span>
            {event.event_type === "band_contest" && !event.performance_order_published && !past && (
              // When to post times by, and why: directors book buses from them. Before publishing, it's later work.
              <span className="basis-full text-sm">
                <span className="font-semibold">Publish it by {formatDate(twoWeeksBefore(event.starts_on), { year: undefined })}</span>
                <span className="text-muted">
                  , two weeks before contest day, so directors can book buses.{published ? "" : " You can start once registration is published."}
                </span>
              </span>
            )}
          </div>
          <Link href={`/dashboard/events/${eventId}/${roomsHere ? "rooms" : "schedule"}`} className={BTN_OUTLINE}>
            {roomsHere ? "Set up rooms and schedule" : "Set up the schedule"}
          </Link>
        </Card>
      </PageSection>
    ) : null;

  // A published volunteer event's jobs with no shift or thing to bring (hosts only, from the setup facts).
  const liveEmpty = published && usesJobs(event.event_type) ? (setup?.emptyJobs ?? []) : [];
  // No volunteer jobs at all (a draft or live): one line and "Add a job", not a row of zeros (light check, 2026-11-08).
  const noJobsYet = stations.length === 0;
  const volunteers =
    access.canManage && !conferenceHere ? (
      <PageSection id="volunteers" title="Volunteers">
        <Card className="space-y-5">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              {/* Hosts get open/closed with its switch at the bottom of the card; everyone else, here. */}
              {/* A draft says so once, at the top of the page: no second "not published" here. */}
              {published && !(access.isHost && !past) && (
                <Badge tone={published && event.volunteer_signup_open ? "live" : "neutral"}>
                  {!published ? "Event not published" : event.volunteer_signup_open ? "Sign-up open" : "Sign-up closed"}
                </Badge>
              )}
              {!noJobsYet && (
              <span className="text-sm text-muted">
                {usesJobs(event.event_type)
                  ? `${stations.length} ${stations.length === 1 ? "job" : "jobs"}${liveEmpty.length ? ` · ${liveEmpty.length} not on the sign-up page yet` : ""}`
                  : `${stations.length} sign-up${stations.length === 1 ? "" : "s"} · ${(shifts ?? []).length} shift${(shifts ?? []).length === 1 ? "" : "s"}`}
              </span>
              )}
              {noJobsYet && (
                // Nothing to sign up for yet: say so, not "Sign-up open" or a row of zeros.
                <p className="text-sm leading-6">
                  <span className="font-semibold">{usesJobs(event.event_type) ? "No jobs yet." : "No sign-ups yet."}</span>{" "}
                  <span className="text-muted">
                    {published
                      ? `Add one with shifts, and its sign-up link appears in ${contestLive ? "Get the word out" : "Links to share"}.`
                      : // Only a volunteer event's publish button opens volunteer sign-up; other kinds open it on their own.
                        event.event_type === "volunteer"
                        ? "Volunteers can sign up once you add one and publish."
                        : "Volunteers can sign up once you add one, publish, and open sign-up."}
                  </span>
                </p>
              )}
            </div>
            <Link href={`/dashboard/events/${eventId}/volunteering`} className={BTN_OUTLINE}>
              {noJobsYet ? (usesJobs(event.event_type) ? "Add a job" : "Add a sign-up") : usesJobs(event.event_type) ? "Jobs and shifts" : "Manage volunteers"}
            </Link>
          </div>
          {/* Live, with a job nobody can sign up for yet: say so where the organizer checks in, with the fix. */}
          {liveEmpty.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning-soft p-4 text-sm leading-6">
              <p className="font-semibold">
                <span aria-hidden>◆ </span>
                {liveEmpty.length === 1 ? "1 job isn't on the sign-up page yet" : `${liveEmpty.length} jobs aren't on the sign-up page yet`}
              </p>
              <ul className="mt-1">
                {liveEmpty.map((j) => (
                  <li key={j.id}>
                    {j.name} needs {j.items ? "a thing to bring" : "a shift"}.{" "}
                    <Link
                      href={`/dashboard/events/${eventId}/volunteering?station=${j.id}`}
                      className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
                    >
                      Add {j.items ? "one" : "a shift"}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!noJobsYet && (
          <VolunteerStats
            filled={signedUp}
            capacity={totalSlots}
            sentence={totals.sentence}
            volunteers={volunteerCount ?? 0}
            checkedIn={isEventDay ? checkedIn : null}
            needs={needsPeople}
          />
          )}
          {access.isHost && published && !past && stations.length > 0 && (
            <OpenClose
              shareName={contestLive ? "word" : "links"}
              on={event.volunteer_signup_open}
              onText="Sign-up open"
              offText="Sign-up closed"
              action={setVolunteerSignupOpen.bind(null, eventId, !event.volunteer_signup_open)}
              openLabel="Open sign-up"
              closeLabel="Close sign-up"
              confirm="Close volunteer sign-up? The sign-up page stops taking new volunteers. Everyone already signed up keeps their spot."
            />
          )}
        </Card>
      </PageSection>
    ) : null;

  // Hosts add and manage files in event settings; the rest of the team sees what's shared with them.
  const filesBlock =
    !conferenceHere && !access.isHost && files.length > 0 ? (
      <PageSection id="files" title="Maps and documents">
        <Card className="space-y-5">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:shrink-0">
            <p className="text-sm leading-6 text-muted">
              {files.length} {files.length === 1 ? "file" : "files"} shared with you.
            </p>
          </div>
          <FileLinks files={files} details={uploaded} />
        </Card>
      </PageSection>
    ) : null;

  // Before publishing: what publishing does, and the button. (Once live, unpublishing is in event settings.)
  const publish = setup && checklist && !published ? <PublishPanel facts={setup} remaining={checklist.remaining} previewHref={conferenceHere ? `/e/${event.slug}/book` : `/e/${event.slug}/volunteer`} /> : null;

  // Still setting up: the one thing to do next, in the main column too.
  const nextUpStep = checklist && !published ? (checklist.inProgress ?? checklist.next) : null;
  const next =
    nextUpStep && nextUpStep.id !== "publish" ? (
      <Card className="mt-8 border-2 border-brand">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{nextUpStep.partial ? "Pick up where you left off" : "Next step"}</p>
            <p className="mt-1 text-lg font-semibold">{nextUpStep.label}</p>
            <p className="mt-0.5 text-sm text-muted">{nextUpStep.partial ? nextUpStep.partial.note : nextUpStep.hint}</p>
          </div>
          <Link href={nextUpStep.href} className={`${BTN} shrink-0`}>
            {nextUpStep.partial ? "Continue" : "Start"} →
          </Link>
        </div>
      </Card>
    ) : null;

  const attentionBlock =
    attention.length > 0 ? (
      <section id="attention" aria-labelledby="attention-heading" className="mt-6 scroll-mt-6 rounded-lg border border-warning/40 bg-warning-soft p-4 sm:px-6">
        {/* "To do", not "Needs attention": the Contest day card already uses that for late bands. */}
        <h2 id="attention-heading" className="font-semibold">
          To do
        </h2>
        <ul className="mt-2 space-y-1">
          {attention.map((a) => (
            <li key={a.text} className="flex gap-2 text-sm leading-6">
              <span aria-hidden className="text-danger">
                ●
              </span>
              <Link href={a.href} className="underline-offset-4 hover:underline">
                {a.text}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  // The team is managed in event settings (Coordinators in Volunteer Setup), and what needs
  // fixing there shows in "To do", so there's no Team card here.
  const blocks: Record<string, ReactNode> = { next, publish, attention: attentionBlock, day, signups, schedule, volunteers, files: filesBlock };
  // Setting up: the next step, the areas, then publishing. Live: what needs doing, then the areas.
  // On the day (and after): the day first.
  const order = dayFirst
    ? ["day", "attention", "signups", "schedule", "volunteers", "files"]
    : published
      ? ["attention", "signups", "schedule", "volunteers", "day", "files"]
      : event.event_type === "volunteer"
        ? // A volunteer event's last step is publishing: it leads the page (it names what's still needed).
          // With no job volunteers can sign up for yet, there's no event day to plan, so its card waits.
          ["publish", "attention", "signups", "schedule", "volunteers", ...((setup?.readyJobs ?? 1) > 0 ? ["day"] : []), "files"]
        : event.event_type === "band_contest"
          ? // A band contest too: the publish card leads, naming what registration still needs, or with the button.
            // Then the setup order: registration, volunteers (optional), and the schedule, which comes after publishing.
            // Contest day waits until registration is published (light check, 2026-11-08).
            ["publish", "attention", "signups", "volunteers", "schedule", "files"]
          : hasConferences(event.event_type)
            ? // Meetings and conferences set up in steps too, so publishing leads the page (decisions 2026-11-07).
              ["publish", "attention", "signups", "schedule", "volunteers", "day", "files"]
            : ["next", "attention", "signups", "schedule", "volunteers", "publish", "day", "files"];
  const labels: Record<string, string> = {
    day: dayTitle,
    // The same words as the sections they jump to (light check, 2026-11-08).
    signups: groupsHere && access.isHost
      ? `${words.One} registration`
      : parentsHere
        ? access.isHost
          ? "Parent registration"
          : "Parent check-in"
        : hasBooths(event.event_type)
          ? "Booths and partners"
          : signupsLabel,
    schedule: roomsHere ? "Rooms and schedule" : "Performance schedule",
    volunteers: "Volunteers",
    files: "Maps and documents",
  };
  const navLinks = order.filter((k) => labels[k] && blocks[k]).map((k) => ({ id: k, label: labels[k] }));
  const latest = announcements[0];
  const emergency = announcements.some((a) => a.priority === "emergency");

  return (
    <div
      className={dayActions || (checklist && !(steppedSetup && !published)) ? "lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8" : undefined}
    >
      {justPublished && !contestLive && <SuccessToast message={`Published. Your ${conferenceHere ? "booking" : "event"} page is live; the links to share are at the top.`} />}
      {justPublished && <ScrollTo id="share" />}
      {demoEnded && <SuccessToast message="You're back on your own account. The demo people and sample data are gone." />}
      {/* Meetings set up in steps: the step bar is the one tracker, so no second checklist beside it (decisions 2026-11-08). */}
      {dayActions ? <DayRail day={dayActions} /> : checklist && !(steppedSetup && !published) && <SetupGuide checklist={checklist} />}
      <div className="min-w-0">
        <Link href="/dashboard" className="text-sm text-muted hover:text-foreground">
          ← My events
        </Link>

        {/* Name and details on the left; Event settings top right (unpublishing, demo, and deleting live there too). */}
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="text-4xl font-medium tracking-tight sm:text-5xl">{event.name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Badge tone={published ? "live" : "neutral"}>{published ? "Published" : "Draft: only your team can see this"}</Badge>
              <Badge tone="info">{eventTypeLabel(event.event_type)}</Badge>
            </div>
            <p className="mt-3 text-muted">
              {/* A meetings draft with no day or hours picked: its stored dates are placeholders. */}
              {conferenceHere && !conference?.times_saved_at ? "Day and hours not set yet" : `${formatDateRange(event.starts_on, event.ends_on)} · ${windowLabel}`}
            </p>
            <p className="mt-1 text-sm text-muted">All times are {zoneName(tz)}.</p>
            <SavedBy eventId={eventId} area={SAVE_AREAS} label="Last change" className="mt-2" />
            {event.venue_address && (
              <p className="mt-1 text-sm text-muted">
                {[event.venue_name, event.venue_address].filter(Boolean).join(" · ")}
                {" · "}
                <a
                  href={mapsUrl(event.venue_address, event.venue_place_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand underline-offset-4 hover:underline"
                >
                  Map
                </a>
              </p>
            )}
          </div>
          {access.isHost && (
            <Link href={`/dashboard/events/${eventId}/edit?section=details`} className={`${BTN_OUTLINE} shrink-0 self-start`}>
              Event settings
            </Link>
          )}
        </div>

        {contestLive && inviteable ? (
          <GetTheWordOut
            eventId={eventId}
            slug={event.slug}
            rows={shareRows}
            qrs={shareQrs}
            inviteable={inviteable}
            opensOn={regLater}
            closed={!registrationIsOpen(event) && !regLater}
            justPublished={justPublished}
            deadline={event.band_registration_deadline}
            volunteersReady={totals.capacity > 0}
          />
        ) : (
          published && access.canManage && <ShareLinks rows={shareRows} qrs={shareQrs} slug={event.slug} canFix={access.isHost} />
        )}

        {/* Hosts and Volunteer Leads posted these, so one line is enough; the rest of the team sees them in full. */}
        {access.canManage ? (
          latest && (
            <Link
              href={`/dashboard/events/${eventId}/announcements`}
              className={`mt-6 flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm hover:border-brand ${emergency ? "border-danger/50 bg-danger/5" : "border-border bg-surface"}`}
            >
              <span className="min-w-0 truncate">
                <span className={`font-semibold ${emergency ? "text-danger" : ""}`}>
                  {emergency && <LineIcon name="warning" inline />}
                  {announcements.length} live {announcements.length === 1 ? "announcement" : "announcements"}
                </span>
                <span className="text-muted"> · {latest.body}</span>
              </span>
              <span className="shrink-0 font-medium text-brand">Manage →</span>
            </Link>
          )
        ) : (
          <EventBannerSlot eventId={eventId} audience="section_leads" tz={tz} className="mt-6" />
        )}

        {navLinks.length >= 4 && (
          <nav aria-label="On this page" className="relative -mx-4 mt-6 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
            <ul className="flex gap-2 whitespace-nowrap sm:flex-wrap">
              {navLinks.map((l) => (
                <li key={l.id}>
                  <a
                    href={`#${l.id}`}
                    className="inline-flex min-h-10 items-center rounded-full border border-border bg-surface px-3.5 text-sm font-medium hover:border-brand"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {order.map((k) => (
          <Fragment key={k}>{blocks[k]}</Fragment>
        ))}

      </div>
    </div>
  );
}

const BTN = "inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand-hover";
const BTN_OUTLINE = "inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";

/** One section of the event page: a heading anyone can jump to, then its card. */
function PageSection({ id, title, saved, children }: { id: string; title: string; saved?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-6" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-xl font-semibold">
        {title}
      </h2>
      {saved && <div className="mt-1">{saved}</div>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Publishing, with what that does in plain words, so hosts know when they're
 * ready and that nothing is sent or locked in. (Unpublishing is in event settings.)
 */
function PublishPanel({
  facts,
  remaining,
  previewHref,
}: {
  facts: SetupFacts;
  remaining: ReturnType<typeof setupChecklist>["remaining"];
  /** A volunteer event's sign-up page, as the team previews it. */
  previewHref: string;
}) {
  // The empty jobs are named in their own box below, so the "one more step" line skips them.
  const others = (facts.emptyJobs ?? []).length ? remaining.filter((r) => r.id !== "shifts") : remaining;
  // A volunteer event chooses when sign-up opens with its publish button.
  const jobsHere = facts.eventType === "volunteer";
  // Publishing needs a job with a shift or a thing to bring (the database checks too): until then, the way there instead of the buttons.
  const needsJob = jobsHere && (facts.readyJobs ?? 1) === 0;
  // Jobs with nothing to sign up for yet never reach the sign-up page: name them, with the way to fix each.
  const empty = jobsHere ? (facts.emptyJobs ?? []) : [];
  const jobsHref = (id?: string) => `/dashboard/events/${facts.eventId}/volunteering${id ? `?station=${id}` : ""}`;
  // A band contest needs a deadline and a classification before it can publish (the database checks too).
  const bandsHere = facts.eventType === "band_contest";
  const bandMissing = bandsHere ? bandRegistrationMissing(facts) : null;
  // Meetings and conferences need their hours and where they meet before publishing (the database checks too).
  const meetingsHere = hasConferences(facts.eventType);
  const meetingTodo = meetingsHere
    ? [
        facts.conferenceTimesMissing && { step: "times", label: facts.conferenceTimesMissing.replace(/\.$/, ""), href: `/dashboard/events/${facts.eventId}/conferences/times` },
        facts.conferencePlaceMissing && { step: "place", label: facts.conferencePlaceMissing.replace(/\.$/, ""), href: `/dashboard/events/${facts.eventId}/conferences/place` },
      ].filter((x): x is { step: string; label: string; href: string } => Boolean(x))
    : [];
  const blocked = needsJob || Boolean(bandMissing) || meetingTodo.length > 0;
  const effects = publishEffects(facts).filter((line) => !(jobsHere && line.startsWith("Volunteer sign-up")));
  return (
    <Card id="publish" className="mt-8 scroll-mt-6">
      <h2 className="text-lg font-semibold">{blocked ? "Not ready to publish yet" : others.length ? "Almost ready to publish" : "Ready to publish"}</h2>
      {needsJob && (
        // The one thing stopping them, first.
        <div className="mt-3 rounded-md border border-warning/40 bg-warning-soft p-4 text-sm leading-6">
          <p className="font-semibold">
            {facts.stations > 0 ? "Add a shift or a thing to bring to a job first" : "Add a job before you publish"}
          </p>
          <p className="mt-1">Publishing needs at least one job with a shift or a thing to bring.</p>
          <Link href={jobsHref(empty[0]?.id)} className={`${BTN} mt-3`}>
            {empty[0] ? `Add ${empty[0].items ? "things to bring" : "shifts"} to ${empty[0].name}` : "Go to jobs and shifts"}
          </Link>
        </div>
      )}
      {bandMissing && (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning-soft p-4 text-sm leading-6">
          <p className="font-semibold">{bandMissing}</p>
          <p className="mt-1">Publishing needs a registration deadline that hasn&apos;t passed and at least one classification.</p>
          <Link href={`/dashboard/events/${facts.eventId}/bands`} className={`${BTN} mt-3`}>
            Go to band registration
          </Link>
        </div>
      )}
      {meetingTodo.length > 0 && (
        // The one thing stopping them, first, with one button to it: the same box as volunteer events and band contests.
        <div className="mt-3 rounded-md border border-warning/40 bg-warning-soft p-4 text-sm leading-6">
          <p className="font-semibold">
            {/* Everything still missing, in step order, as the band contest box does. */}
            {meetingTodo.length > 1 ? "Add your hours and where you'll meet" : `${meetingTodo[0].label.replace(/^./, (c) => c.toUpperCase())} before you publish`}
          </p>
          <p className="mt-1">Publishing needs your hours and where you&apos;ll meet.</p>
          <Link href={meetingTodo[0].href} className={`${BTN} mt-3`}>
            {meetingTodo[0].step === "times" ? "Go to meeting times" : "Go to where you'll meet"}
          </Link>
        </div>
      )}
      {!needsJob && empty.length > 0 && (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning-soft p-4 text-sm leading-6">
          <p className="font-semibold">
            <span aria-hidden>◆ </span>
            {empty.length === 1 ? "1 job won't show on the sign-up page yet" : `${empty.length} jobs won't show on the sign-up page yet`}
          </p>
          <ul className="mt-1">
            {empty.map((j) => (
              <li key={j.id}>
                {j.name} needs {j.items ? "a thing to bring" : "a shift"}.{" "}
                <Link href={jobsHref(j.id)} className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
                  Add {j.items ? "one" : "a shift"}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {blocked ? null : others.length ? (
        // The checklist beside the page lists every step; here, just the first one left.
        <p className="mt-2 text-sm">
          <span className="text-muted">We recommend finishing {others.length === 1 ? "one more step" : `${others.length} more steps`} first, starting with </span>
          <Link href={others[0].href} className="font-medium text-brand underline-offset-4 hover:underline">
            {others[0].label}
          </Link>
          .
        </p>
      ) : (
        <p className="mt-2 flex items-center gap-2 text-sm font-medium text-success">
          <span aria-hidden>✓</span> Everything your event needs is set up.
        </p>
      )}
      <p className="mt-4 text-sm font-semibold">When you publish:</p>
      <ul className="mt-2 space-y-1.5 text-sm text-muted">
        {effects.map((line) => (
          <li key={line} className="flex gap-2">
            <span aria-hidden className="text-success">✓</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {blocked ? null : facts.planBlock ? (
        // Say why before they try, and what they can do: not an error after the click.
        <div className="mt-5 rounded-md border border-brand/25 bg-brand-soft p-4 text-sm leading-6">
          <p className="font-semibold">Your plan doesn&apos;t allow publishing this yet</p>
          <p className="mt-1">{facts.planBlock.reason}</p>
          <p className="mt-1 text-muted">
            To upgrade or add a one-time event pass, write to us at{" "}
            <a href={`mailto:${brand.supportEmail}`} className="font-medium text-brand underline underline-offset-4">
              {brand.supportEmail}
            </a>
            . See what&apos;s included on your{" "}
            <Link href="/dashboard/account" className="font-medium text-brand underline underline-offset-4">
              Account
            </Link>{" "}
            page.
          </p>
          {facts.planBlock.other && (
            <Link
              href={`/dashboard/events/${facts.planBlock.other.id}`}
              className="mt-3 inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand"
            >
              Open {facts.planBlock.other.name}
            </Link>
          )}
        </div>
      ) : (
        jobsHere ? (
          <div className="mt-5 space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <ActionButton action={publishAndOpenSignups.bind(null, facts.eventId)} variant="go" pendingText="Publishing…">
                Publish and open sign-up
              </ActionButton>
              <a href={previewHref} target="_blank" className="inline-flex min-h-11 items-center text-sm font-medium text-brand underline-offset-4 hover:underline">
                Preview the sign-up page
              </a>
            </div>
            <div className="text-sm">
              <p className="text-muted">Not ready for sign-ups yet? Publish now and open sign-up later. People can see the event but can&apos;t sign up.</p>
              <div className="mt-2">
                <ActionButton action={publishSignupLater.bind(null, facts.eventId)} variant="secondary" pendingText="Publishing…">
                  Publish, open sign-up later
                </ActionButton>
              </div>
            </div>
          </div>
        ) : bandsHere ? (
          <div className="mt-5">
            <ActionButton action={publishAndOpenBandRegistration.bind(null, facts.eventId)} variant="go" pendingText="Publishing…">
              {facts.registrationOpensOn
                ? `Publish, registration opens ${formatDate(facts.registrationOpensOn, { weekday: undefined, year: undefined })}`
                : "Publish and open registration"}
            </ActionButton>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <ActionButton action={publishAndOpen.bind(null, facts.eventId)} variant="go" pendingText="Publishing…">
              Publish event
            </ActionButton>
            {/* Meetings and conferences: see the booking page as people will, before it goes live (decisions 2026-11-08). */}
            {hasConferences(facts.eventType) && (
              <a href={previewHref} target="_blank" className="inline-flex min-h-11 items-center text-sm font-medium text-brand underline-offset-4 hover:underline">
                Preview the booking page
              </a>
            )}
            {hasConferences(facts.eventType) && (
              <p className="w-full text-sm text-muted">
                Optional:{" "}
                <Link href={`/dashboard/events/${facts.eventId}/edit?section=team`} className="font-medium text-brand underline underline-offset-4">
                  add a co-host
                </Link>{" "}
                or{" "}
                <Link href={`/dashboard/events/${facts.eventId}/edit?section=emails`} className="font-medium text-brand underline underline-offset-4">
                  change email settings
                </Link>
                .
              </p>
            )}
          </div>
        )
      )}
    </Card>
  );
}

type TeamUpdate = { tone: "warn" | "good"; text: string; tab: string | null };

/** Directors a band contest's host can invite: from their earlier contests, and their imported list. */
async function countInviteable(eventId: string) {
  const supabase = await createClient();
  const [{ data: past }, { data: imported }, { data: invited }, { data: bands }] = await Promise.all([
    supabase.rpc("past_band_directors", { p_event: eventId }),
    supabase.from("band_prefills").select("email").eq("event_id", eventId),
    supabase.from("band_invitations").select("email, sent_at").eq("event_id", eventId).is("replaced_by", null),
    supabase.from("bands").select("head_director_email").eq("event_id", eventId),
  ]);
  // Registered directors aren't counted, wherever they came from (the invite list does the same).
  const registered = new Set(((bands ?? []) as { head_director_email: string }[]).map((b) => b.head_director_email.toLowerCase()));
  const people = new Set(
    [
      ...((past ?? []) as { email: string; registered: boolean }[]).filter((d) => !d.registered).map((d) => d.email.toLowerCase()),
      ...((imported ?? []) as { email: string }[]).map((p) => p.email.toLowerCase()),
    ].filter((e) => !registered.has(e)),
  );
  const rows = (invited ?? []) as { email: string; sent_at: string | null }[];
  const hasInvite = new Set(rows.map((i) => i.email.toLowerCase()));
  // One count, used by both cards: directors emailed an invitation who haven't registered yet.
  const waiting = new Set(rows.filter((i) => i.sent_at && !registered.has(i.email.toLowerCase())).map((i) => i.email.toLowerCase())).size;
  return {
    people: people.size,
    /** Can be invited and haven't been (an invitation waiting for opening day counts as invited). */
    notInvited: [...people].filter((e) => !hasInvite.has(e)).length,
    waiting,
    earlier: ((past ?? []) as unknown[]).length,
  };
}

/**
 * A live band contest's first card: how to get the word out. Directors (invite them, or import a
 * list first), the registration link, and the volunteer link once there's something to sign up for.
 */
function GetTheWordOut({
  eventId,
  slug,
  rows,
  qrs,
  inviteable,
  opensOn,
  justPublished,
  deadline,
  volunteersReady,
  closed,
}: {
  /** Registration is closed (or its deadline has passed): no inviting until it reopens. */
  closed: boolean;
  eventId: string;
  slug: string;
  rows: ShareRow[];
  qrs: (string | null)[];
  inviteable: { people: number; notInvited: number; waiting: number; earlier: number };
  opensOn: string | null;
  justPublished: boolean;
  deadline: string | null;
  volunteersReady: boolean;
}) {
  const base = `/dashboard/events/${eventId}`;
  const linkClass = "inline-flex min-h-11 items-center rounded-md border-[1.5px] border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";
  const reg = rows.findIndex((r) => r.what === "Registration");
  const vol = rows.findIndex((r) => r.who === "Volunteers");
  const spectators = rows[0]?.on ? 0 : -1;
  const short = (d: string) => formatDate(d, { year: undefined });
  const linkRow = (i: number, title: string, note: string) => (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted">{note}</p>
        <p className="mt-0.5 break-all font-mono text-[13px] text-muted">{rows[i].url.replace(/^https?:\/\//, "")}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <CopyLink url={rows[i].url} className={linkClass} />
        {qrs[i] && (
          <a href={qrs[i]!} download={`${slug}-${rows[i].url.split("/").pop()}-qr.png`} className={linkClass}>
            Download QR code
          </a>
        )}
      </div>
    </li>
  );
  return (
    <>
      {justPublished && (
        <p role="status" className="mt-6 rounded-lg border border-success/40 bg-success-soft px-4 py-3 text-sm">
          <span aria-hidden className="text-success">
            ✓{" "}
          </span>
          <span className="font-semibold">Published.</span>{" "}
          {opensOn
            ? `Band registration opens on ${short(opensOn)}${deadline ? ` and stays open through ${short(deadline)}` : ""}.`
            : `Band registration is open${deadline ? ` through ${short(deadline)}` : ""}.`}
        </p>
      )}
      <section id="share" aria-labelledby="share-heading" className="mt-6 scroll-mt-6 rounded-xl border-2 border-brand bg-surface">
        <div className="px-4 pt-4 sm:px-5">
          <h2 id="share-heading" className="text-lg font-semibold">
            Get the word out
          </h2>
          <p className="mt-0.5 text-sm text-muted">Nobody hears about your contest until you share it.</p>
        </div>
        <ul className="m-4 divide-y divide-border rounded-lg border border-border sm:m-5">
          <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                <LineIcon name="band" inline />
                Band directors
              </p>
              <p className="text-sm text-muted">
                {closed
                  ? "Registration is closed. Reopen it to invite directors."
                  : opensOn
                  ? inviteable.people > 0
                    ? `Choose directors now, and their invitations go out on ${short(opensOn)}, when registration opens.`
                    : `Have last year's director list? Import it now, and invitations go out on ${short(opensOn)}.`
                  : inviteable.people > 0
                    ? `${inviteable.notInvited} ${inviteable.notInvited === 1 ? "director" : "directors"} not invited yet${inviteable.waiting ? `, and ${inviteable.waiting} invited who haven't registered` : ""}. Each gets an email with their band's details filled in.`
                    : "Have last year's director list? Import it from a spreadsheet, then invite everyone at once."}
              </p>
            </div>
            {!closed && (
              <Link href={`${base}/bands?tab=invite`} className={`${BTN} shrink-0`}>
                {inviteable.people > 0 ? "Invite directors" : "Import directors"}
              </Link>
            )}
          </li>
          {reg >= 0 && linkRow(reg, "Registration link", opensOn ? `For directors. Before ${short(opensOn)}, it shows when registration opens.` : "For directors who weren't invited, or a group email.")}
          {vol >= 0 && volunteersReady ? (
            linkRow(vol, "Volunteer sign-up", "For your band parents' group text.")
          ) : (
            <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold">Volunteer sign-up</p>
                <p className="text-sm text-muted">Add a volunteer job with shifts first, then share its link here.</p>
              </div>
              <Link href={`${base}/volunteering`} className={`${linkClass} shrink-0`}>
                Add a job
              </Link>
            </li>
          )}
          {spectators === 0 && linkRow(0, "Spectators", "The performance schedule and what's on now.")}
        </ul>
      </section>
    </>
  );
}

/** "Closes Sat, Aug 28", or in the last two weeks "Closes in 9 days" (or today, or tomorrow), in the event's time zone. */
function closesOn(deadline: string, today: string) {
  const days = Math.round((Date.parse(deadline) - Date.parse(today)) / 864e5);
  if (days > 14) return `Closes ${formatDate(deadline, { year: undefined })}`;
  return days <= 0 ? "Closes at the end of today" : days === 1 ? "Closes at the end of tomorrow" : `Closes in ${days} days`;
}

/** "5A", "4A and 5A", "3A, 4A, and 5A". */
function listAnd(items: string[]) {
  return items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

type ShareRow = {
  who: string;
  what: string;
  url: string;
  on: boolean;
  /** Why the page isn't usable yet, and where to change that. */
  off?: string;
  fix?: { label: string; href: string };
};

/**
 * Links to share, at the top of a live event: every public page it has, one
 * row per kind of person (spectators, directors, parents, volunteers), each
 * with its link, Copy link, and a QR code to download.
 */
function ShareLinks({ rows, qrs, slug, canFix }: { rows: ShareRow[]; qrs: (string | null)[]; slug: string; canFix: boolean }) {
  const linkClass = "inline-flex min-h-11 items-center font-medium text-brand underline-offset-4 hover:underline";
  return (
    <section id="share" aria-labelledby="share-heading" className="mt-6 scroll-mt-6 rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3">
        <h2 id="share-heading" className="text-sm font-semibold">
          Links to share
        </h2>
        <p className="hidden text-xs text-muted sm:block">Each opens a page anyone with the link can use</p>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r, i) => (
          <li key={r.who} className="grid gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center">
            <p className="text-sm leading-5">
              <span className="block font-semibold">{r.who}</span>
              <span className="block text-xs text-muted">{r.what}</span>
            </p>
            {r.on ? (
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 text-sm sm:flex-nowrap">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  title={r.url}
                  className="min-w-0 max-w-full truncate font-mono text-[13px] text-brand underline underline-offset-4"
                >
                  {r.url.replace(/^https?:\/\//, "")} ↗
                </a>
                <span className="flex shrink-0 gap-x-4 whitespace-nowrap">
                  <CopyLink url={r.url} className={linkClass} />
                  {qrs[i] && (
                    <a href={qrs[i]!} download={`${slug}-${r.url.split("/").pop()}-qr.png`} className={linkClass}>
                      QR code
                    </a>
                  )}
                </span>
              </div>
            ) : (
              <p className="text-sm leading-6">
                <span className="block break-all font-mono text-[13px] text-muted">{r.url.replace(/^https?:\/\//, "")}</span>
                <span className="text-muted">{r.off}</span>
                {canFix && r.fix && (
                  <>
                    {" · "}
                    <Link href={r.fix.href} className="font-medium text-brand underline-offset-4 hover:underline">
                      {r.fix.label}
                    </Link>
                  </>
                )}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A card's open/closed line: where it stands, that the link is at the top, and the switch. */
function OpenClose({
  on,
  onText,
  offText,
  action,
  openLabel,
  closeLabel,
  confirm,
  confirmLabel,
  shareName = "links",
}: {
  /** The confirm window's button ("Close registration"). */
  confirmLabel?: string;
  /** Where the link is: Get the word out (a live band contest) or Links to share. */
  shareName?: "word" | "links";
  on: boolean;
  onText: string;
  offText: string;
  action: () => Promise<unknown>;
  openLabel: string;
  closeLabel: string;
  confirm: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={on ? "success" : "neutral"}>{on ? onText : offText}</Badge>
        {on && (
          <a href="#share" className="text-muted underline-offset-4 hover:underline">
            {shareName === "word" ? "Link is in Get the word out" : "Link is in Links to share"}
          </a>
        )}
      </p>
      <ActionButton
        action={action as never}
        variant={on ? "quiet-stop" : "go"}
        confirmMessage={on ? confirm : undefined}
        confirmLabel={on ? confirmLabel : undefined}
        pendingText={on ? "Closing…" : "Opening…"}
      >
        {on ? closeLabel : openLabel}
      </ActionButton>
    </div>
  );
}

function mapsUrl(address: string, placeId: string | null) {
  const params = new URLSearchParams({ api: "1", query: address });
  if (placeId) params.set("query_place_id", placeId);
  return `https://www.google.com/maps/search/?${params}`;
}

type BandTotals = {
  classification: string;
  student_count: number;
  chaperone_count: number;
  bus_count: number;
  box_truck_count: number;
  truck_trailer_count: number;
  semi_truck_count: number;
};

/** The Parent registration card's numbers. On the event day, who's arrived and who's still to come. */
function ParentNumbers({ stats, eventDay }: { stats: ParentStats; eventDay: boolean }) {
  const tiles: [string, string | number][] = eventDay
    ? [
        ["Adults checked in", `${stats.adultsArrived} / ${stats.adults}`],
        ["Adults still to arrive", stats.adults - stats.adultsArrived],
        ["Families here", `${stats.familiesArrived} / ${stats.families}`],
        ["Children", stats.children],
      ]
    : [
        ["Families", stats.families],
        ["Adults coming", stats.adults],
        ["Children", stats.children],
        ["New this week", stats.newThisWeek],
      ];
  return (
    <div className="mt-5 border-t border-border pt-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-background px-3 py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm">
        <span className="text-muted">{eventDay ? "Arrived by grade: " : "Children by grade: "}</span>
        {stats.byGrade.map((g) => `${g.grade}: ${eventDay ? `${g.arrived} of ${g.children}` : g.children}`).join(" · ")}
      </p>
      <p className="mt-1 text-sm">
        <span className="text-muted">Children by teacher: </span>
        {stats.byTeacher.map((t) => `${t.name}: ${t.children}`).join(" · ")}
      </p>
    </div>
  );
}

/** Headcounts and vehicles across every registered band, for parking and planning. */
function LogisticsTotals({ bands, noTrucks = false }: { bands: BandTotals[]; noTrucks?: boolean }) {
  const total = (k: Exclude<keyof BandTotals, "classification">) => bands.reduce((n, b) => n + Number(b[k] ?? 0), 0);
  const byClass = bands.reduce<Record<string, number>>((acc, b) => ({ ...acc, [b.classification]: (acc[b.classification] ?? 0) + 1 }), {});
  return (
    <div className="border-t border-border pt-4">
      <h3 className="text-sm font-semibold">Logistics totals</h3>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(
          [
            [noTrucks ? "Participants" : "Students", total("student_count")],
            ["Chaperones", total("chaperone_count")],
            ["Buses", total("bus_count")],
            // Group events don't ask about trucks.
            ...(noTrucks
              ? []
              : ([
                  ["Box trucks", total("box_truck_count")],
                  ["Truck + trailers", total("truck_trailer_count")],
                  ["Semi trucks", total("semi_truck_count")],
                ] as const)),
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg bg-background px-3 py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm">
        <span className="text-muted">By classification: </span>
        {Object.entries(byClass)
          .sort()
          .map(([c, n]) => `${c}: ${n}`)
          .join(" · ")}
      </p>
    </div>
  );
}

/** The Volunteer Setup card's numbers: how full the day is and where help is needed. */
function VolunteerStats({
  filled,
  capacity,
  sentence,
  volunteers,
  checkedIn,
  needs,
}: {
  filled: number;
  capacity: number;
  sentence: string;
  volunteers: number;
  /** Only on event day. */
  checkedIn: { done: number; of: number } | null;
  needs: { id: string; label: string; when: string; filled: number; capacity: number }[];
}) {
  const pct = capacity ? Math.round((filled / capacity) * 100) : 0;
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">
            {sentence}
          </p>
          <p className="text-sm tabular-nums text-muted">{pct}%</p>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full border border-border bg-background" role="progressbar" aria-label="Volunteer spots filled" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-brand"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-background px-3 py-2">
          <dt className="text-xs text-muted">Volunteers signed up</dt>
          <dd className="text-xl font-semibold tabular-nums">{volunteers}</dd>
        </div>
        <div className="rounded-lg bg-background px-3 py-2">
          <dt className="text-xs text-muted">{checkedIn ? "Checked in today" : "Open spots"}</dt>
          <dd className="text-xl font-semibold tabular-nums">
            {checkedIn ? `${checkedIn.done} of ${checkedIn.of}` : Math.max(capacity - filled, 0)}
          </dd>
        </div>
      </dl>
      {needs.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Needs people</h3>
          <ul className="mt-2 space-y-1.5">
            {needs.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{n.label}</span>
                  <span className="block text-muted">{n.when}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  {n.filled} / {n.capacity}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

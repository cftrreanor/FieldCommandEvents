import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { meetingWhen, withCallPhone, type Booking } from "@/lib/conference-bookings";
import { bookingsOutside, meetingStarts, modesOf } from "@/lib/conferences";
import { loadConferenceSettings } from "@/lib/conference-settings";
import { getEventAccess } from "@/lib/data";
import { hasConferences, isMeeting } from "@/lib/event-types";
import { formatPhone } from "@/lib/phone";
import { displayTime, toMinutes, toTime } from "@/lib/schedule";
import { isSchemaError, missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { conferenceBookedCount, isConferenceTeacher } from "@/lib/conference-access";
import { NotTheTeacher } from "./not-teacher";
import { formatDate, formatDateRange, formatTimeRange, utcToZonedDate, utcToZonedTime, zoneName } from "@/lib/time";
import { cancelMeeting, rescheduleMeeting, setMeetingOutcome } from "../actions";
import { MeetingList, type MeetingRow, type Outcome } from "./meeting-list";

export const metadata: Metadata = { title: "Your meetings" };

/**
 * The booked meetings, in time order: who's coming, how to reach them, and
 * their notes, with Reschedule and Cancel. Only the event's hosts and co-hosts
 * can see this page (and the database only lets them read its bookings).
 */
export default async function MeetingsPage({ params }: PageProps<"/dashboard/events/[eventId]/conferences/meetings">) {
  const { eventId } = await params;
  const access = await getEventAccess(eventId);
  if (!access.isHost) redirect(`/dashboard/events/${eventId}`);

  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, name, slug, status, event_type, timezone, starts_on, ends_on, window_start, window_end")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) missing();
  if (!hasConferences(event.event_type)) redirect(`/dashboard/events/${eventId}`);
  const meeting = isMeeting(event.event_type);
  const setupName = meeting ? "Meeting setup" : "Conference setup";
  if (!(await isConferenceTeacher(supabase, eventId))) return <NotTheTeacher eventId={eventId} booked={await conferenceBookedCount(supabase, eventId)} meeting={isMeeting(event.event_type)} />;

  const loadBookings = (extra: string) =>
    withCallPhone((columns) =>
      supabase
        .from("conference_bookings")
        .select(columns.replace(", calendar_sequence", "") + extra)
        .eq("event_id", eventId)
        .order("starts_at"),
    );
  const [{ settings, error: settingsError }, withOutcomes, { data: openRows }] = await Promise.all([
    loadConferenceSettings(supabase, eventId),
    loadBookings(", outcome"),
    // The open times a meeting can be rescheduled to (none while it's a draft).
    supabase.rpc("conference_open_times", { p_slug: event.slug }),
  ]);
  // Met / No-show needs the conference outcomes update (20261130000000); until then the list works without it.
  const outcomesReady = !isSchemaError(withOutcomes.error);
  const { data: bookingRows, error: bookingsError } = outcomesReady ? withOutcomes : await loadBookings("");
  if (settingsError || bookingsError) missing();
  const bookings = (bookingRows ?? []) as unknown as (Omit<Booking, "calendar_sequence"> & { outcome?: Outcome })[];

  const tz = event.timezone;
  const len = settings.meeting_minutes;
  const starts = meetingStarts(utcToZonedTime(event.window_start, tz), utcToZonedTime(event.window_end, tz), settings);
  const byTime = new Map(bookings.map((b) => [utcToZonedTime(b.starts_at, tz), b]));
  // A meeting moved to a typed-in time (say 3:37) covers the usual times it overlaps: they aren't open.
  const bookedAt = [...byTime.keys()].map(toMinutes);
  const covered = (t: string) => !byTime.has(t) && bookedAt.some((m) => m < toMinutes(t) + len && toMinutes(t) < m + len);
  // Every meeting time, plus any booking at a time that's since been taken out of the hours (or moved to a typed-in one).
  const times = [...new Set([...starts, ...byTime.keys()])].filter((t) => !covered(t)).sort();

  const nowIso = new Date().toISOString();
  const today = utcToZonedDate(nowIso, tz);
  const weekly = settings.schedule === "weekly";
  const isToday = weekly ? today >= event.starts_on && today <= event.ends_on : today === event.starts_on;
  const isOver = today > event.starts_on;
  const now = toMinutes(utcToZonedTime(nowIso, tz));
  const nextBooked = isToday ? times.find((t) => toMinutes(t) > now && byTime.has(t)) : undefined;
  const range = (start: string, minutes: number) => `${displayTime(start)} – ${displayTime(toTime(toMinutes(start) + minutes))}`;
  const showMode = modesOf(settings).length > 1;
  // With more than one way to meet, each shows which the family picked; phone calls show the number to call (below).
  const modeText = (b: (typeof bookings)[number]) =>
    b.meeting_mode === "phone" ? (b.call_phone ? null : "Phone call") : showMode ? (b.meeting_mode === "video" ? "Video" : "In person") : null;
  const card = (b: (typeof bookings)[number]) => ({
    id: b.id,
    child: b.child_name,
    // A parent's phone that's also the number to call shows once, on the Call button.
    parents: b.parents.map((p) => {
      const shown = p.phone && !(b.meeting_mode === "phone" && p.phone === b.call_phone) ? p.phone : null;
      return { name: p.name, email: p.email, phone: shown, phoneDisplay: shown ? formatPhone(shown) : null };
    }),
    mode: modeText(b),
    call: b.meeting_mode === "phone" && b.call_phone ? { tel: b.call_phone, display: formatPhone(b.call_phone) } : null,
    note: b.note,
    cancel: cancelMeeting.bind(null, eventId, b.id),
    reschedule: rescheduleMeeting.bind(null, eventId, b.id),
    when: meetingWhen(b.starts_at, len, tz),
    // The real start, as Met / No-show checks it (not just the time of day).
    started: Date.parse(b.starts_at) <= Date.parse(nowIso),
    outcome: outcomesReady ? (b.outcome ?? null) : undefined,
    setOutcome: setMeetingOutcome.bind(null, eventId, b.id),
  });

  // Weekly hours: each booked meeting with its day, in time order (open times aren't listed).
  const nowMs = Date.parse(nowIso);
  const nextWeekly = bookings.find((b) => Date.parse(b.starts_at) > nowMs && utcToZonedDate(b.starts_at, tz) === today)?.id;
  const weeklyRows: MeetingRow[] = bookings.map((b) => {
    const start = Date.parse(b.starts_at);
    const end = start + len * 60_000;
    return {
      kind: "meeting",
      key: b.id,
      time: formatTimeRange(b.starts_at, new Date(end).toISOString(), tz, { zone: false }),
      day: utcToZonedDate(b.starts_at, tz),
      dayLabel: formatDate(utcToZonedDate(b.starts_at, tz), { weekday: "long", year: undefined }),
      over: end <= nowMs,
      status: end <= nowMs ? "past" : start <= nowMs ? "now" : b.id === nextWeekly ? "next" : null,
      booking: card(b),
    };
  });

  const meetings: MeetingRow[] = times.map((t) => {
    const b = byTime.get(t);
    const m = toMinutes(t);
    const status = isOver ? "past" : !isToday ? null : m + len <= now ? "past" : m <= now ? "now" : t === nextBooked ? "next" : null;
    return {
      kind: "meeting",
      key: t,
      time: range(t, len),
      over: isOver || (isToday && m + len <= now),
      status: b ? status : null,
      booking: b ? card(b) : null,
    };
  });
  const breaks: MeetingRow[] = settings.breaks
    .filter((b) => b.start && b.minutes > 0)
    .map((b) => ({
      kind: "break",
      key: `break-${b.start}`,
      time: range(b.start, b.minutes),
      over: isOver || (isToday && toMinutes(b.start) + b.minutes <= now),
      label: b.label?.trim() || "Break",
    }));
  // Upcoming meetings the hours no longer cover (the hours changed after they booked): listed first,
  // to move or cancel (decisions 2026-11-08, finding 2).
  // Who's already been emailed a link to pick a new time (before its update: nobody).
  const { data: asked } = await supabase.from("conference_bookings").select("id, reschedule_requested_at").eq("event_id", eventId).not("reschedule_requested_at", "is", null);
  const askedIds = new Set(((asked ?? []) as { id: string }[]).map((r) => r.id));
  const outside = bookingsOutside(
    bookings
      .filter((b) => b.starts_at >= nowIso)
      .map((b) => ({ who: b.id, date: utcToZonedDate(b.starts_at, tz), time: utcToZonedTime(b.starts_at, tz) })),
    {
      schedule: settings.schedule,
      day: event.starts_on,
      from: utcToZonedTime(event.window_start, tz),
      to: utcToZonedTime(event.window_end, tz),
      weekly: settings.weekly_hours,
      firstDay: event.starts_on,
      lastDay: event.ends_on,
      closed: settings.closed_dates,
      lengths: settings,
    },
  );
  const rows = weekly ? weeklyRows : [...meetings, ...breaks].sort((a, b) => toMinutes(a.key.replace("break-", "")) - toMinutes(b.key.replace("break-", "")));

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/dashboard/events/${eventId}`} className="text-sm text-muted hover:text-foreground print:hidden">
        ← Back to {event.name}
      </Link>
      <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Your meetings</h1>
      <p className="mt-2 text-muted">
        {event.name} · {weekly ? `Every week · ${formatDateRange(event.starts_on, event.ends_on)}` : formatDate(event.starts_on)} · All times are{" "}
        {zoneName(tz)}.
      </p>
      {isToday && <AutoRefresh status className="mt-1" />}

      {!settings.times_saved_at ? (
        <p className="mt-6">
          Set your meeting times first.{" "}
          <Link href={`/dashboard/events/${eventId}/conferences`} className="font-medium text-brand underline">
            {setupName}
          </Link>
        </p>
      ) : (
        <div className="mt-6 space-y-4">
          {event.status !== "published" && bookings.length === 0 && (
            <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
              {meeting ? "People can book once you publish your meetings." : "Families can book once you publish your conference."}{" "}
              <Link href={`/dashboard/events/${eventId}/conferences`} className="font-medium text-brand underline">
                {setupName}
              </Link>
            </p>
          )}
          {outside.length > 0 && (
            <div role="status" className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm leading-6">
              <p className="font-semibold">
                {outside.length === 1 ? "1 meeting is" : `${outside.length} meetings are`} outside your hours now
              </p>
              <ul className="mt-1 list-disc pl-5">
                {outside.map((o) => {
                  const b = bookings.find((x) => x.id === o.who)!;
                  return (
                    <li key={o.who}>
                      {b.child_name || b.parents[0]?.name || "Someone"}, {weekly ? `${formatDate(o.date, { year: undefined })} at ` : ""}
                      {displayTime(o.time)}
                      <span className="text-muted"> · {askedIds.has(o.who) ? "emailed a link to pick a new time" : "not emailed"}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1">They&apos;re still booked. Reschedule or cancel each one below, so no one comes when you&apos;re not there.</p>
            </div>
          )}
          <MeetingList
            rows={rows}
            booked={bookings.length}
            total={weekly ? null : starts.length}
            today={weekly ? today : undefined}
            summaryHref={`/dashboard/events/${eventId}/conferences/meetings/summary`}
            meeting={meeting}
            slots={((openRows ?? []) as { starts_at: string }[]).map((o) => ({
              value: o.starts_at,
              day: formatDate(utcToZonedDate(o.starts_at, tz), { weekday: "long", year: undefined }),
              label: formatTimeRange(o.starts_at, new Date(Date.parse(o.starts_at) + len * 60_000).toISOString(), tz, { zone: false }),
            }))}
            days={{ min: event.starts_on, max: event.ends_on, zone: zoneName(tz) }}
          />
        </div>
      )}

      <p className="mt-8 text-sm text-muted print:hidden">
        Only you and your co-hosts can see {meeting ? "who booked" : "these families"} and their notes. Everything is deleted 30 days after{" "}
        {weekly || meeting ? "each meeting" : "your conference"}.
      </p>
    </div>
  );
}

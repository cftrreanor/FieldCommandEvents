"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { linkFrom, passcodeFrom } from "@/lib/meeting-link";
import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import { isMeeting } from "@/lib/event-types";
import { formatPhone } from "@/lib/phone";
import {
  AHEAD_DAYS,
  GAP_LENGTHS,
  MEETING_LENGTHS,
  NOTICE_HOURS,
  sortWeekly,
  WEEKDAYS,
  isMode,
  MODES,
  type ConferenceBreak,
  type Mode,
  type WeeklyRange,
  bookingsOutside,
} from "@/lib/conferences";
import { isSchemaError } from "@/lib/schema-check";
import { conferenceBookedCount } from "@/lib/conference-access";
import { loadConferenceSettings } from "@/lib/conference-settings";
import { emailMovedMeetings, loadConference } from "@/app/e/[slug]/book/data";
import { BOOKING_COLUMNS, bookingEmail, bookingLink, emailTeacher, meetingWhen, pickNewTimeEmail, withCallPhone, type Booking, type OrganizerNote } from "@/lib/conference-bookings";
import { getOrigin } from "@/lib/data";
import { pause, sendEmail } from "@/lib/email";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { formatDate, utcToZonedDate, utcToZonedTime, zonedToUtc } from "@/lib/time";
import { displayTime } from "@/lib/schedule";

const TIME = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function refresh(eventId: string) {
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
}

/**
 * Saves the conference's settings: changes the row if there is one, otherwise
 * adds it. (Not an upsert: that would also rewrite event_id, which hosts
 * aren't allowed to change.)
 */
async function saveSettings(eventId: string, values: Record<string, unknown>) {
  const supabase = await createClient();
  const row = { ...values, updated_at: new Date().toISOString() };
  const updated = await supabase.from("conference_settings").update(row).eq("event_id", eventId).select("event_id");
  if (updated.error || updated.data?.length) return updated.error;
  const { error } = await supabase.from("conference_settings").insert({ event_id: eventId, ...row });
  return error;
}

/**
 * Meeting times: one day or weekly hours, meeting length, the gap between meetings, breaks, and the
 * booking window. The setup steps send only their own part ("basics": the day or weekly hours and
 * the length; "extras": the gap, breaks, and booking window), and the rest comes from what's saved,
 * so two steps (or two people) never overwrite each other with stale values (decisions 2026-11-08).
 */
export async function saveMeetingTimes(eventId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const part = formData.get("part");
  const ownsBasics = part !== "extras";
  const ownsExtras = part !== "basics";
  const supabase = await createClient();
  const [{ data: event }, current, booked] = await Promise.all([
    supabase.from("events").select("timezone, starts_on, ends_on, window_start, window_end, event_type").eq("id", eventId).maybeSingle(),
    loadConferenceSettings(supabase, eventId),
    conferenceBookedCount(supabase, eventId),
  ]);
  if (!event) return { error: "Only the event's hosts can change it." };
  const s = current.settings;
  const who = isMeeting(event.event_type) ? "People" : "Families";

  const meeting = ownsBasics ? Number(formData.get("meetingMinutes")) : s.meeting_minutes;
  const gap = ownsExtras ? Number(formData.get("gapMinutes") ?? 0) : s.gap_minutes;
  if (!(MEETING_LENGTHS as readonly number[]).includes(meeting)) return { error: "Pick how long each meeting is." };
  if (!(GAP_LENGTHS as readonly number[]).includes(gap)) return { error: "Pick the time between meetings." };
  let breaks: ConferenceBreak[] = s.breaks;
  if (ownsExtras) {
    const starts = formData.getAll("breakStart").map(String);
    const minutes = formData.getAll("breakMinutes").map(String);
    const labels = formData.getAll("breakLabel").map(String);
    breaks = [];
    for (let i = 0; i < starts.length; i++) {
      if (!starts[i] && !minutes[i]) continue;
      const m = Number(minutes[i]);
      if (!TIME.test(starts[i]) || !Number.isInteger(m) || m < 5 || m > 240) {
        return { error: "Give each break a start time and a length of 5 to 240 minutes, or remove it." };
      }
      breaks.push({ start: starts[i], minutes: m, label: labels[i]?.trim().slice(0, 60) || "Break" });
    }
    if (breaks.length > 8) return { error: "Add up to 8 breaks." };
    breaks = breaks.sort((a, b) => a.start.localeCompare(b.start));
  }
  const lengths = { meeting_minutes: meeting, gap_minutes: gap, breaks };

  const weekly = ownsBasics ? formData.get("schedule") === "weekly" : s.schedule === "weekly";
  const was = s.schedule;
  // Booked meetings are kept as booked: switching between a day and weekly hours waits until they're canceled.
  if (booked > 0 && (weekly ? "weekly" : "one_day") !== was) {
    return {
      error:
        was === "weekly"
          ? `${who} have booked weekly meetings. Cancel them on Your meetings first, or make a new event for one day.`
          : `${who} have booked your day. Make a weekly copy for weekly hours instead.`,
    };
  }
  if (current.legacy && weekly) return { error: "Weekly hours need a database update first. Please write to us." };
  const common = { ...lengths, times_saved_at: ownsBasics ? new Date().toISOString() : s.times_saved_at };
  const tz = event.timezone;
  // What happens to booked meetings these times leave out: email them a link, or the organizer contacts them.
  const choice = formData.get("outsideChoice") === "email" ? "email" : formData.get("outsideChoice") === "self" ? "self" : null;
  // The times as saved now, to count only the meetings this change leaves out (decisions 2026-11-08, light check).
  const savedTimes: Parameters<typeof bookingsOutside>[1] =
    s.schedule === "weekly"
      ? { schedule: "weekly", day: event.starts_on, from: "", to: "", weekly: s.weekly_hours, firstDay: event.starts_on, lastDay: event.ends_on, closed: s.closed_dates, lengths: s }
      : {
          schedule: "one_day",
          day: event.starts_on,
          from: utcToZonedTime(event.window_start, tz),
          to: utcToZonedTime(event.window_end, tz),
          weekly: [],
          firstDay: event.starts_on,
          lastDay: event.starts_on,
          closed: [],
          lengths: s,
          movesWithDay: true,
        };

  if (weekly) {
    let hours: WeeklyRange[] = s.weekly_hours;
    let from = event.starts_on;
    let to = event.ends_on;
    if (ownsBasics) {
      const days = formData.getAll("weeklyDay").map(String);
      const froms = formData.getAll("weeklyStart").map(String);
      const tos = formData.getAll("weeklyEnd").map(String);
      hours = [];
      for (let i = 0; i < days.length; i++) {
        const d = Number(days[i]);
        if (!Number.isInteger(d) || d < 0 || d > 6 || !TIME.test(froms[i] ?? "") || !TIME.test(tos[i] ?? "")) {
          return { error: "Give each block of weekly hours a day, a start, and an end." };
        }
        if (tos[i] <= froms[i]) return { error: `Your ${WEEKDAYS[d]} hours have to end after they start.` };
        hours.push({ day: d, start: froms[i], end: tos[i] });
      }
      if (!hours.length) return { error: "Pick at least one day you meet." };
      if (hours.length > 21) return { error: "Add up to 21 blocks of weekly hours." };
      from = String(formData.get("weeklyFrom") ?? "");
      to = String(formData.get("weeklyTo") ?? "");
      if (!DATE.test(from) || !DATE.test(to)) return { error: "Pick your first and last day." };
      if (to < from) return { error: "Your last day has to be on or after your first day." };
      if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) return { error: "Weekly hours can run for up to a year. Pick an earlier last day." };
    }
    const notice = ownsExtras ? Number(formData.get("minNotice") ?? s.min_notice_hours) : s.min_notice_hours;
    const ahead = ownsExtras ? Number(formData.get("maxAhead") ?? s.max_days_ahead) : s.max_days_ahead;
    if (!(NOTICE_HOURS as readonly number[]).includes(notice)) return { error: "Pick how much notice people give." };
    if (!(AHEAD_DAYS as readonly number[]).includes(ahead)) return { error: "Pick how far ahead people can book." };
    const leftOut =
      booked > 0 && hours.length
        ? await newlyLeftOut(supabase, eventId, tz, savedTimes, { schedule: "weekly", day: from, from: "", to: "", weekly: hours, firstDay: from, lastDay: to, closed: s.closed_dates, lengths })
        : [];
    if (leftOut.length && !choice) return { error: leftOutMessage(leftOut) };
    // Settings first (weekly hours may run more than one day), then the event's days.
    const error = await saveSettings(eventId, { ...common, schedule: "weekly", weekly_hours: sortWeekly(hours), min_notice_hours: notice, max_days_ahead: ahead });
    if (error) return { error: friendlyDbError(error) };
    if (ownsBasics && hours.length) {
      const opens = hours.map((h) => h.start).sort()[0];
      const closes = hours.map((h) => h.end).sort().at(-1)!;
      const { error: daysError } = await supabase.rpc("reschedule_event", {
        p_event_id: eventId,
        p_starts_on: from,
        p_ends_on: to,
        p_window_start: zonedToUtc(from, opens, tz).toISOString(),
        p_window_end: zonedToUtc(to, closes, tz).toISOString(),
        p_timezone: tz,
      });
      if (daysError) return { error: friendlyDbError(daysError) };
    }
    refresh(eventId);
    const told = choice === "email" ? await emailLeftOut(eventId, leftOut.map((b) => b.id)) : "";
    // Some meetings were left out: Your meetings lists them first.
    return { ok: true, message: `Meeting times saved.${told}`, goTo: leftOut.length ? `/dashboard/events/${eventId}/conferences/meetings` : undefined };
  }

  // One day. Changed the day or hours here: the event moves too, and booked meetings move with the day
  // (each person is emailed).
  const dayField = ownsBasics ? formData.get("conferenceDay") : null;
  if (dayField === null && was === "weekly" && ownsBasics) return { error: "Pick your day." };
  const date = dayField !== null ? String(dayField) : event.starts_on;
  const from = dayField !== null ? String(formData.get("startTime") ?? "") : utcToZonedTime(event.window_start, tz);
  const to = dayField !== null ? String(formData.get("endTime") ?? "") : utcToZonedTime(event.window_end, tz);
  if (dayField !== null) {
    if (!DATE.test(date)) return { error: "Pick the day." };
    if (!TIME.test(from) || !TIME.test(to)) return { error: "Pick when your first meeting starts and your last one ends." };
    if (to <= from) return { error: "Your last meeting has to end after the first one starts." };
  }
  // Booked meetings move with the day, so only their time of day has to fit.
  const leftOut =
    booked > 0
      ? await newlyLeftOut(supabase, eventId, tz, savedTimes, { schedule: "one_day", day: date, from, to, weekly: [], firstDay: date, lastDay: date, closed: [], lengths, movesWithDay: true })
      : [];
  if (leftOut.length && !choice) return { error: leftOutMessage(leftOut) };
  // Emailed a link to pick a new time instead: one email each, not a "moved" one as well.
  const emailing = choice === "email" ? leftOut.map((b) => b.id) : [];
  let moved: Awaited<ReturnType<typeof emailMovedMeetings>> | null = null;
  if (dayField !== null) {
    const { error } = await supabase.rpc("reschedule_event", {
      p_event_id: eventId,
      p_starts_on: date,
      p_ends_on: date,
      p_window_start: zonedToUtc(date, from, tz).toISOString(),
      p_window_end: zonedToUtc(date, to, tz).toISOString(),
      p_timezone: tz,
    });
    if (error) return { error: friendlyDbError(error) };
    if (date !== event.starts_on && was === "one_day") moved = await emailMovedMeetings(eventId, emailing);
  }
  const error = await saveSettings(eventId, current.legacy ? common : { ...common, schedule: "one_day" });
  if (error) return { error: friendlyDbError(error) };
  refresh(eventId);
  const told = emailing.length ? await emailLeftOut(eventId, emailing) : "";
  const goTo = leftOut.length ? `/dashboard/events/${eventId}/conferences/meetings` : undefined;
  if (!moved?.moved) return { ok: true, message: `Meeting times saved.${told}`, goTo };
  if (moved?.moved) {
    const n = moved.moved === 1 ? "Your booked meeting" : `Your ${moved.moved} booked meetings`;
    return {
      ok: true,
      message: moved.allSent
        ? `Meeting times saved. ${n} moved to the new day at the same time, and we emailed each person an updated calendar invite.${told}`
        : `Meeting times saved. ${n} moved to the new day at the same time. We couldn't email everyone, so please check Your meetings and let them know.${told}`,
      goTo,
    };
  }
  return { ok: true, message: "Meeting times saved." };
}

/** Days off (weekly hours only): holidays and breaks when no meetings are booked. Saved on their own tab. */
export async function saveDaysOff(eventId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const closed = [...new Set(formData.getAll("closedDate").map(String).filter(Boolean))].sort();
  if (closed.some((d) => !DATE.test(d))) return { error: "Pick a date for each day off, or remove it." };
  if (closed.length > 60) return { error: "Add up to 60 days off." };
  const supabase = await createClient();
  const { settings, error: loadError } = await loadConferenceSettings(supabase, eventId);
  if (loadError) return { error: "Only the host can change days off." };
  if (settings.schedule !== "weekly") return { error: "Days off are for weekly hours. Save your weekly hours first." };
  const error = await saveSettings(eventId, { closed_dates: closed });
  if (error) return { error: friendlyDbError(error) };
  refresh(eventId);
  // Booked meetings on a new day off stay booked: say who, so they can be moved (decisions 2026-11-08).
  const { data: ev } = await supabase.from("events").select("timezone").eq("id", eventId).maybeSingle();
  const { data: rows } = await supabase
    .from("conference_bookings")
    .select("starts_at, child_name, parents")
    .eq("event_id", eventId)
    .gte("starts_at", new Date().toISOString());
  const tz = ev?.timezone ?? "America/Chicago";
  const onDaysOff = ((rows ?? []) as { starts_at: string; child_name: string | null; parents: { name: string }[] }[]).filter((b) =>
    closed.includes(utcToZonedDate(b.starts_at, tz)),
  );
  if (onDaysOff.length) {
    return {
      ok: true,
      message: `Days off saved. ${onDaysOff.length === 1 ? "1 booked meeting is" : `${onDaysOff.length} booked meetings are`} on a day off: ${onDaysOff
        .map((b) => `${b.child_name || b.parents[0]?.name || "Someone"}, ${formatDate(utcToZonedDate(b.starts_at, tz), { year: undefined })}`)
        .join("; ")}. They're still booked: reschedule or cancel them on Your meetings.`,
    };
  }
  return { ok: true, message: "Days off saved." };
}

/**
 * Step 2: any mix of in person (the school and a room), video (one link with
 * a waiting room, or the teacher sends their own), and phone calls (the
 * teacher calls the number the family gives). With more than one, each family
 * picks when they book. The school goes on the event, so the public page and
 * calendar invites show it; a conference with no in-person meetings has no address.
 */
export async function saveMeetingPlace(eventId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const picked = formData.getAll("modes").filter(isMode);
  const modes = MODES.map((m) => m.value).filter((m) => picked.includes(m));
  if (!modes.length) return { error: "Choose at least one way to meet.", fieldErrors: { modes: "Choose at least one" } };
  // Phone calls need nothing here: families give the number to call when they book.
  const inPerson = modes.includes("in_person");
  const video = modes.includes("video");

  const room = String(formData.get("room") ?? "").trim();
  // A pasted Zoom invitation counts: keep just its link.
  const pasted = String(formData.get("videoLink") ?? "");
  const link = linkFrom(pasted);
  const passcode = String(formData.get("videoPasscode") ?? "").trim() || passcodeFrom(pasted) || "";
  const waitingRoom = formData.get("waitingRoom") === "on";
  // One pasted link for everyone ("add it to each invite" is gone: decisions 2026-11-07).
  const ownLink = false;
  const venueName = String(formData.get("venueName") ?? "").trim().slice(0, 120);
  const venueAddress = String(formData.get("venueAddress") ?? "").trim();
  const placeId = String(formData.get("venuePlaceId") ?? "").trim().slice(0, 300);
  const coord = (k: string, limit: number) => {
    const n = Number(formData.get(k));
    return formData.get(k) && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
  };
  const fieldErrors: Record<string, string> = {};
  if (inPerson && !venueAddress) fieldErrors.venueAddress = "Add the address.";
  if (venueAddress.length > 300) fieldErrors.venueAddress = "Keep the address under 300 characters.";
  if (inPerson && !room) fieldErrors.room = "Add your room and how to find it.";
  if (room.length > 200) fieldErrors.room = "Keep this under 200 characters.";
  // The setup step saves what's there (the place, the room, the ways to meet) while the link is still
  // to come; the step isn't done until it's added (decisions 2026-11-08). Meeting setup saves all or nothing.
  const partial = formData.get("partial") === "1";
  const linkOk = /^https:\/\/\S+$/.test(link) && link.length <= 500;
  if (video) {
    if (!linkOk && !(partial && !link)) fieldErrors.videoLink = "Paste your meeting link. It starts with https://";
    if (passcode.length > 50 || /\s/.test(passcode)) fieldErrors.videoPasscode = "Enter just the passcode, with no spaces.";
    if (!waitingRoom && !partial) fieldErrors.waitingRoom = "Set up your meeting with a waiting room, then tick this.";
  }
  if (partial) {
    // A missing address or room doesn't stop the rest saving in the setup step (the step says what's missing).
    if (!venueAddress) delete fieldErrors.venueAddress;
    if (!room) delete fieldErrors.room;
  }
  if (Object.keys(fieldErrors).length) {
    return { error: Object.values(fieldErrors)[0], fieldErrors };
  }

  const supabase = await createClient();
  const school = await supabase
    .from("events")
    .update({
      venue_name: inPerson ? venueName || null : null,
      venue_address: inPerson ? venueAddress : "",
      venue_place_id: inPerson ? placeId || null : null,
      venue_lat: inPerson && placeId ? coord("venueLat", 90) : null,
      venue_lng: inPerson && placeId ? coord("venueLng", 180) : null,
    })
    .eq("id", eventId)
    .select("id");
  if (school.error) return { error: friendlyDbError(school.error) };
  if (!school.data?.length) return { error: "Only the conference's host can change it." };

  const place = {
    room: inPerson ? room : null,
    own_link: ownLink,
    video_link: video && linkOk ? link : null,
    waiting_room_confirmed: video && !ownLink && waitingRoom,
  };
  let error = await saveSettings(eventId, { ...place, meeting_modes: modes, video_passcode: video && !ownLink && passcode ? passcode : null });
  // Before the passcode update (20261229000000): save the rest, and say the passcode needs it.
  const noPasscode = isSchemaError(error);
  if (noPasscode) error = await saveSettings(eventId, { ...place, meeting_modes: modes });
  // Before the several-ways-to-meet update (20261213000000), only one way, or in person and video, can be saved.
  if (isSchemaError(error)) {
    const single = legacyMode(modes);
    if (!single) return { error: "Offering phone calls alongside other ways needs a database update first. Please write to us." };
    error = await saveSettings(eventId, { ...place, meeting_mode: single });
  }
  if (error) return { error: friendlyDbError(error) };
  refresh(eventId);
  if (noPasscode && passcode) return { ok: true, message: "Saved, except the passcode: that needs a database update first. Please write to us." };
  return { ok: true, message: "Saved." };
}

/** The old single setting for a list of ways, when it can say it. */
function legacyMode(modes: Mode[]) {
  if (modes.length === 1) return modes[0];
  if (modes.length === 2 && modes.includes("in_person") && modes.includes("video")) return "either";
  return null;
}

/** Who did it, for the emails: null when it's the teacher (the conference's creator) themself. */
async function actorName(user: { id: string; email?: string | null }, teacherEmail: string | null) {
  if (user.email && teacherEmail && user.email.toLowerCase() === teacherEmail.toLowerCase()) return null;
  const { data } = await createAdminClient().from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  return data?.full_name?.trim() || user.email || null;
}

/** The host's or co-host's optional note for the family's email (blank: none). */
function readNote(formData: FormData) {
  return String(formData.get("note") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 1000);
}

/**
 * The teacher or a co-host cancels one family's meeting: the time opens up
 * again, the booking (the child's name and the family's details) is deleted,
 * and each parent is emailed (with their note, if they wrote one) so the
 * invite comes off their calendar.
 */
export async function cancelMeeting(eventId: string, bookingId: string, _prev?: ActionState, formData?: FormData): Promise<ActionState> {
  const user = await requireUser();
  const text = formData ? readNote(formData) : "";
  const supabase = await createClient();
  // Only the event's hosts and co-hosts can see (and delete) its bookings.
  const { data: seen } = await supabase.from("conference_bookings").select("id").eq("id", bookingId).eq("event_id", eventId).maybeSingle();
  if (!seen) return { error: "You don't have permission to do that." };
  const admin = createAdminClient();
  const { data: booking } = await withCallPhone((columns) => admin.from("conference_bookings").select(columns).eq("id", bookingId).single());
  const { data: deleted, error } = await supabase.from("conference_bookings").delete().eq("id", bookingId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!deleted?.length) return { error: "You don't have permission to do that." };

  let emailed = false;
  const conf = await loadConference({ id: eventId });
  if (booking && conf) {
    const b = booking as unknown as Booking;
    const origin = await getOrigin();
    const link = `${origin}/e/${conf.event.slug}/book`;
    const actor = await actorName(user, conf.teacher.email);
    const note: OrganizerNote | null = text ? { from: actor ?? conf.teacher.name, text } : null;
    emailed = true;
    for (const [i, p] of b.parents.entries()) {
      if (i) await pause();
      const message = await bookingEmail("canceled", b, conf.event, conf.settings, conf.teacher, link, p, true, note);
      emailed = (await sendEmail({ to: p.email, ...message, eventId: conf.event.id })) && emailed;
    }
    // Takes it off the teacher's own calendar too.
    await emailTeacher("canceled", b, conf, origin, true, actor);
    revalidatePath(`/e/${conf.event.slug}/book`);
  }
  refresh(eventId);
  // The booking is gone once canceled, so if the email didn't go out, the message keeps how to reach them (decisions 2026-11-07).
  const who = conf && isMeeting(conf.event.event_type) ? "them" : "the family";
  const contacts = ((booking as unknown as Booking | null)?.parents ?? []).map((p) => `${p.name} (${[p.email, formatPhone(p.phone ?? null)].filter(Boolean).join(", ")})`);
  // Didn't go out: shown as a message that stays in the window (not a toast that fades), with how to reach them.
  if (!emailed)
    return { error: `Canceled, and the time is open again. We couldn't email ${who}, so please let them know: ${contacts.join("; ") || "their details weren't found"}.` };
  return { ok: true, message: `Canceled. We emailed ${who}, and the time is open again.` };
}

/**
 * The teacher or a co-host moves one meeting: to an open time ("slot", as
 * sent), or a day and time they type in ("date" and "time", in the event's
 * time zone). reschedule_conference_booking() checks it's one of the event's
 * days, in the future, and doesn't overlap another meeting. Each parent gets
 * an updated calendar invite (with the note, if there is one), and so does
 * the teacher.
 */
export async function rescheduleMeeting(eventId: string, bookingId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const conf = await loadConference({ id: eventId });
  if (!conf) return { error: "We couldn't find this event." };
  const how = String(formData.get("how") ?? "");
  let startsAt: string;
  if (how === "custom") {
    const date = String(formData.get("date") ?? "");
    const time = String(formData.get("time") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick a day." };
    if (!/^\d{2}:\d{2}$/.test(time)) return { error: "Enter a time." };
    startsAt = zonedToUtc(date, time, conf.event.timezone).toISOString();
  } else {
    startsAt = String(formData.get("slot") ?? "");
    if (!startsAt || Number.isNaN(Date.parse(startsAt))) return { error: "Pick a new time." };
  }
  const text = readNote(formData);

  const supabase = await createClient();
  const { error } = await supabase.rpc("reschedule_conference_booking", { p_id: bookingId, p_starts_at: startsAt });
  if (error) return { error: error.code === "P0001" || error.code === "42501" ? error.message : friendlyDbError(error) };

  const admin = createAdminClient();
  const { data: row } = await withCallPhone((columns) =>
    admin.from("conference_bookings").select(`${columns}, access_token`).eq("id", bookingId).single(),
  );
  const b = row as unknown as (Booking & { access_token: string }) | null;
  refresh(eventId);
  revalidatePath(`/e/${conf.event.slug}/book`, "layout");
  if (!b) return { ok: true, message: "Moved." };
  const when = meetingWhen(b.starts_at, conf.settings.meeting_minutes, conf.event.timezone);
  const origin = await getOrigin();
  const actor = await actorName(user, conf.teacher.email);
  const note: OrganizerNote | null = text ? { from: actor ?? conf.teacher.name, text } : null;
  const link = bookingLink(origin, conf.event.slug, b.access_token);
  let emailed = true;
  for (const [i, p] of b.parents.entries()) {
    if (i) await pause();
    const message = await bookingEmail("rescheduled", b, conf.event, conf.settings, conf.teacher, link, p, true, note);
    emailed = (await sendEmail({ to: p.email, ...message, eventId: conf.event.id })) && emailed;
  }
  await emailTeacher("rescheduled", b, conf, origin, true, actor);
  const them = b.child_name ? "the family" : "them";
  return {
    ok: true,
    message: emailed
      ? `Moved to ${when}. We emailed ${them} an updated calendar invite.`
      : `Moved to ${when}, but we couldn't email ${them}. Please let them know.`,
  };
}

/** Once a meeting has started, the teacher marks it Met or No-show (null undoes it). */
export async function setMeetingOutcome(eventId: string, bookingId: string, outcome: "met" | "no_show" | null): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_conference_outcome", { p_id: bookingId, p_outcome: outcome });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}/conferences/meetings`);
  return { ok: true };
}


/**
 * The upcoming booked meetings new times leave out that the saved times didn't (so meetings already
 * outside, from an earlier change or a day off, aren't counted, or emailed, again).
 */
async function newlyLeftOut(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  tz: string,
  before: Parameters<typeof bookingsOutside>[1],
  after: Parameters<typeof bookingsOutside>[1],
) {
  const { data } = await supabase
    .from("conference_bookings")
    .select("id, starts_at, child_name, parents")
    .eq("event_id", eventId)
    .gte("starts_at", new Date().toISOString());
  const rows = (data ?? []) as { id: string; starts_at: string; child_name: string | null; parents: { name: string }[] }[];
  const times = rows.map((b) => ({ who: b.id, date: utcToZonedDate(b.starts_at, tz), time: utcToZonedTime(b.starts_at, tz) }));
  const already = new Set(bookingsOutside(times, before).map((b) => b.who));
  return bookingsOutside(times, after)
    .filter((b) => !already.has(b.who))
    .map((b) => {
      const row = rows.find((r) => r.id === b.who)!;
      return { id: row.id, name: row.child_name || row.parents[0]?.name || "Someone", time: b.time };
    });
}

/** When the page didn't show them (someone booked since it loaded): who, and what to do. */
function leftOutMessage(out: { name: string; time: string }[]) {
  return `${out.length === 1 ? "1 booked meeting doesn't" : `${out.length} booked meetings don't`} fit these times: ${out.map((b) => `${b.name} at ${displayTime(b.time)}`).join(", ")}. Someone may have just booked: reload the page to choose what happens to them (your changes here aren't saved yet).`;
}

/**
 * Booked meetings keep an event to one day, so "Need more times? Make a weekly copy" makes a new
 * draft with the same setup (length, breaks, where you'll meet) set to every week, without the
 * bookings, and opens Meeting times to pick the days and hours (decisions 2026-11-07, finding 3).
 */
export async function copyAsWeekly(eventId: string): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const [{ data: ev }, { settings }] = await Promise.all([
    supabase
      .from("events")
      .select("organization_id, event_type, name, slug, timezone, starts_on, window_start, window_end, venue_name, venue_address, venue_place_id, venue_lat, venue_lng, ask_child_name")
      .eq("id", eventId)
      .maybeSingle(),
    loadConferenceSettings(supabase, eventId),
  ]);
  if (!ev) redirect(`/dashboard/events/${eventId}`);
  // From today (or the original day, if later), for twelve weeks: never weekly hours that are already over.
  const today = utcToZonedDate(new Date().toISOString(), ev.timezone);
  const first = ev.starts_on > today ? ev.starts_on : today;
  const last = new Date(Date.parse(`${first}T12:00:00Z`) + 83 * 86_400_000).toISOString().slice(0, 10);
  const { data: copy, error } = await supabase
    .from("events")
    .insert({
      organization_id: ev.organization_id,
      event_type: ev.event_type,
      name: `${ev.name} (every week)`.slice(0, 120),
      slug: `${ev.slug}-weekly-${Math.random().toString(36).slice(2, 6)}`,
      timezone: ev.timezone,
      starts_on: first,
      ends_on: last,
      window_start: zonedToUtc(first, utcToZonedTime(ev.window_start, ev.timezone), ev.timezone).toISOString(),
      window_end: zonedToUtc(last, utcToZonedTime(ev.window_end, ev.timezone), ev.timezone).toISOString(),
      venue_name: ev.venue_name,
      venue_address: ev.venue_address ?? "",
      venue_place_id: ev.venue_place_id,
      venue_lat: ev.venue_lat,
      venue_lng: ev.venue_lng,
      // A teacher who doesn't ask for children's names doesn't start asking again.
      ...(ev.ask_child_name === false ? { ask_child_name: false } : {}),
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !copy) redirect(`/dashboard/events/${eventId}/conferences?tab=times&copy=failed`);
  const settingsError = await saveSettings(copy.id, {
    meeting_minutes: settings.meeting_minutes,
    gap_minutes: settings.gap_minutes,
    breaks: settings.breaks,
    meeting_modes: settings.meeting_modes ?? null,
    room: settings.room,
    // The video meeting was set up for the old day: the copy asks for it to be checked again.
    video_link: settings.video_link,
    video_passcode: settings.video_passcode ?? null,
    waiting_room_confirmed: false,
    schedule: "weekly",
    weekly_hours: [],
  });
  if (settingsError) console.error("Copying meeting settings failed", settingsError.code, settingsError.message);
  revalidatePath("/dashboard");
  redirect(`/dashboard/events/${copy.id}/conferences/times`);
}

/**
 * After saving new times, when the organizer chose to email them: each person on a booked meeting the
 * change left out gets a link to pick a new time (it stays booked meanwhile). Never twice: the booking
 * notes when it was asked. Returns a sentence for the saved message.
 */
async function emailLeftOut(eventId: string, ids: string[]) {
  if (!ids.length) return "";
  const conf = await loadConference({ id: eventId });
  if (!conf) return "";
  const admin = createAdminClient();
  const { data } = await admin
    .from("conference_bookings")
    .select(`${BOOKING_COLUMNS}, access_token`)
    .eq("event_id", eventId)
    .in("id", ids)
    .is("reschedule_requested_at", null);
  const rows = (data ?? []) as unknown as (Booking & { access_token: string })[];
  if (!rows.length) return "";
  const origin = await getOrigin();
  let sent = 0;
  const failed: string[] = [];
  for (const b of rows) {
    const link = bookingLink(origin, conf.event.slug, b.access_token);
    let any = false;
    for (const p of b.parents) {
      if (sent || failed.length) await pause();
      const message = pickNewTimeEmail(b, conf.event, conf.settings, conf.teacher, link, p);
      // Replies go to the organizer ("If none of the open times work, reply to this email").
      if (await sendEmail({ to: p.email, ...message, eventId, ...(conf.teacher.email ? { replyTo: conf.teacher.email } : {}) })) {
        sent++;
        any = true;
      } else failed.push(`${p.name} (${p.email})`);
    }
    if (any) await admin.from("conference_bookings").update({ reschedule_requested_at: new Date().toISOString() }).eq("id", b.id);
  }
  return `${sent ? ` We emailed ${sent === 1 ? "1 person" : `${sent} people`} a link to pick a new time.` : ""}${
    failed.length ? ` We couldn't email ${failed.join(", ")}, so please let them know.` : ""
  }`;
}

/** The email shown when every time is booked (optional; empty shows none). */
export async function saveMeetingContact(eventId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const email = String(formData.get("contactEmail") ?? "").trim();
  if (email && (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return { error: "Enter an email address, like name@example.com, or leave it blank." };
  const error = await saveSettings(eventId, { contact_email: email || null });
  if (error) return { error: isSchemaError(error) ? "A contact email needs a database update first. Please write to us." : friendlyDbError(error) };
  refresh(eventId);
  return { ok: true, message: "Saved." };
}

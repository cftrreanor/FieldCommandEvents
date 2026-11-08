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
import { bookingEmail, bookingLink, emailTeacher, meetingWhen, withCallPhone, type Booking, type OrganizerNote } from "@/lib/conference-bookings";
import { getOrigin } from "@/lib/data";
import { pause, sendEmail } from "@/lib/email";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { utcToZonedDate, utcToZonedTime, zonedToUtc } from "@/lib/time";
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

/** Step 1: one day or weekly hours, meeting length, the gap between meetings and any breaks. */
export async function saveMeetingTimes(eventId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const meeting = Number(formData.get("meetingMinutes"));
  const gap = Number(formData.get("gapMinutes") ?? 0);
  if (!(MEETING_LENGTHS as readonly number[]).includes(meeting)) return { error: "Pick how long each meeting is." };
  if (!(GAP_LENGTHS as readonly number[]).includes(gap)) return { error: "Pick the time between meetings." };

  const starts = formData.getAll("breakStart").map(String);
  const minutes = formData.getAll("breakMinutes").map(String);
  const labels = formData.getAll("breakLabel").map(String);
  const breaks: ConferenceBreak[] = [];
  for (let i = 0; i < starts.length; i++) {
    if (!starts[i] && !minutes[i]) continue;
    const m = Number(minutes[i]);
    if (!TIME.test(starts[i]) || !Number.isInteger(m) || m < 5 || m > 240) {
      return { error: "Give each break a start time and a length of 5 to 240 minutes, or remove it." };
    }
    breaks.push({ start: starts[i], minutes: m, label: labels[i]?.trim().slice(0, 60) || "Break" });
  }
  if (breaks.length > 8) return { error: "Add up to 8 breaks." };

  const supabase = await createClient();
  const [{ data: event }, current, booked] = await Promise.all([
    supabase.from("events").select("timezone, starts_on").eq("id", eventId).maybeSingle(),
    loadConferenceSettings(supabase, eventId),
    conferenceBookedCount(supabase, eventId),
  ]);
  if (!event) return { error: "Only the conference's host can change it." };
  const weekly = formData.get("schedule") === "weekly";
  const was = current.settings.schedule;
  // Families' meetings are kept as booked: switching between a day and weekly hours waits until they're canceled.
  if (booked > 0 && (weekly ? "weekly" : "one_day") !== was) {
    return {
      error:
        was === "weekly"
          ? "Families have booked weekly meetings. Cancel them on your Meetings page first, or make a new conference for one day."
          : "Families have booked your conference day. Cancel those meetings on your Meetings page first, or make a new conference for weekly hours.",
    };
  }
  if (current.legacy && weekly) return { error: "Weekly hours need a database update first. Please write to us." };
  // Booked meetings the new times leave out: they stay booked, but saving needs the organizer's tick
  // (the page names them first; decisions 2026-11-07, finding 2).
  if (booked > 0 && formData.get("confirmOutside") !== "on") {
    const left = await bookingsLeftOut(supabase, eventId, event.timezone, formData, weekly, { meeting_minutes: meeting, gap_minutes: gap, breaks });
    if (left) return { error: left };
  }
  const common = {
    meeting_minutes: meeting,
    gap_minutes: gap,
    breaks: breaks.sort((a, b) => a.start.localeCompare(b.start)),
    times_saved_at: new Date().toISOString(),
  };

  if (weekly) {
    const days = formData.getAll("weeklyDay").map(String);
    const froms = formData.getAll("weeklyStart").map(String);
    const tos = formData.getAll("weeklyEnd").map(String);
    const hours: WeeklyRange[] = [];
    for (let i = 0; i < days.length; i++) {
      const d = Number(days[i]);
      if (!Number.isInteger(d) || d < 0 || d > 6 || !TIME.test(froms[i] ?? "") || !TIME.test(tos[i] ?? "")) {
        return { error: "Give each block of weekly hours a day, a start, and an end." };
      }
      if (tos[i] <= froms[i]) return { error: `Your ${WEEKDAYS[d]} hours have to end after they start.` };
      hours.push({ day: d, start: froms[i], end: tos[i] });
    }
    if (!hours.length) return { error: "Add your weekly hours." };
    if (hours.length > 21) return { error: "Add up to 21 blocks of weekly hours." };
    const from = String(formData.get("weeklyFrom") ?? "");
    const to = String(formData.get("weeklyTo") ?? "");
    if (!DATE.test(from) || !DATE.test(to)) return { error: "Pick your first and last day." };
    if (to < from) return { error: "Your last day has to be on or after your first day." };
    if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) return { error: "Weekly hours can run for up to a year. Pick an earlier last day." };
    const notice = Number(formData.get("minNotice"));
    const ahead = Number(formData.get("maxAhead"));
    if (!(NOTICE_HOURS as readonly number[]).includes(notice)) return { error: "Pick how much notice families give." };
    if (!(AHEAD_DAYS as readonly number[]).includes(ahead)) return { error: "Pick how far ahead families can book." };

    // Settings first (weekly hours may run more than one day), then the event's days.
    const error = await saveSettings(eventId, {
      ...common,
      schedule: "weekly",
      weekly_hours: sortWeekly(hours),
      min_notice_hours: notice,
      max_days_ahead: ahead,
    });
    if (error) return { error: friendlyDbError(error) };
    const opens = hours.map((h) => h.start).sort()[0];
    const closes = hours.map((h) => h.end).sort().at(-1)!;
    const { error: daysError } = await supabase.rpc("reschedule_event", {
      p_event_id: eventId,
      p_starts_on: from,
      p_ends_on: to,
      p_window_start: zonedToUtc(from, opens, event.timezone).toISOString(),
      p_window_end: zonedToUtc(to, closes, event.timezone).toISOString(),
      p_timezone: event.timezone,
    });
    if (daysError) return { error: friendlyDbError(daysError) };
    refresh(eventId);
    return { ok: true, message: "Meeting times saved." };
  }

  // Changed the day or hours here: move the event too (as Edit details does).
  // Booked meetings move with the day, and each family is emailed.
  let moved: Awaited<ReturnType<typeof emailMovedMeetings>> | null = null;
  const day = formData.get("conferenceDay");
  if (day === null && was === "weekly") return { error: "Pick your conference day." };
  if (day !== null) {
    const date = String(day);
    const from = String(formData.get("startTime") ?? "");
    const to = String(formData.get("endTime") ?? "");
    if (!DATE.test(date)) return { error: "Pick the conference day." };
    if (!TIME.test(from) || !TIME.test(to)) return { error: "Pick when your first meeting starts and your last one ends." };
    if (to <= from) return { error: "Your last meeting has to end after the first one starts." };
    const { error } = await supabase.rpc("reschedule_event", {
      p_event_id: eventId,
      p_starts_on: date,
      p_ends_on: date,
      p_window_start: zonedToUtc(date, from, event.timezone).toISOString(),
      p_window_end: zonedToUtc(date, to, event.timezone).toISOString(),
      p_timezone: event.timezone,
    });
    if (error) return { error: friendlyDbError(error) };
    if (date !== event.starts_on && was === "one_day") moved = await emailMovedMeetings(eventId);
  }

  const error = await saveSettings(eventId, current.legacy ? common : { ...common, schedule: "one_day" });
  if (error) return { error: friendlyDbError(error) };
  refresh(eventId);
  if (moved?.moved) {
    const n = moved.moved === 1 ? "Your booked meeting" : `Your ${moved.moved} booked meetings`;
    return {
      ok: true,
      message: moved.allSent
        ? `Meeting times saved. ${n} moved to the new day at the same time, and we emailed each family an updated calendar invite.`
        : `Meeting times saved. ${n} moved to the new day at the same time. We couldn't email every family, so please check your Meetings page and let them know.`,
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
  const ownLink = video && formData.get("linkSource") === "own";
  const venueName = String(formData.get("venueName") ?? "").trim().slice(0, 120);
  const venueAddress = String(formData.get("venueAddress") ?? "").trim();
  const placeId = String(formData.get("venuePlaceId") ?? "").trim().slice(0, 300);
  const coord = (k: string, limit: number) => {
    const n = Number(formData.get(k));
    return formData.get(k) && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
  };
  const fieldErrors: Record<string, string> = {};
  if (inPerson && !venueAddress) fieldErrors.venueAddress = "Add your school's address.";
  if (venueAddress.length > 300) fieldErrors.venueAddress = "Keep the address under 300 characters.";
  if (inPerson && !room) fieldErrors.room = "Add your room and how to find it.";
  if (room.length > 200) fieldErrors.room = "Keep this under 200 characters.";
  if (video && !ownLink) {
    if (!/^https:\/\/\S+$/.test(link) || link.length > 500) fieldErrors.videoLink = "Paste your meeting link. It starts with https://";
    if (passcode.length > 50 || /\s/.test(passcode)) fieldErrors.videoPasscode = "Enter just the passcode, with no spaces.";
    if (!waitingRoom) fieldErrors.waitingRoom = "Set up your meeting with a waiting room, then tick this.";
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
    video_link: video && !ownLink ? link : null,
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
  return {
    ok: true,
    message: emailed
      ? `Canceled. We emailed ${who}, and the time is open again.`
      : `Canceled, and the time is open again. We couldn't email ${who}, so please let them know: ${contacts.join("; ") || "their details weren't found"}.`,
  };
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

/** More options: phone calls on or off. The other ways to meet stay as they are. */
export async function saveMeetingPhone(eventId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { settings, saved } = await loadConferenceSettings(supabase, eventId);
  const now: Mode[] = (saved ? (settings.meeting_modes ?? []) : []).filter((m) => m !== "phone");
  const modes = MODES.map((m) => m.value).filter((m) => now.includes(m) || (m === "phone" && formData.get("phone") === "on"));
  if (!modes.length) return { error: "Choose at least one way to meet. Add in person or video on Where you'll meet first." };
  const error = await saveSettings(eventId, { meeting_modes: modes });
  if (error) return { error: friendlyDbError(error) };
  refresh(eventId);
  return { ok: true, message: "Saved." };
}

/** "2 booked meetings don't fit these times…", when the new times leave any out, or null. */
async function bookingsLeftOut(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  tz: string,
  formData: FormData,
  weekly: boolean,
  lengths: { meeting_minutes: number; gap_minutes: number; breaks: ConferenceBreak[] },
) {
  const [{ data }, { data: ev }] = await Promise.all([
    supabase.from("conference_bookings").select("starts_at, child_name, parents").eq("event_id", eventId),
    supabase.from("events").select("starts_on, window_start, window_end").eq("id", eventId).maybeSingle(),
  ]);
  const booked = ((data ?? []) as { starts_at: string; child_name: string | null; parents: { name: string }[] }[]).map((b) => ({
    who: b.child_name || b.parents[0]?.name || "Someone",
    date: utcToZonedDate(b.starts_at, tz),
    time: utcToZonedTime(b.starts_at, tz),
  }));
  const days = formData.getAll("weeklyDay").map(Number);
  const froms = formData.getAll("weeklyStart").map(String);
  const tos = formData.getAll("weeklyEnd").map(String);
  const out = bookingsOutside(booked, {
    schedule: weekly ? "weekly" : "one_day",
    day: String(formData.get("conferenceDay") ?? ev?.starts_on ?? ""),
    from: String(formData.get("startTime") ?? (ev ? utcToZonedTime(ev.window_start, tz) : "")),
    to: String(formData.get("endTime") ?? (ev ? utcToZonedTime(ev.window_end, tz) : "")),
    weekly: days.map((d, i) => ({ day: d, start: froms[i], end: tos[i] })),
    firstDay: String(formData.get("weeklyFrom") ?? ""),
    lastDay: String(formData.get("weeklyTo") ?? ""),
    lengths,
  });
  if (!out.length) return null;
  return `${out.length === 1 ? "1 booked meeting doesn't" : `${out.length} booked meetings don't`} fit these times: ${out.map((b) => `${b.who} at ${displayTime(b.time)}`).join(", ")}. Tick "Save anyway" to keep them booked and save, then reschedule or cancel them on Your meetings.`;
}

/**
 * Booked meetings keep an event to one day, so "Need more times? Make a weekly copy" makes a new
 * draft with the same setup (length, breaks, where you'll meet) set to every week, without the
 * bookings, and opens More options to pick the days and hours (decisions 2026-11-07, finding 3).
 */
export async function copyAsWeekly(eventId: string): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const [{ data: ev }, { settings }] = await Promise.all([
    supabase
      .from("events")
      .select("organization_id, event_type, name, slug, timezone, starts_on, window_start, window_end, venue_name, venue_address, venue_place_id, venue_lat, venue_lng")
      .eq("id", eventId)
      .maybeSingle(),
    loadConferenceSettings(supabase, eventId),
  ]);
  if (!ev) redirect(`/dashboard/events/${eventId}`);
  const { data: copy, error } = await supabase
    .from("events")
    .insert({
      organization_id: ev.organization_id,
      event_type: ev.event_type,
      name: `${ev.name} (every week)`.slice(0, 120),
      slug: `${ev.slug}-weekly-${Math.random().toString(36).slice(2, 6)}`,
      timezone: ev.timezone,
      starts_on: ev.starts_on,
      ends_on: ev.starts_on,
      window_start: ev.window_start,
      window_end: ev.window_end,
      venue_name: ev.venue_name,
      venue_address: ev.venue_address ?? "",
      venue_place_id: ev.venue_place_id,
      venue_lat: ev.venue_lat,
      venue_lng: ev.venue_lng,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !copy) redirect(`/dashboard/events/${eventId}/conferences?tab=times&copy=failed`);
  await saveSettings(copy.id, {
    meeting_minutes: settings.meeting_minutes,
    gap_minutes: settings.gap_minutes,
    breaks: settings.breaks,
    meeting_modes: settings.meeting_modes ?? null,
    room: settings.room,
    video_link: settings.video_link,
    video_passcode: settings.video_passcode ?? null,
    waiting_room_confirmed: settings.waiting_room_confirmed,
    schedule: "weekly",
    weekly_hours: [],
  });
  revalidatePath("/dashboard");
  redirect(`/dashboard/events/${copy.id}/conferences/options`);
}

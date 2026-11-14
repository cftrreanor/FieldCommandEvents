import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { getOrigin } from "@/lib/data";
import { pause, sendEmail } from "@/lib/email";
import { bookingEmail, bookingLink, withCallPhone, type Booking } from "@/lib/conference-bookings";
import { loadConferenceSettings } from "@/lib/conference-settings";
import { ADULTS, otherAdultNames, parentEmail, parentLink, type Child } from "@/lib/parents";
import { runRetention } from "@/lib/retention";
import { createAdminClient } from "@/lib/supabase/server";
import { isSchemaError } from "@/lib/schema-check";
import { loadCalendarEntries, sendItemsReminder, sendShiftReminder } from "@/lib/volunteer-emails";
import { sendVolunteerDigests } from "@/lib/volunteer-digest";
import { utcToZonedDate } from "@/lib/time";
import { registrationIsOpen } from "@/lib/bands";
import { deliverBandInvites, type InviteEvent } from "@/lib/band-invite-send";

// Once a day (vercel.json): remind parents to bring their photo ID the day
// before a school visitor event, remind volunteers of their shifts (and what they're
// bringing) the day before, erase parent registrations 30 days after
// their event, volunteers 10 days after theirs, and old admin email records,
// and run the rest of the privacy policy's deletion schedule (lib/retention).
// Vercel calls it with the CRON_SECRET environment variable.

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  // Compared in constant time, so response timing can't reveal the secret bit by bit.
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Sentry expects a check-in every day and alerts if the job fails or never runs.
  return Sentry.withMonitor("daily-job", runDailyJob, {
    schedule: { type: "crontab", value: "0 15 * * *" },
    timezone: "UTC",
    checkinMargin: 60,
    maxRuntime: 10,
  });
}

async function runDailyJob() {
  const admin = createAdminClient();
  const started = Date.now();

  // Families' details 30 days after the event (names-free totals are kept first).
  const { data: purged, error: purgeError } = await admin.rpc("purge_parent_registrations");
  if (purgeError) console.error("purge_parent_registrations failed", purgeError);
  // Practice check-ins (the day before) don't count once an event's first day starts.
  const { error: practiceError } = await admin.rpc("clear_all_practice_parent_check_ins");
  if (practiceError && !isSchemaError(practiceError)) console.error("clear_all_practice_parent_check_ins failed", practiceError);
  // Conference bookings (children's names, parents' notes) 30 days after the conference.
  const { data: bookingsPurged, error: bookingPurgeError } = await admin.rpc("purge_conference_bookings");
  if (bookingPurgeError && !isSchemaError(bookingPurgeError)) console.error("purge_conference_bookings failed", bookingPurgeError);
  // Volunteers' details (and under-18 helpers) are deleted 10 days after the event,
  // after each adult's shift counts go into the account's volunteer history.
  const { data: volunteersPurged, error: volunteerPurgeError } = await admin.rpc("purge_volunteers");
  if (volunteerPurgeError) console.error("purge_volunteers failed", volunteerPurgeError);
  // The admin email log: 14 days for people without an account, 180 for everyone.
  const { data: emailsPurged, error: adminPurgeError } = await admin.rpc("purge_admin_records");
  if (adminPurgeError) console.error("purge_admin_records failed", adminPurgeError);
  const retention = await runRetention(admin);
  // Invitation send records (for the hourly limit) after a day.
  const { error: sendsPurgeError } = await admin.rpc("purge_invitation_sends");
  if (sendsPurgeError && !isSchemaError(sendsPurgeError)) console.error("purge_invitation_sends failed", sendsPurgeError);

  // Events starting tomorrow in their own time zone (look a day either side, then check).
  const shift = (days: number) => new Date(started + days * 86_400_000).toISOString().slice(0, 10);
  const { data: events, error: eventsError } = await admin
    .from("events")
    .select("id, slug, name, starts_on, ends_on, window_start, window_end, timezone, venue_name, venue_address")
    .eq("event_type", "school_visit")
    .eq("status", "published")
    .gte("starts_on", shift(0))
    .lte("starts_on", shift(2));
  if (eventsError) console.error("Daily job: events lookup failed", eventsError);
  const tomorrow = (events ?? []).filter((e) => {
    const local = utcToZonedDate(new Date(started).toISOString(), e.timezone);
    const next = new Date(`${local}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return e.starts_on === next.toISOString().slice(0, 10);
  });

  // Vercel sets this to the site's main address (the custom domain, once there is one).
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const origin = production ? `https://${production}` : await getOrigin();
  let reminded = 0;
  let unsent = 0;
  for (const event of tomorrow) {
    const { data: regs } = await admin
      .from("parent_registrations")
      .select(`id, parent_name, email, children, access_token, calendar_sequence, ${ADULTS}`)
      .eq("event_id", event.id)
      .is("reminded_at", null);
    for (const r of regs ?? []) {
      // Leave time to finish; whoever's left is counted as unsent.
      if (Date.now() - started > 270_000) {
        unsent++;
        continue;
      }
      const { subject, html, text } = await parentEmail(
        "reminder",
        { ...r, children: r.children as Child[], other_adults: otherAdultNames(r.adults) },
        event,
        parentLink(origin, event.slug, r.access_token),
      );
      if (await sendEmail({ to: r.email, subject, html, text, eventId: event.id })) {
        await admin.from("parent_registrations").update({ reminded_at: new Date().toISOString() }).eq("id", r.id);
        reminded++;
      } else {
        unsent++;
      }
      await pause();
    }
  }
  if (unsent) console.error(`Daily job: ${unsent} parent reminder(s) not sent`);

  // Parent-teacher conferences: remind every parent on each meeting that's
  // tomorrow in the conference's time zone (a conference day, or any day of
  // weekly hours).
  let conferencesReminded = 0;
  let conferencesUnsent = 0;
  const { data: confEvents } = await admin
    .from("events")
    .select("id, slug, name, event_type, starts_on, ends_on, timezone, venue_name, venue_address, created_by")
    .in("event_type", ["conference", "meeting"])
    .eq("status", "published")
    .lte("starts_on", shift(2))
    .gte("ends_on", shift(0));
  for (const event of confEvents ?? []) {
    const local = utcToZonedDate(new Date(started).toISOString(), event.timezone);
    const next = new Date(`${local}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const tomorrow = next.toISOString().slice(0, 10);
    const { data: due } = await withCallPhone((columns) =>
      admin
        .from("conference_bookings")
        .select(`${columns}, access_token`)
        .eq("event_id", event.id)
        .is("reminded_at", null)
        .gte("starts_at", new Date(started).toISOString())
        .lte("starts_at", new Date(started + 2 * 86_400_000).toISOString()),
    );
    const bookings = ((due ?? []) as unknown as (Booking & { access_token: string })[]).filter(
      (b) => utcToZonedDate(b.starts_at, event.timezone) === tomorrow,
    );
    if (!bookings.length) continue;
    const [{ settings: s }, { data: teacherRow }] = await Promise.all([
      loadConferenceSettings(admin, event.id),
      event.created_by ? admin.from("profiles").select("full_name, email").eq("id", event.created_by).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const teacher = { name: teacherRow?.full_name?.trim() || (event.event_type === "meeting" ? "Your organizer" : "Your teacher"), email: teacherRow?.email ?? null };
    for (const b of bookings) {
      if (Date.now() - started > 270_000) {
        conferencesUnsent++;
        continue;
      }
      let all = true;
      for (const p of b.parents) {
        const message = await bookingEmail("reminder", b, event, s, teacher, bookingLink(origin, event.slug, b.access_token), p);
        all = (await sendEmail({ to: p.email, ...message, eventId: event.id })) && all;
        await pause();
      }
      if (all) {
        await admin.from("conference_bookings").update({ reminded_at: new Date().toISOString() }).eq("id", b.id);
        conferencesReminded++;
      } else {
        conferencesUnsent++;
      }
    }
  }
  if (conferencesUnsent) console.error(`Daily job: ${conferencesUnsent} conference reminder(s) not sent`);

  // Volunteers: shifts that start tomorrow in their event's time zone, at published events.
  let volunteersReminded = 0;
  let volunteersUnsent = 0;
  const { data: soon, error: shiftsError } = await admin
    .from("shifts")
    .select("id, starts_at, events!inner(timezone, status)")
    .eq("events.status", "published")
    .gte("starts_at", new Date(started).toISOString())
    .lte("starts_at", new Date(started + 2 * 86_400_000).toISOString());
  if (shiftsError) console.error("Daily job: shifts lookup failed", shiftsError);
  const tomorrowShifts = ((soon ?? []) as unknown as { id: string; starts_at: string; events: { timezone: string } }[]).filter((sh) => {
    const tz = sh.events.timezone;
    const local = utcToZonedDate(new Date(started).toISOString(), tz);
    const next = new Date(`${local}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return utcToZonedDate(sh.starts_at, tz) === next.toISOString().slice(0, 10);
  });
  if (tomorrowShifts.length) {
    const { data: due, error: dueError } = await admin
      .from("volunteer_assignments")
      .select("id")
      .in("shift_id", tomorrowShifts.map((sh) => sh.id))
      .is("reminded_at", null);
    // Before 20261116000000_volunteer_reminders.sql there's nothing to track reminders with.
    if (dueError && !isSchemaError(dueError)) console.error("Daily job: volunteer lookup failed", dueError);
    const entries = await loadCalendarEntries((due ?? []).map((a) => a.id));
    const byPerson = new Map<string, typeof entries>();
    for (const e of entries) {
      const key = `${e.volunteer_email.toLowerCase()}|${e.event_name}`;
      byPerson.set(key, [...(byPerson.get(key) ?? []), e]);
    }
    for (const list of byPerson.values()) {
      if (Date.now() - started > 270_000) {
        volunteersUnsent += list.length;
        continue;
      }
      list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      if (await sendShiftReminder(list, list[0].timezone, origin)) {
        await admin
          .from("volunteer_assignments")
          .update({ reminded_at: new Date().toISOString() })
          .in("id", list.map((e) => e.assignment_id));
        volunteersReminded++;
      } else {
        volunteersUnsent++;
      }
      await pause();
    }
  }
  if (volunteersUnsent) console.error(`Daily job: ${volunteersUnsent} volunteer reminder(s) not sent`);

  // Items to bring: one reminder per person for published events that start tomorrow.
  let itemsReminded = 0;
  const today = new Date(started).toISOString().slice(0, 10);
  const { data: itemsDue, error: itemsError } = await admin
    .from("item_signups")
    .select(
      "id, note, volunteer_id, station_items(name, stations(name)), volunteers(full_name, email, access_token), events!inner(id, name, venue_name, timezone, starts_on, status)",
    )
    .eq("events.status", "published")
    .gte("events.starts_on", today)
    .lte("events.starts_on", new Date(started + 2 * 86_400_000).toISOString().slice(0, 10))
    .is("reminded_at", null);
  // Before 20261231000000_items_to_bring.sql there are no items.
  if (itemsError && !isSchemaError(itemsError)) console.error("Daily job: items lookup failed", itemsError);
  type ItemDue = {
    id: string;
    note: string | null;
    volunteer_id: string;
    station_items: { name: string; stations: { name: string } | null } | null;
    volunteers: { full_name: string; email: string | null; access_token: string } | null;
    events: { id: string; name: string; venue_name: string | null; timezone: string; starts_on: string };
  };
  const itemsByPerson = new Map<string, ItemDue[]>();
  for (const r of (itemsDue ?? []) as unknown as ItemDue[]) {
    const local = utcToZonedDate(new Date(started).toISOString(), r.events.timezone);
    const next = new Date(`${local}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    if (r.events.starts_on !== next.toISOString().slice(0, 10) || !r.volunteers?.email) continue;
    itemsByPerson.set(r.volunteer_id, [...(itemsByPerson.get(r.volunteer_id) ?? []), r]);
  }
  for (const list of itemsByPerson.values()) {
    if (Date.now() - started > 270_000) break;
    const { volunteers: v, events: ev } = list[0];
    const ok = await sendItemsReminder(
      list.map((r) => ({ name: r.station_items?.name ?? "An item", station: r.station_items?.stations?.name ?? "", note: r.note })),
      { name: v!.full_name, email: v!.email!, accessToken: v!.access_token, eventId: ev.id, eventName: ev.name, venueName: ev.venue_name },
      origin,
    );
    if (ok) {
      await admin
        .from("item_signups")
        .update({ reminded_at: new Date().toISOString() })
        .in("id", list.map((r) => r.id));
      itemsReminded++;
    }
    await pause();
  }

  // Band invitations that waited for registration's opening day: sent once it's open.
  const bandInvitesSent = Date.now() - started < 240_000 ? await sendScheduledBandInvites(admin, origin, started + 250_000) : 0;

  // Volunteer sign-up summaries for the people each event's hosts picked, then forget dropped sign-ups after a week.
  const volunteerSummaries = Date.now() - started < 270_000 ? await sendVolunteerDigests(admin, origin, started) : 0;
  const { error: droppedPurgeError } = await admin.rpc("purge_dropped_shifts");
  if (droppedPurgeError && !isSchemaError(droppedPurgeError)) console.error("purge_dropped_shifts failed", droppedPurgeError);

  return NextResponse.json({
    purged: purged ?? 0,
    bookingsPurged: bookingsPurged ?? 0,
    conferencesReminded,
    conferencesUnsent,
    volunteersPurged: volunteersPurged ?? 0,
    emailsPurged: emailsPurged ?? 0,
    ...retention,
    reminded,
    unsent,
    volunteersReminded,
    volunteersUnsent,
    itemsReminded,
    volunteerSummaries,
    bandInvitesSent,
  });
}

/** Invitations a host chose before registration opened: each event's, once its registration is open. */
async function sendScheduledBandInvites(admin: ReturnType<typeof createAdminClient>, origin: string, deadline: number) {
  const { data: waiting, error } = await admin
    .from("band_invitations")
    .select("email, invited_by, events(id, slug, name, status, event_type, timezone, starts_on, ends_on, venue_name, band_registration_open, band_registration_deadline, band_registration_opens_on)")
    .is("sent_at", null)
    .is("replaced_by", null)
    // Whatever day they were scheduled for: registration being open is what counts (it may have opened early).
    .not("scheduled_for", "is", null);
  if (error) {
    if (!isSchemaError(error)) console.error("Daily job: waiting band invitations lookup failed", error);
    return 0;
  }
  type Ev = InviteEvent & Parameters<typeof registrationIsOpen>[0];
  const byEvent = new Map<string, { event: Ev; emails: string[]; invitedBy: string | null }>();
  for (const row of (waiting ?? []) as unknown as { email: string; invited_by: string | null; events: Ev | null }[]) {
    if (!row.events || !registrationIsOpen(row.events)) continue;
    const entry = byEvent.get(row.events.id) ?? { event: row.events, emails: [], invitedBy: row.invited_by };
    entry.emails.push(row.email);
    byEvent.set(row.events.id, entry);
  }
  let sent = 0;
  for (const { event, emails, invitedBy } of byEvent.values()) {
    const { data: host } = invitedBy ? await admin.from("profiles").select("full_name").eq("id", invitedBy).maybeSingle() : { data: null };
    sent += await deliverBandInvites({ event, emails, reminder: false, host: host?.full_name ?? "The organizer", origin, stopAt: deadline });
  }
  return sent;
}

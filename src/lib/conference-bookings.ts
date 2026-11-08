import "server-only";
import { brand } from "@/lib/brand";
import { emailLayout, sendEmail, type CalendarInvite } from "@/lib/email";
import { buildIcs, type IcsEvent } from "@/lib/ics";
import { customWords, loadSystemEmail } from "@/lib/system-email-overrides";
import type { SystemEmailText } from "@/lib/system-emails";
import type { ConferenceSettings } from "@/lib/conferences";
import { formatPhone } from "@/lib/phone";
import { isSchemaError } from "@/lib/schema-check";
import { notificationEmails } from "@/lib/notify-recipients";
import { formatDate, formatTimeRange, utcToZonedDate } from "@/lib/time";

// Parent-teacher conferences: a family's booked meeting, and the emails each
// parent on it gets (supabase/migrations/20261124000000_conference_bookings.sql).
// Bookings are erased 30 days after the conference.

export type BookingParent = { name: string; email: string; phone: string | null };

export type Booking = {
  id: string;
  starts_at: string;
  /** Null when the teacher doesn't ask for the child's name (20261219000000). */
  child_name: string | null;
  parents: BookingParent[];
  meeting_mode: "in_person" | "video" | "phone";
  note: string | null;
  calendar_sequence: number;
  /** Phone calls: the number the teacher calls (read with withCallPhone). */
  call_phone?: string | null;
};

export type BookingEvent = {
  name: string;
  /** "meeting" (meetings say "meeting" where conferences say "conference"); conferences otherwise. */
  event_type?: string | null;
  timezone: string;
  venue_name: string | null;
  venue_address: string;
};

/** What the booking is called in a sentence: "conference", or "meeting" for a meeting. */
const kindWord = (event: Pick<BookingEvent, "event_type">) => (event.event_type === "meeting" ? "meeting" : "conference");
const cap = (w: string) => w[0].toUpperCase() + w.slice(1);

/** The teacher, as families see them: their name, and an email to reply to. */
export type Teacher = {
  name: string;
  email: string | null;
  /** Its hosts also send booking emails to other addresses (Edit details → Notifications), so families are told. */
  shared?: boolean;
};

/** Who sees a family's details: "Ms. Ruiz and the people helping run this", plus anyone else they notify (no in-app role names on public pages). */
export const whoSees = (teacher: Pick<Teacher, "name" | "shared">) =>
  teacher.shared ? `${teacher.name}, the people helping run this, and the people they've chosen to notify` : `${teacher.name} and the people helping run this`;

export const BOOKING_COLUMNS = "id, starts_at, child_name, parents, meeting_mode, note, calendar_sequence";

/**
 * Reads bookings with the number to call for phone calls. Before the weekly
 * hours update (20261211000000) there's no such column (and no phone calls),
 * so it reads without it. `run` gets the columns to select.
 */
export async function withCallPhone<T extends { error: { code?: string } | null }>(run: (columns: string) => PromiseLike<T>): Promise<T> {
  const r = await run(`${BOOKING_COLUMNS}, call_phone`);
  return isSchemaError(r.error) ? run(BOOKING_COLUMNS) : r;
}

/** The privacy promise, in one line (emails). The pages show it in full (book/privacy-note). */
export const privacyLine = (teacher: Teacher, weekly = false, child = true) =>
  // Without the child's name, the short version (like the booking page's privacy note).
  child
    ? `Only ${whoSees(teacher)} see your child's name, your details, and your note. Other families never see who booked. They're deleted from ${brand.name} 30 days after ${weekly ? "your meeting" : "the conference"}.`
    : `Only ${whoSees(teacher)} see your details and your note. They're deleted from ${brand.name} 30 days after ${weekly ? "your meeting" : "the conference"}.`;

/** A family's link to see, change or cancel their meeting. */
export const bookingLink = (origin: string, slug: string, token: string) => `${origin}/e/${slug}/book/r/${token}`;

export const meetingEnd = (startsAt: string, minutes: number) => new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString();

/** "Fri, Oct 23 · 3:20 – 3:35 PM" */
export function meetingWhen(startsAt: string, minutes: number, tz: string) {
  return `${formatDate(utcToZonedDate(startsAt, tz), { year: undefined })} · ${formatTimeRange(startsAt, meetingEnd(startsAt, minutes), tz)}`;
}

/** What the family is called (in the waiting room, and to the teacher): "Ava Lopez's family", or with no child's name, the first parent's own name. */
export const familyName = (b: Pick<Booking, "child_name" | "parents">) =>
  b.child_name ? `${b.child_name}'s family` : (b.parents[0]?.name ?? "your name");

/** Where they'll meet and how they'll be let in, as short lines for emails and the family's page. */
export function meetingPlace(b: Pick<Booking, "meeting_mode" | "child_name" | "parents" | "call_phone">, event: BookingEvent, s: ConferenceSettings, teacher: Teacher) {
  if (b.meeting_mode === "phone") {
    return {
      title: "Phone call",
      lines: [
        `${teacher.name} will call you at ${formatPhone(b.call_phone) || "the number you gave"}. Please keep your phone nearby.`,
        "The call may come from a school or private number.",
      ],
      link: null as string | null,
    };
  }
  if (b.meeting_mode === "in_person") {
    const school = [event.venue_name, event.venue_address].filter(Boolean).join(", ");
    return {
      title: "In person",
      lines: [
        [s.room, school].filter(Boolean).join(" · "),
        `Please wait outside the room. ${teacher.name} will invite you in when they're ready for you.`,
      ],
      link: null as string | null,
    };
  }
  if (!s.video_link) {
    // Only an event that used the old "add it to each invite" setting and hasn't added a link yet.
    return {
      title: "Video",
      lines: [`${teacher.name} sends you the link to join before your meeting.`],
      link: null,
    };
  }
  return {
    title: "Video",
    lines: [
      `Join a minute or two early, using “${familyName(b)}” as your name so ${teacher.name} knows who you are.`,
      "You'll wait in a waiting room until you're let in. If the meeting before yours runs over, please stay put: you'll be brought in as soon as they're ready.",
    ],
    link: s.video_link,
    passcode: s.video_passcode || null,
  };
}

function toIcsEvent(b: Booking, event: BookingEvent, s: ConferenceSettings, teacher: Teacher, link: string, to: BookingParent): IcsEvent {
  const place = meetingPlace(b, event, s, teacher);
  return {
    uid: `conference-${b.id}@fieldcommandevents.com`,
    timezone: event.timezone,
    sequence: b.calendar_sequence,
    start: new Date(b.starts_at),
    end: new Date(meetingEnd(b.starts_at, s.meeting_minutes)),
    summary: b.child_name ? `Conference with ${teacher.name}: ${b.child_name}` : `${cap(kindWord(event))} with ${teacher.name}`,
    location: place.link ?? (b.meeting_mode === "in_person" ? place.lines[0] : b.meeting_mode === "phone" ? `${teacher.name} calls you` : "Video"),
    description: [
      ...place.lines,
      ...(place.link ? [`Join: ${place.link}`] : []),
      ...(place.passcode ? [`Passcode: ${place.passcode}`] : []),
      `Change or cancel: ${link}`,
    ].join("\n"),
    url: link,
    attendee: { name: to.name, email: to.email },
    alarm: place.link ? `Join as ${familyName(b)}` : `${cap(kindWord(event))} with ${teacher.name}`,
  };
}

const invite = (method: "REQUEST" | "CANCEL", ...args: Parameters<typeof toIcsEvent>): CalendarInvite => ({
  method,
  content: buildIcs(method, toIcsEvent(...args), brand.name),
});

/** A host's or co-host's own words, added to the family's email when they reschedule or cancel. */
export type OrganizerNote = { from: string; text: string };

/**
 * One parent's email: the confirmation (with a calendar invite), a changed
 * time (an updated invite), a time the teacher or a co-host rescheduled (an
 * updated invite), the reminder the day before, or the cancellation (removes
 * the invite).
 */
export async function bookingEmail(
  kind: "confirmation" | "changed" | "rescheduled" | "reminder" | "canceled",
  b: Booking,
  event: BookingEvent,
  s: ConferenceSettings,
  teacher: Teacher,
  link: string,
  to: BookingParent,
  /** The teacher canceled it, or moved the conference to a new day (not the family). */
  byTeacher = false,
  /** What the host or co-host wrote when they rescheduled or canceled. */
  note: OrganizerNote | null = null,
) {
  const when = meetingWhen(b.starts_at, s.meeting_minutes, event.timezone);
  const place = meetingPlace(b, event, s, teacher);
  const first = to.name.split(" ")[0];
  const footer = `Sent by ${brand.name} for ${teacher.name}.`;
  const about = b.child_name ? ` about ${b.child_name}` : "";
  const forChild = b.child_name ? ` for ${b.child_name}` : "";
  const details = b.child_name ? "your child's name, your contact details, and your note" : "your contact details and your note";
  const word = kindWord(event);
  // Subjects never name the child: our sent-email log keeps subjects (lib/email), and the child's name is only kept 30 days.
  // An admin's wording (/admin/emails), if they saved one; its subject can't use the child's name either.
  const moved = kind === "changed" && byTeacher;
  const key =
    kind === "canceled" ? (byTeacher ? "family_booking_canceled_by_organizer" : "family_booking_canceled") : moved ? "family_booking_moved" : `family_booking_${kind}`;
  const noteRow = note ? [{ title: `A note from ${note.from}`, detail: note.text }] : [];
  const custom = customWords(key, await loadSystemEmail(key), {
    first_name: first,
    teacher: teacher.name,
    kind: word,
    when,
    event_name: event.name,
    child: b.child_name ?? "",
    about_child: b.child_name ? `about ${b.child_name}` : "",
    for_child: b.child_name ? `for ${b.child_name}` : "",
  });

  if (kind === "canceled") {
    return {
      subject: custom?.subject || `Canceled: your ${word} with ${teacher.name}`,
      ...emailLayout({
        heading: custom?.heading || (byTeacher ? `${teacher.name} canceled your ${word}` : `Your ${word} was canceled`),
        paragraphs: [
          ...(custom
            ? [...custom.paragraphs, `Your booking details (${details}) have been deleted.`]
            : [
                byTeacher
                  ? `Hi ${first}, ${teacher.name} had to cancel the ${word}${forChild} (${when}). Your booking details (${details}) have been deleted. You're welcome to book another open time.`
                  : `Hi ${first}, the ${word}${forChild} with ${teacher.name} (${when}) is canceled, and your booking details (${details}) have been deleted.`,
              ]),
          "If you added our calendar invite, it will be removed from your calendar (in Gmail, you may need to open this email first).",
        ],
        rows: noteRow,
        button: { label: custom?.button || "Book another time", url: link },
        footer,
      }),
      invite: invite("CANCEL", { ...b, calendar_sequence: b.calendar_sequence + 1 }, event, s, teacher, link, to),
    };
  }

  const heading =
    kind === "confirmation"
      ? `Your ${word} is booked`
      : kind === "rescheduled"
        ? `${teacher.name} changed your ${word} time`
        : moved
          ? `${teacher.name} moved your ${word} to a new day`
          : kind === "changed"
            ? `Your ${word} was changed`
            : `Your ${word} is tomorrow`;
  const subject =
    kind === "confirmation"
      ? `Booked: your ${word} with ${teacher.name}, ${when}`
      : kind === "changed" || kind === "rescheduled"
        ? `${moved ? "New day" : "New time"}: your ${word} with ${teacher.name}, ${when}`
        : `Tomorrow: your ${word} with ${teacher.name}, ${when}`;
  const change = custom?.button || "Change or cancel";
  return {
    subject: custom?.subject || subject,
    ...emailLayout({
      heading: custom?.heading || heading,
      paragraphs: [
        ...(custom?.paragraphs ?? [
          kind === "reminder"
            ? `Hi ${first}, a reminder that you're meeting ${teacher.name}${about} tomorrow (${event.name}).`
            : kind === "rescheduled"
              ? `Hi ${first}, ${teacher.name} moved your ${word}${about} (${event.name}) to a new time. The details below are current.`
              : moved
              ? `Hi ${first}, ${teacher.name} moved ${event.name} to a new day. Your meeting${about} is at the same time of day, on the day below.`
              : `Hi ${first}, you're booked to meet ${teacher.name}${about} (${event.name}).`,
          ...(moved ? ["If the new day doesn't work for you, use the button below to pick another time or cancel."] : []),
          ...(kind === "rescheduled" ? ["If the new time doesn't work for you, use the button below to pick another time or cancel."] : []),
        ]),
        ...(kind !== "reminder"
          ? [
              moved
                ? "An updated calendar invite is attached, so your calendar shows the new day."
                : kind === "rescheduled"
                  ? "An updated calendar invite is attached, so your calendar shows the new time."
                  : "Open the attached calendar invite to add it to your calendar, with the details.",
            ]
          : []),
      ],
      rows: [
        ...noteRow,
        { title: "When", detail: when, strong: true },
        // Each on its own line, so an address never runs into the next sentence (decisions 2026-11-07).
        { title: place.title, detail: place.lines.join("\n"), plain: true },
        ...(place.passcode ? [{ title: "Passcode", detail: place.passcode, strong: true }] : []),
        ...(b.parents.length > 1 ? [{ title: b.meeting_mode === "phone" ? "On the call" : "Coming", detail: b.parents.map((p) => p.name).join(", ") }] : []),
        { title: b.child_name ? "Your child's privacy" : "Your privacy", detail: privacyLine(teacher, s.schedule === "weekly" || word === "meeting", Boolean(b.child_name)) },
      ],
      // On video, joining is what they'll need most, so it gets the button.
      ...(place.link
        ? { button: { label: "Join the meeting", url: place.link }, link: { label: change, url: link } }
        : { button: { label: change, url: link } }),
      footer,
      preheader: `${when} · ${place.title} with ${teacher.name}`,
    }),
    ...(kind !== "reminder" ? { invite: invite("REQUEST", b, event, s, teacher, link, to) } : {}),
  };
}

/** This meeting on the teacher's Meetings page (meeting-list.tsx gives each one this id). */
export const meetingAnchor = (meetings: string, bookingId: string) => `${meetings}#meeting-${bookingId}`;

/** "Liam Patel" → "Liam P.": enough for the teacher's calendar, which others may be able to see. */
export const shortName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
};

/** For the teacher: "Call (512) 555-0101". */
const callLine = (b: Pick<Booking, "call_phone">) => (b.call_phone ? `Call ${formatPhone(b.call_phone)}` : "Phone call");

/** The meeting on the teacher's own calendar. Its own UID, so it never collides with a parent's copy. */
function teacherIcsEvent(b: Booking, event: BookingEvent, s: ConferenceSettings, teacher: Teacher, meetings: string): IcsEvent {
  const place = meetingPlace(b, event, s, teacher);
  const who = b.child_name ? `${shortName(b.child_name)}'s family` : shortName(b.parents[0]?.name ?? "A parent");
  const mark = meetingAnchor(meetings, b.id);
  return {
    uid: `conference-${b.id}-teacher@fieldcommandevents.com`,
    timezone: event.timezone,
    sequence: b.calendar_sequence,
    start: new Date(b.starts_at),
    end: new Date(meetingEnd(b.starts_at, s.meeting_minutes)),
    summary: `${cap(kindWord(event))}: ${who}`,
    location: place.link ?? (b.meeting_mode === "in_person" ? place.lines[0] : b.meeting_mode === "phone" ? callLine(b) : "Video"),
    description: [
      `${who} · ${b.meeting_mode === "phone" ? callLine(b) : place.title}`,
      `Mark Met or No-show after the meeting: ${mark}`,
    ].join("\n"),
    url: mark,
    attendee: teacher.email ? { name: teacher.name, email: teacher.email } : undefined,
    // Meetings run back to back: an alarm before each one would be noise.
    alarm: false,
  };
}

/**
 * The teacher's email when a family books, changes or cancels, or when the
 * teacher or a co-host reschedules or cancels: with a calendar invite that
 * adds, moves or removes the meeting on their calendar.
 */
export function teacherBookingEmail(
  kind: "booked" | "changed" | "rescheduled" | "canceled",
  b: Booking,
  event: BookingEvent,
  s: ConferenceSettings,
  teacher: Teacher,
  /** Their Meetings page. */
  meetings: string,
  /** The teacher canceled it, or moved the conference to a new day, themselves. */
  byTeacher = false,
  /** An admin's wording for this email (organizer_booking_<kind>); used when a family made the change. */
  saved: SystemEmailText | null = null,
  /** A co-host who rescheduled or canceled it (null: the teacher did, "You"). */
  actor: string | null = null,
) {
  // A reschedule is always the teacher's side (them or a co-host), never the family's.
  if (kind === "rescheduled") byTeacher = true;
  const who = actor ?? "You";
  const when = meetingWhen(b.starts_at, s.meeting_minutes, event.timezone);
  const place = meetingPlace(b, event, s, teacher);
  const family = familyName(b);
  // With no child's name, the booking is one person (and anyone they bring), not "the family".
  const them = b.child_name ? "the family" : "them";
  const footer = `Sent by ${brand.name}. Every booking is also on your Meetings page.`;
  const word = kindWord(event);
  const Word = cap(word);
  // Subjects never name the child (see bookingEmail).
  const subject =
    kind === "booked"
      ? `New ${word} booked: ${when}`
      : kind === "changed" || kind === "rescheduled"
        ? `${byTeacher ? `${Word} moved` : `${Word} changed`}: ${when}`
        : byTeacher
          ? `${who} canceled a ${word}: ${when}`
          : `Canceled ${word}: ${when}`;
  const custom = byTeacher ? null : customWords(`organizer_booking_${kind}`, saved, { who: family, when, kind: word, event_name: event.name });
  const ics = (method: "REQUEST" | "CANCEL", seq: number): CalendarInvite => ({
    method,
    content: buildIcs(method, teacherIcsEvent({ ...b, calendar_sequence: seq }, event, s, teacher, meetings), brand.name),
  });

  const button = custom?.button || "Open your Meetings page";

  if (kind === "canceled") {
    return {
      subject: custom?.subject || subject,
      ...emailLayout({
        heading:
          custom?.heading ||
          (byTeacher ? `${who} canceled a ${word}` : b.child_name ? `A family canceled their ${word}` : `A ${word} was canceled`),
        paragraphs: [
          ...(custom?.paragraphs ?? [
            byTeacher
              ? `${who} canceled the ${word} with ${family} (${when}). We emailed ${them}, and the time is open again.`
              : `${family} canceled their ${word} (${when}). The time is open again.`,
          ]),
          "This email takes it off your calendar (in Gmail, you may need to open it first).",
        ],
        button: { label: button, url: meetings },
        footer,
      }),
      invite: ics("CANCEL", b.calendar_sequence + 1),
    };
  }

  return {
    subject: custom?.subject || subject,
    ...emailLayout({
      heading:
        custom?.heading ||
        (kind === "booked"
          ? b.child_name ? `A family booked a ${word}` : `A ${word} was booked`
          : kind === "rescheduled"
            ? `A ${word} was rescheduled`
            : byTeacher
            ? `A ${word} moved to your new day`
            : b.child_name ? `A family changed their ${word}` : `A ${word} was changed`),
      paragraphs: custom?.paragraphs ?? [
        kind === "booked"
          ? `${family} booked a ${word} with you (${event.name}). Open the attached calendar invite to add it to your calendar.`
          : kind === "rescheduled"
            ? `${who} moved the ${word} with ${family} to a new time. We emailed ${them}, and your calendar invite is updated.`
            : byTeacher
            ? `You moved ${event.name} to a new day, so ${family}'s meeting moved with it, at the same time of day. We emailed ${them}, and your calendar invite is updated.`
            : `${family} changed their ${word}. The details below are current, and your calendar invite is updated.`,
        "After the meeting, mark it Met or No-show on your Meetings page, so your records are complete.",
      ],
      rows: [
        { title: "When", detail: when, strong: true },
        {
          title: place.title,
          detail:
            b.meeting_mode === "in_person"
              ? place.lines[0] || "Your room"
              : b.meeting_mode === "phone"
                ? callLine(b)
                : !s.video_link
                  ? `Add your meeting link in Meeting setup, so ${them} can join`
                  : [s.video_link, s.video_passcode && `Passcode: ${s.video_passcode}`].filter(Boolean).join(" · "),
        },
        { title: b.meeting_mode === "phone" ? "On the call" : "Coming", detail: b.parents.map((p) => p.name).join(", ") },
        ...(b.note ? [{ title: "Their note", detail: "They left you a note. It's on your Meetings page." }] : []),
      ],
      button: { label: button, url: meetingAnchor(meetings, b.id) },
      footer,
      preheader: `${when} · ${b.parents.map((p) => p.name).join(", ")}`,
    }),
    invite: ics("REQUEST", b.calendar_sequence),
  };
}

/**
 * Emails the teacher (the conference's creator), or the people its hosts
 * picked to get notifications (Edit details), each with the calendar invite.
 * True if every one went.
 */
export async function emailTeacher(
  kind: Parameters<typeof teacherBookingEmail>[0],
  b: Booking,
  conf: { event: BookingEvent & { id: string }; settings: ConferenceSettings; teacher: Teacher },
  origin: string,
  byTeacher = false,
  /** A co-host who rescheduled or canceled it (null: the teacher did). */
  actor: string | null = null,
) {
  const to = await notificationEmails(conf.event.id, "bookings", () => (conf.teacher.email ? [conf.teacher.email] : []));
  if (!to.length) return false;
  const meetings = `${origin}/dashboard/events/${conf.event.id}/conferences/meetings`;
  const saved = byTeacher || kind === "rescheduled" ? null : await loadSystemEmail(`organizer_booking_${kind}`);
  let all = true;
  for (const email of to) {
    // Each person is the invite's attendee, so it lands on their own calendar.
    const message = teacherBookingEmail(kind, b, conf.event, conf.settings, { ...conf.teacher, email }, meetings, byTeacher, saved, actor);
    all = (await sendEmail({ to: email, ...message })) && all;
  }
  return all;
}

/**
 * New hours left a booked meeting out (the organizer chose to email them): it's still booked, and
 * this asks them to pick a new time from their own link (decisions 2026-11-08, finding 2).
 */
export function pickNewTimeEmail(b: Booking, event: BookingEvent, s: ConferenceSettings, teacher: Teacher, link: string, to: BookingParent) {
  const when = meetingWhen(b.starts_at, s.meeting_minutes, event.timezone);
  const word = kindWord(event);
  const first = to.name.split(" ")[0];
  return {
    subject: `Please pick a new time for your ${word} with ${teacher.name}`,
    ...emailLayout({
      heading: "Please pick a new time",
      paragraphs: [
        `Hi ${first}, ${teacher.name} changed the hours for ${event.name}. Your ${word} (${when}) is now outside those hours.`,
        `Your ${word} stays booked until you pick a new time or cancel. If none of the open times work, reply to this email.`,
      ],
      button: { label: "Pick a new time", url: link },
      footer: `Sent by ${brand.name} for ${teacher.name}.`,
    }),
  };
}

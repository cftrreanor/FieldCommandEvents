import "server-only";
import { brand } from "@/lib/brand";
import { emailLayout, pause, sendEmail, type CalendarInvite } from "@/lib/email";
import { buildIcs, googleCalendarUrl, type IcsEvent } from "@/lib/ics";
import { formatPhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/server";
import { customWords, loadSystemEmail } from "@/lib/system-email-overrides";
import { formatDate, formatTime, formatTimeRange, utcToZonedDate, zoneName } from "@/lib/time";

/** One signup, with everything needed for its email and calendar invite. */
export type CalendarEntry = {
  assignment_id: string;
  manage_token: string;
  access_token: string;
  calendar_sequence: number;
  volunteer_name: string;
  volunteer_email: string;
  event_name: string;
  timezone: string;
  venue_name: string | null;
  venue_address: string;
  station_name: string;
  station_location: string | null;
  instructions: string | null;
  shift_title: string;
  shift_description: string | null;
  starts_at: string;
  ends_at: string;
  lead_name: string | null;
  lead_phone: string | null;
  /** Missing before the 20261212000000 database update. */
  event_id?: string;
};

/** Load signups for emailing. With bump, they're marked as a new calendar version first. */
export async function loadCalendarEntries(assignmentIds: string[], bump = false): Promise<CalendarEntry[]> {
  if (assignmentIds.length === 0) return [];
  const { data, error } = await createAdminClient().rpc("calendar_entries", {
    p_assignment_ids: assignmentIds,
    p_bump: bump,
  });
  if (error) {
    console.error("calendar_entries failed", error);
    return [];
  }
  // Walk-ups added at the desk have no email, so there's nothing to send them.
  return ((data ?? []) as CalendarEntry[]).filter((e) => e.volunteer_email);
}

export const manageUrl = (origin: string, e: { access_token: string }) => `${origin}/pass/${e.access_token}`;
export const icsDownloadUrl = (origin: string, manageToken: string) => `${origin}/cal/${manageToken}`;

export function toIcsEvent(e: CalendarEntry, origin: string): IcsEvent {
  const lead = e.lead_name ? `Lead: ${e.lead_name}${e.lead_phone ? `, ${formatPhone(e.lead_phone)}` : ""}` : null;
  return {
    uid: `${e.assignment_id}@fieldcommandevents.com`,
    timezone: e.timezone,
    sequence: e.calendar_sequence,
    start: new Date(e.starts_at),
    end: new Date(e.ends_at),
    summary: `Volunteer: ${e.station_name} (${e.event_name})`,
    location: [e.venue_name, e.venue_address].filter(Boolean).join(", "),
    description: [
      jobAndShift(e.station_name, e.shift_title),
      `When: ${formatDate(utcToZonedDate(e.starts_at, e.timezone))}, ${formatTimeRange(e.starts_at, e.ends_at, e.timezone)} (${zoneName(e.timezone)})`,
      e.station_location ? `Report to: ${e.station_location}` : null,
      e.shift_description,
      e.instructions,
      lead,
      `Manage or cancel: ${manageUrl(origin, e)}`,
    ]
      .filter(Boolean)
      .join("\n"),
    url: manageUrl(origin, e),
    attendee: { name: e.volunteer_name, email: e.volunteer_email },
  };
}

function invite(method: "REQUEST" | "CANCEL", e: CalendarEntry, origin: string): CalendarInvite {
  return { method, content: buildIcs(method, toIcsEvent(e, origin)) };
}

/** "Cashier", or "Ticket booth: Early shift": the job and the shift's own name, said once when they're the same. */
export const jobAndShift = (station: string, title: string | null | undefined) =>
  !title?.trim() || title.trim().toLowerCase() === station.trim().toLowerCase() ? station : `${station}: ${title}`;

const CALENDAR_TIP = "The calendar invite in this email keeps your calendar up to date if anything changes.";

function shiftRow(e: CalendarEntry, tz: string, origin: string, multiDay: boolean) {
  return {
    title: jobAndShift(e.station_name, e.shift_title),
    detail: [
      multiDay ? formatDate(utcToZonedDate(e.starts_at, tz), { year: undefined }) : formatDate(utcToZonedDate(e.starts_at, tz)),
      formatTimeRange(e.starts_at, e.ends_at, tz),
      e.station_location,
    ]
      .filter(Boolean)
      .join(" · "),
    // Copies, for other calendars: they don't update, so they stay quiet.
    linksLabel: "Other calendars (no updates):",
    links: [
      { label: "Google", url: googleCalendarUrl(toIcsEvent(e, origin)) },
      { label: "Apple or Outlook", url: icsDownloadUrl(origin, e.manage_token) },
    ],
  };
}

/** Something they signed up to bring (no time, so no calendar invite). */
export type ItemLine = { name: string; station: string; note: string | null };

const itemRow = (it: ItemLine) => ({ title: `Bringing: ${it.name}`, detail: [it.station, it.note].filter(Boolean).join(" · ") });

/** Someone the booker signed up, with their shifts ("Concessions: 6:00 PM – 8:00 PM CDT"). */
export type GroupLine = { name: string; shifts: string[] };

const groupParagraph = (group: GroupLine[]) =>
  group.length ? [`You also signed up ${group.length === 1 ? "1 other person" : `${group.length} other people`}. Anyone with an email gets their own confirmation.`] : [];
const groupRow = (g: GroupLine) => ({ title: g.name, detail: g.shifts.join("; ") });

/** Who signed up, for a confirmation with only items (no shifts to read it from). */
export type SignupPerson = { name: string; email: string; accessToken: string; eventId: string; eventName: string; venueName: string | null };

/** The confirmation when someone signed up only to bring things (or only added other people this time). */
async function sendItemsConfirmation(items: ItemLine[], person: SignupPerson, origin: string, group: GroupLine[] = []) {
  const { html, text } = emailLayout({
    heading: `You're signed up for ${person.eventName}`,
    paragraphs: [
      items.length
        ? `Thanks, ${person.name.split(" ")[0]}. Here's what you're bringing${person.venueName ? ` to ${person.venueName}` : ""}.`
        : `Thanks, ${person.name.split(" ")[0]}. Here's who you signed up.`,
      ...groupParagraph(group),
      "We'll send a reminder the day before.",
    ],
    rows: [...items.map(itemRow), ...group.map(groupRow)],
    button: { label: "View or cancel my sign-ups", url: manageUrl(origin, { access_token: person.accessToken }) },
    footer: `You're receiving this because you signed up to volunteer through ${brand.name}. This link is just for you; anyone you forward it to can view and cancel your sign-ups.`,
  });
  return sendEmail({ to: person.email, eventId: person.eventId, subject: `You're signed up: ${person.eventName}`, html, text });
}

/** The day before: what someone signed up to bring. */
export async function sendItemsReminder(items: ItemLine[], person: SignupPerson, origin: string) {
  const { html, text } = emailLayout({
    heading: `See you tomorrow at ${person.eventName}`,
    paragraphs: [
      `Hi ${person.name.split(" ")[0]}, a reminder of what you're bringing tomorrow${person.venueName ? ` to ${person.venueName}` : ""}.`,
      "Can't bring it anymore? Please cancel below so someone else can sign up.",
    ],
    rows: items.map(itemRow),
    button: { label: "View or cancel my sign-ups", url: manageUrl(origin, { access_token: person.accessToken }) },
    footer: `You're receiving this because you signed up to volunteer through ${brand.name}.`,
  });
  return sendEmail({ to: person.email, eventId: person.eventId, subject: `Tomorrow: what you're bringing to ${person.eventName}`, html, text });
}

/**
 * The signup confirmation. Each email can carry one calendar invite, so a
 * single shift rides in the confirmation itself; with several shifts, the
 * confirmation lists them and each shift gets its own short invite email.
 */
export async function sendSignupConfirmation(
  entries: CalendarEntry[],
  tz: string,
  origin: string,
  multiDay: boolean,
  /** Other people signed up on the same shifts. */
  others: string[] = [],
  /** Things they signed up to bring, listed with the shifts. */
  items: ItemLine[] = [],
  /** Who signed up, for a confirmation with only items. */
  person?: SignupPerson,
  /** Everyone else they signed up, each on their own shifts. */
  group: GroupLine[] = [],
) {
  if (entries.length === 0) return (items.length || group.length) && person ? sendItemsConfirmation(items, person, origin, group) : false;
  const first = entries[0];
  const single = entries.length === 1;
  const custom = customWords("volunteer_signup", await loadSystemEmail("volunteer_signup"), volunteerVars(first));
  const { html, text } = emailLayout({
    heading: custom?.heading || `You're signed up for ${first.event_name}`,
    paragraphs: [
      ...(custom?.paragraphs ?? [
        `Thanks, ${first.volunteer_name.split(" ")[0]}. Here ${single ? "is your shift" : "are your shifts"}${first.venue_name ? ` at ${first.venue_name}` : ""}.`,
      ]),
      ...(others.length ? [`Also signed up for ${single ? "this shift" : "these shifts"}: ${others.join(", ")}.`] : []),
      ...groupParagraph(group),
      single
        ? CALENDAR_TIP
        : "Each shift gets its own email with a calendar invite, which keeps your calendar up to date if anything changes.",
    ],
    rows: [...entries.map((e) => shiftRow(e, tz, origin, multiDay)), ...items.map(itemRow), ...group.map(groupRow)],
    button: { label: custom?.button || "View or cancel my shifts", url: manageUrl(origin, first) },
    footer: `You're receiving this because you signed up to volunteer through ${brand.name}. This link is just for you; anyone you forward it to can view and cancel your shifts.`,
  });
  const sent = await sendEmail({
    to: first.volunteer_email,
    eventId: first.event_id,
    subject: custom?.subject || `You're signed up: ${first.event_name}`,
    html,
    text,
    ...(single ? { invite: invite("REQUEST", first, origin) } : {}),
  });
  if (!single) {
    for (const e of entries) {
      await pause();
      const when = `${formatDate(utcToZonedDate(e.starts_at, tz), { year: undefined })}, ${formatTimeRange(e.starts_at, e.ends_at, tz)}`;
      const msg = emailLayout({
        heading: `Calendar invite: ${e.station_name}`,
        paragraphs: [`${e.event_name} · ${when}`, CALENDAR_TIP],
        button: { label: "View or cancel my shifts", url: manageUrl(origin, e) },
      });
      await sendEmail({
        to: e.volunteer_email,
        eventId: e.event_id,
        subject: `Calendar invite: ${e.station_name}, ${when}`,
        html: msg.html,
        text: msg.text,
        invite: invite("REQUEST", e, origin),
      });
    }
  }
  return sent;
}

/**
 * To someone the booker signed up: "Hi Bob, Judy signed you up to help with
 * Setting Up Chairs at 5:00 PM on Saturday, November 14." Their own private
 * link lets them see, switch, or cancel only their own shifts. One shift
 * rides with its calendar invite.
 */
export async function sendAddedToGroup(entries: CalendarEntry[], bookerFirstName: string, tz: string, origin: string) {
  const mine = entries.filter((e) => e.volunteer_email);
  if (!mine.length) return false;
  const first = mine[0];
  const day = formatDate(utcToZonedDate(first.starts_at, tz), { weekday: "long", month: "long", year: undefined });
  const what =
    mine.length === 1
      ? `${first.station_name} at ${formatTime(first.starts_at, tz)} on ${day}`
      : `${mine.length} shifts at ${first.event_name}, starting with ${first.station_name} at ${formatTime(first.starts_at, tz)} on ${day}`;
  const link = manageUrl(origin, first);
  const { html, text } = emailLayout({
    heading: `You're signed up for ${first.event_name}`,
    paragraphs: [
      `Hi ${first.volunteer_name.split(" ")[0]}, ${bookerFirstName} signed you up to help with ${what}.`,
      "Can't make it, or need a different time? Use the links below. Only you can change or cancel your spot with them.",
    ],
    rows: mine.map((e) => ({
      ...shiftRow(e, tz, origin, true),
      linksLabel: undefined,
      links: [
        { label: "Change my sign-up", url: `${link}?go=change` },
        { label: "Cancel my sign-up", url: `${link}?go=cancel` },
      ],
    })),
    button: { label: "View my sign-up", url: link },
    footer: `You're receiving this because ${bookerFirstName} signed you up to volunteer through ${brand.name}. This link is just for you; anyone you forward it to can change and cancel your sign-up.`,
  });
  return sendEmail({
    to: first.volunteer_email,
    eventId: first.event_id,
    subject: `${bookerFirstName} signed you up: ${first.event_name}`,
    html,
    text,
    ...(mine.length === 1 ? { invite: invite("REQUEST", first, origin) } : {}),
  });
}

/** A volunteer switched one of their shifts: the new details, and their calendar invite moves with it. */
export async function sendShiftSwitched(e: CalendarEntry, tz: string, origin: string) {
  const { html, text } = emailLayout({
    heading: "You switched shifts",
    paragraphs: [
      `Hi ${e.volunteer_name.split(" ")[0]}, you're now signed up for ${e.station_name} at ${e.event_name}.`,
      "If you added our calendar invite, it updates automatically. If you added a copy to another calendar, please update it yourself.",
    ],
    rows: [shiftRow(e, tz, origin, false)],
    button: { label: "View or change my shifts", url: manageUrl(origin, e) },
  });
  return sendEmail({
    to: e.volunteer_email,
    eventId: e.event_id,
    subject: `Switched: your shift at ${e.event_name}`,
    html,
    text,
    invite: invite("REQUEST", e, origin),
  });
}

/** To the booker, when someone they signed up switches or cancels a shift. */
export async function sendBookerHeadsUp(
  booker: { name: string; email: string },
  who: string,
  change: { kind: "switched"; from: string; to: string } | { kind: "canceled"; shift: string },
  event: { id: string; name: string },
) {
  const first = booker.name.split(/\s+/)[0];
  const { html, text } = emailLayout({
    heading: change.kind === "switched" ? `${who} switched shifts` : `${who} canceled a shift`,
    paragraphs: [
      change.kind === "switched"
        ? `Hi ${first}, ${who}, who you signed up for ${event.name}, switched from ${change.from} to ${change.to}.`
        : `Hi ${first}, ${who}, who you signed up for ${event.name}, is no longer signed up for ${change.shift}.`,
      "Just letting you know. There's nothing you need to do.",
    ],
    footer: `You're receiving this because you signed ${who} up to volunteer through ${brand.name}.`,
  });
  return sendEmail({
    to: booker.email,
    eventId: event.id,
    subject: change.kind === "switched" ? `${who} switched shifts: ${event.name}` : `${who} canceled: ${event.name}`,
    html,
    text,
  });
}

/** The day before: a volunteer's shifts tomorrow, where to report and who their lead is. */
export async function sendShiftReminder(entries: CalendarEntry[], tz: string, origin: string) {
  if (entries.length === 0) return false;
  const first = entries[0];
  const single = entries.length === 1;
  const leads = [...new Set(entries.filter((e) => e.lead_name).map((e) => `${e.lead_name}${e.lead_phone ? ` at ${formatPhone(e.lead_phone)}` : ""}`))];
  const details = [
    ...entries.filter((e) => e.instructions).map((e) => `${e.station_name}: ${e.instructions}`),
    ...(leads.length ? [`Questions on the day? Your ${leads.length === 1 ? "lead is" : "leads are"} ${leads.join(" and ")}.`] : []),
  ];
  const custom = customWords("volunteer_reminder", await loadSystemEmail("volunteer_reminder"), volunteerVars(first));
  const { html, text } = emailLayout({
    heading: custom?.heading || `See you tomorrow at ${first.event_name}`,
    paragraphs: custom
      ? [...custom.paragraphs, ...details]
      : [
          `Hi ${first.volunteer_name.split(" ")[0]}, a reminder that you're volunteering tomorrow${first.venue_name ? ` at ${first.venue_name}` : ""}. Here ${single ? "is your shift" : "are your shifts"}.`,
          ...details,
          "Can't make it anymore? Please cancel below so someone else can take your spot.",
        ],
    rows: entries.map((e) => shiftRow(e, tz, origin, false)),
    button: { label: custom?.button || "View or cancel my shifts", url: manageUrl(origin, first) },
    footer: `You're receiving this because you signed up to volunteer through ${brand.name}.`,
  });
  return sendEmail({
    to: first.volunteer_email,
    eventId: first.event_id,
    subject: custom?.subject || `Tomorrow: your volunteer shift at ${first.event_name}`,
    html,
    text,
  });
}

/** Tell each volunteer their shift changed and update their calendar. */
export async function sendShiftUpdates(entries: CalendarEntry[], tz: string, origin: string) {
  const saved = await loadSystemEmail("volunteer_shift_changed");
  for (const e of entries) {
    const custom = customWords("volunteer_shift_changed", saved, volunteerVars(e));
    const { html, text } = emailLayout({
      heading: custom?.heading || "Your volunteer shift changed",
      paragraphs: [
        ...(custom?.paragraphs ?? [`Hi ${e.volunteer_name.split(" ")[0]}, the organizers of ${e.event_name} updated your shift. Here are the new details.`]),
        "If you added our calendar invite, it updates automatically. If you added a copy to another calendar, please update it yourself.",
      ],
      rows: [shiftRow(e, tz, origin, false)],
      button: { label: custom?.button || "View or cancel my shifts", url: manageUrl(origin, e) },
    });
    await sendEmail({
      to: e.volunteer_email,
      eventId: e.event_id,
      subject: custom?.subject || `Updated: your shift at ${e.event_name}`,
      html,
      text,
      invite: invite("REQUEST", e, origin),
    });
    await pause();
  }
}

/** Confirm a cancellation and remove the event from their calendar. */
export async function sendCancellation(e: CalendarEntry, tz: string, origin: string, signupUrl: string | null = null) {
  const removed =
    "If you added our calendar invite, it will be removed from your calendar (in Gmail, you may need to open this email first). If you added a copy to another calendar, please delete it.";
  const custom = customWords("volunteer_shift_canceled", await loadSystemEmail("volunteer_shift_canceled"), {
    ...volunteerVars(e),
    station: e.station_name,
    time: formatTimeRange(e.starts_at, e.ends_at, tz),
  });
  const { html, text } = emailLayout({
    heading: custom?.heading || "Your shift was canceled",
    paragraphs: custom
      ? [...custom.paragraphs, removed]
      : [
          `Hi ${e.volunteer_name.split(" ")[0]}, you're no longer signed up for ${e.station_name} (${formatTimeRange(e.starts_at, e.ends_at, tz)}) at ${e.event_name}.`,
          removed,
          signupUrl ? "Changed your mind, or want a different time? Signup is still open." : "Thanks for letting the organizers know.",
        ],
    button: signupUrl
      ? { label: "Sign up for more shifts", url: signupUrl }
      : { label: "View my other shifts", url: manageUrl(origin, e) },
  });
  return sendEmail({
    to: e.volunteer_email,
    eventId: e.event_id,
    subject: custom?.subject || `Canceled: your shift at ${e.event_name}`,
    html,
    text,
    invite: invite("CANCEL", { ...e, calendar_sequence: e.calendar_sequence + 1 }, origin),
  });
}

/** The fields every volunteer email fills in (src/lib/system-emails.ts). */
const volunteerVars = (e: CalendarEntry) => ({
  first_name: e.volunteer_name.split(" ")[0],
  event_name: e.event_name,
  at_venue: e.venue_name ? `at ${e.venue_name}` : "",
});

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailLayout, pause, sendEmail } from "@/lib/email";
import { isSchemaError } from "@/lib/schema-check";
import { customWords, loadSystemEmail } from "@/lib/system-email-overrides";
import { REPORT_HOW_TO_SAVE, REPORT_NO_NAMES } from "@/lib/system-emails";
import { utcToZonedDate } from "@/lib/time";
import { REPORT_NAME, shortDate } from "@/lib/visitor-words";
import { brand } from "@/lib/brand";

// The visitor check-in report emails (visitor registration events), sent by the daily job after the clean-up.
// The database says which are due (parent_report_emails_due, 20270206000000_visitor_adults.sql): only events that
// families registered for, while their details are kept, and never twice (parent_report_emails markers).
//   morning_after:   the morning after the event, to the Account Host and Co-hosts of every event
//   cohost_access:   about a week after, to Co-hosts of just this event (they can open it until 10 days after)
//   before_deletion: a week before deletion, to the Account Host and Co-hosts of every event, always; gentler when
//                    someone already printed or downloaded the report
// These are records-safety emails: they don't follow Email settings' notification choices (those cover bookings,
// band registrations and withdrawals, and volunteer sign-ups), so the school always hears before its report goes.
// No family names, ever: event, deadline, and counts only.

export type ReportEmailKind = "morning_after" | "cohost_access" | "before_deletion";

type Due = { event_id: string; kind: ReportEmailKind; families: number; saved: boolean; access_ends_on: string; delete_on: string };
type Event = { id: string; name: string; organization_id: string; timezone: string; starts_on: string; ends_on: string };

const KEY: Record<ReportEmailKind, string> = {
  morning_after: "visitor_report_morning_after",
  cohost_access: "visitor_report_cohost_access",
  before_deletion: "visitor_report_before_deletion",
};

/** The words of one report email (an admin's saved wording, or the built-in one), in the app's email layout. */
export async function reportEmail(
  kind: ReportEmailKind,
  v: {
    eventName: string;
    deleteOn: string;
    accessEndsOn: string;
    checkedIn: number;
    adults: number;
    /** before_deletion: the last time someone printed or downloaded the report. */
    saved: { by: string | null; on: string } | null;
    url: string;
  },
) {
  const vars = {
    event_name: v.eventName,
    deadline: shortDate(v.deleteOn),
    access_ends: shortDate(v.accessEndsOn),
    checked_in: String(v.checkedIn),
    adults: String(v.adults),
  };
  const custom = customWords(KEY[kind], await loadSystemEmail(KEY[kind]), vars);
  const built = {
    morning_after: {
      subject: `Save the ${v.eventName} visitor check-in report before ${vars.deadline}`,
      heading: `Save the visitor check-in report for ${v.eventName}`,
      paragraphs: [
        `${v.eventName} is over, and its visitor check-in report is final: ${v.checkedIn} of ${v.adults} registered ${v.adults === 1 ? "adult" : "adults"} checked in at the event door.`,
        `Save the report before ${vars.deadline}. That day ${brand.name} deletes it, along with families' and children's details, as promised to families.`,
      ],
    },
    cohost_access: {
      subject: `Save the ${v.eventName} visitor check-in report by ${vars.access_ends}`,
      heading: `Your access to ${v.eventName} ends after ${vars.access_ends}`,
      paragraphs: [
        `As a Co-host of ${v.eventName}, you can open the event and its visitor check-in report through ${vars.access_ends}. If your school needs a copy, save it before then.`,
        `After that, the Account Host and Co-hosts of every event can still open it. ${brand.name} deletes it on ${vars.deadline}, along with families' and children's details.`,
      ],
    },
    before_deletion: {
      subject: `Reminder: save the ${v.eventName} visitor check-in report before ${vars.deadline}`,
      heading: `Save the visitor check-in report before ${vars.deadline}`,
      paragraphs: [
        `On ${vars.deadline}, ${brand.name} deletes the visitor check-in report for ${v.eventName}, along with families' and children's details, as promised to families. Copies you print or download before then are your school's records.`,
      ],
    },
  }[kind];
  const savedLines =
    kind !== "before_deletion"
      ? [REPORT_HOW_TO_SAVE]
      : v.saved
        ? [
            `${v.saved.by ?? "Someone"} printed or downloaded the report on ${shortDate(v.saved.on)}. If your front office has the copy, you're all set.`,
            `If not, ${REPORT_HOW_TO_SAVE[0].toLowerCase()}${REPORT_HOW_TO_SAVE.slice(1)}`,
          ]
        : ["Nobody has printed or downloaded the report yet.", REPORT_HOW_TO_SAVE];
  const { html, text } = emailLayout({
    heading: custom?.heading || built.heading,
    paragraphs: [...(custom?.paragraphs ?? built.paragraphs), ...savedLines],
    button: { label: custom?.button || `Open ${REPORT_NAME.toLowerCase()}`, url: v.url },
    footer: REPORT_NO_NAMES,
  });
  // The layout's plain-text version leaves the footer out: this line belongs in both.
  return { subject: custom?.subject || built.subject, html, text: `${text}\n\n${REPORT_NO_NAMES}` };
}

/** Email addresses of the Account Host and Co-hosts of every event (the account's members), or of one event's Co-hosts. */
async function recipients(admin: SupabaseClient, event: Event, kind: ReportEmailKind): Promise<string[]> {
  type Row = { profiles: { email: string | null } | null };
  const { data, error } =
    kind === "cohost_access"
      ? await admin.from("event_staff").select("profiles(email)").eq("event_id", event.id).eq("role", "co_host")
      : await admin.from("organization_members").select("profiles(email)").eq("organization_id", event.organization_id).in("role", ["owner", "admin"]);
  if (error) {
    console.error("Daily job: report email recipients lookup failed", error);
    return [];
  }
  const seen = new Set<string>();
  return ((data ?? []) as unknown as Row[])
    .map((r) => r.profiles?.email?.trim())
    .filter((e): e is string => {
      const key = e?.toLowerCase();
      // Demo-mode people (an admin's demo Host) never get records emails.
      if (!key || seen.has(key) || key.endsWith("@demo.fieldcommandevents.com")) return false;
      seen.add(key);
      return true;
    });
}

/** Sends the report emails due today. Returns how many emails went out and how many didn't (left for tomorrow). */
export async function sendVisitorReportEmails(admin: SupabaseClient, origin: string, deadline: number) {
  let sent = 0;
  let unsent = 0;
  const { data, error } = await admin.rpc("parent_report_emails_due");
  if (error) {
    if (!isSchemaError(error)) console.error("Daily job: parent_report_emails_due failed", error);
    return { sent, unsent };
  }
  const due = (data ?? []) as Due[];
  const kindsDue = new Map<string, Set<ReportEmailKind>>();
  for (const d of due) kindsDue.set(d.event_id, (kindsDue.get(d.event_id) ?? new Set()).add(d.kind));

  for (const d of due) {
    if (Date.now() > deadline) {
      unsent++;
      continue;
    }
    // Claim it first, so a second run (or one running at the same time) never sends it again.
    const { error: claimError } = await admin.from("parent_report_emails").insert({ event_id: d.event_id, kind: d.kind });
    if (claimError) {
      if (claimError.code !== "23505") {
        console.error("Daily job: report email marker failed", claimError);
        unsent++;
      }
      continue;
    }
    // A late morning-after email (the job missed days) isn't sent when the week-before one goes the same day.
    if (d.kind === "morning_after" && kindsDue.get(d.event_id)?.has("before_deletion")) continue;

    const { data: event } = await admin
      .from("events")
      .select("id, name, organization_id, timezone, starts_on, ends_on")
      .eq("id", d.event_id)
      .maybeSingle<Event>();
    if (!event) continue;
    const to = await recipients(admin, event, d.kind);

    let checkedIn = 0;
    let adults = 0;
    if (d.kind === "morning_after") {
      const { data: rows } = await admin
        .from("parent_registration_adults")
        .select("checked_in_at, sent_to_office_at")
        .eq("event_id", event.id);
      for (const a of (rows ?? []) as { checked_in_at: string | null; sent_to_office_at: string | null }[]) {
        adults++;
        // As the report counts: not marked for the front office, and not a practice check-in before the first day.
        if (!a.sent_to_office_at && a.checked_in_at && utcToZonedDate(a.checked_in_at, event.timezone) >= event.starts_on) checkedIn++;
      }
    }
    let saved: { by: string | null; on: string } | null = null;
    if (d.kind === "before_deletion" && d.saved) {
      const { data: last } = await admin
        .from("parent_list_downloads")
        .select("at, by_name, profiles(full_name)")
        .eq("event_id", event.id)
        .in("kind", ["report_download", "report_print"])
        .order("at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const row = last as unknown as { at: string; by_name: string | null; profiles: { full_name: string | null } | null } | null;
      if (row) saved = { by: row.profiles?.full_name?.trim() || row.by_name || null, on: utcToZonedDate(row.at, event.timezone) };
    }

    const message = await reportEmail(d.kind, {
      eventName: event.name,
      deleteOn: d.delete_on,
      accessEndsOn: d.access_ends_on,
      checkedIn,
      adults,
      saved,
      url: `${origin}/dashboard/events/${event.id}/parents/report`,
    });
    let delivered = 0;
    for (const address of to) {
      if (await sendEmail({ to: address, ...message, eventId: event.id })) delivered++;
      else unsent++;
      await pause();
    }
    sent += delivered;
    // Nobody got it (email down, say): let tomorrow's run try again.
    if (to.length && !delivered) await admin.from("parent_report_emails").delete().eq("event_id", d.event_id).eq("kind", d.kind);
  }
  return { sent, unsent };
}

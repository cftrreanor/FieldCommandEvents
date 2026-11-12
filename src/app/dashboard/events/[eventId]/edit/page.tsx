import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { SettingsNav, type SettingsSection } from "./settings-nav";
import { TeamRoles } from "../team/team-roles";
import { EVENT_TYPES, bookingWords, eventTypeLabel, groupWords, leadWords, hasBands, hasBooths, hasConferences, hasEnsembles, hasParents, hasRooms, isMeeting, usesJobs, volunteerAreaName } from "@/lib/event-types";
import { conferenceBookedCount } from "@/lib/conference-access";
import { ActionButton } from "../forms";
import { getEventAccess } from "@/lib/data";
import { isPlacesConfigured } from "@/lib/places";
import { missing } from "@/lib/schema-check";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { brand as product } from "@/lib/brand";
import { isSchemaError } from "@/lib/schema-check";
import { saveEmailSetup, saveReplies } from "../../../reply-actions";
import { RepliesForm } from "./replies-form";
import { senderName } from "@/lib/sender-name";
import { saveNotifyRecipients } from "../../../notify-actions";
import { NotifyForm, type TeamMember } from "./notify-form";
import { MAX_EXTRA_EMAILS, notifyKinds, type DigestPrefs, type NotifyKind } from "@/lib/notify-kinds";
import { AUDIENCES, fileHref, fileMeta, isShowing, uploadedLines, type EventFile } from "@/lib/event-files";
import { formatDate, formatDateRange, utcToZonedDate, utcToZonedTime, zoneName } from "@/lib/time";
import { deleteEvent, publishAndOpen, setEventPublished, setEventShowBrand, setEventType, updateEvent } from "../../../actions";
import { DeleteEventButton } from "../delete-event";
import { reopenBandRegistration, setBandRegistrationOpen } from "../../../band-actions";
import { ReopenRegistration } from "../bands/reopen-registration";
import { DemoStart } from "@/components/demo-switcher";
import { personasFor } from "@/lib/demo";
import { isSponsorKind } from "@/lib/sponsors";
import { sponsorsEnabled } from "@/lib/sponsors-data";
import { requireUser } from "@/lib/auth";
import { deleteFile, prepareUpload, saveFile } from "../../../file-actions";
import { FilesManager } from "./files-manager";
import { asksChildName, loadConferenceSettings } from "@/lib/conference-settings";
import { weeklySummary } from "@/lib/conferences";
import { displayTime } from "@/lib/schedule";
import { EventForm } from "../../_components/event-form";
import { SETUP_STEPS, SetupFooter, SetupHeader, setupHref } from "../../_components/setup-steps";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/action-state";
import { SavedBy } from "@/components/saved-by";
import { LogoForm } from "@/components/logo-form";
import { SetupLogo } from "../../_components/setup-logo";
import { loadBrand } from "@/lib/badges";

export const metadata: Metadata = { title: "Event settings" };

const TYPE_SUMMARY = {
  band_contest: "Bands register, get performance times, and are checked in on contest day, alongside your volunteers.",
  group_event: "Groups (choirs, orchestras, teams, and more) register and move through your rooms on a schedule worked out for them, alongside your volunteers.",
  volunteer: "Volunteers, shifts, check-in, and your team only. No band registration or performance schedule.",
  school_visit: "Parents register their children ahead and are checked in at the door with a photo ID, alongside your volunteers. Children's details are seen only by your team and permanently deleted 30 days after the event.",
  conference: "Families book a meeting time with you, in person, on video, or by phone. Free during the pilot, with one published conference at a time.",
  meeting: "People book a time with you, in person, on video, or by phone, and can bring up to three others.",
};

// What switching to each kind adds or removes.
const SWITCH_NOTE = {
  band_contest: "Band registration, the performance schedule, and contest day check-in are added.",
  group_event: "Group registration, rooms, and each group's room schedule are added; the single performance order and band check-in stops go away.",
  volunteer: "Band registration, parent registration, and the performance schedule go away; band check-in stops become ordinary sign-ups.",
  school_visit: "Parent registration and door check-in are added (children's details are deleted 30 days after the event); band registration and the performance schedule go away.",
  fair: "Booths and partners by zone, partner check-in, and the public \u201cWhat's at the event\u201d list are added; band registration and the performance schedule go away.",
};

/**
 * Set up or edit an event's global settings: a section menu with one panel at
 * a time (?section=details, files, team, or emails). Type-specific setup
 * (bands, stations, conference times) stays on its own pages. Old ?step=
 * links still land in the right section. A new event's guided setup
 * (?setup=1) walks through the same sections a step at a time.
 */
export default async function EditEventPage({ params, searchParams }: PageProps<"/dashboard/events/[eventId]/edit">) {
  const { eventId } = await params;
  const { step, section: sectionParam, tab, setup: setupParam } = await searchParams;
  const access = await getEventAccess(eventId);
  if (!access.isHost) redirect(`/dashboard/events/${eventId}`);

  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select(
      "id, organization_id, name, status, event_type, created_by, timezone, starts_on, ends_on, window_start, window_end, venue_name, venue_address, venue_place_id, venue_lat, venue_lng, band_registration_open, band_registration_deadline, band_registration_opens_on",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!event) missing();
  const ALL_SECTIONS = ["details", "files", "team", "emails", "more"] as const;
  type Section = (typeof ALL_SECTIONS)[number];
  // Conferences and meetings share no maps or documents: their booking pages and emails have no place for them.
  const SECTIONS = ALL_SECTIONS.filter((x) => x !== "files" || !hasConferences(event.event_type));
  const fromStep: Record<string, Section> = { files: "files", kind: "details", replies: "emails", notifications: "emails" };
  const asked = ALL_SECTIONS.find((x) => x === sectionParam) ?? (typeof step === "string" ? fromStep[step] : undefined);
  const section: Section = asked && SECTIONS.includes(asked) ? asked : "details";
  // The guided setup, step by step (conferences and meetings have their own setup page instead).
  // Volunteer events and band contests set up in three steps (shown by the layout), not the guided Event settings.
  // The Details step of an event set up in steps (opened from the step bar, no section asked for): the step bar is
  // the one menu there. "Event settings" (?section=…) always shows every section, with its own list.
  const steppedSetup =
    hasConferences(event.event_type) || event.event_type === "volunteer" || event.event_type === "band_contest" || hasRooms(event.event_type);
  const stepOnly = steppedSetup && event.status !== "published" && !asked;
  const guided = setupParam === "1" && !steppedSetup;
  const at = SETUP_STEPS.findIndex((s) => s.id === section);
  const prevStep = guided && at > 0 ? setupHref(eventId, SETUP_STEPS[at - 1].id) : undefined;
  const nextStep = guided && at < SETUP_STEPS.length - 1 ? setupHref(eventId, SETUP_STEPS[at + 1].id) : undefined;
  const stepFooter = guided ? (
    <SetupFooter
      back={prevStep}
      skip={nextStep}
      next={nextStep ? { href: nextStep, label: "Continue" } : { href: `/dashboard/events/${eventId}`, label: "Go to my event" }}
    />
  ) : null;
  // The account's logo for volunteer badges lives with the other uploads, here.
  const badgesHere = !hasConferences(event.event_type);
  const askChildName = hasConferences(event.event_type) ? await asksChildName(supabase, eventId) : true;
  // Conferences and meetings: the day or weekly hours, as set in their setup page.
  const setup = hasConferences(event.event_type) ? (await loadConferenceSettings(supabase, eventId)).settings : null;
  // Only once the day and hours are picked: before that the event's dates are placeholders.
  const when = setup?.times_saved_at
    ? {
        summary: `${
          setup.schedule === "weekly"
            ? `Every week: ${weeklySummary(setup.weekly_hours)} · ${formatDateRange(event.starts_on, event.ends_on)}`
            : `${formatDate(event.starts_on)} · ${displayTime(utcToZonedTime(event.window_start, event.timezone))} – ${displayTime(utcToZonedTime(event.window_end, event.timezone))}`
        } · ${zoneName(event.timezone)}`,
        // Before publishing, the setup step; once published, Meeting setup (the same address takes you there).
        href: `/dashboard/events/${eventId}/conferences/times`,
        setupName: event.status !== "published" ? "Meeting times" : isMeeting(event.event_type) ? "Meeting setup" : "Conference setup",
      }
    : undefined;
  // One logo and color per account; each event can switch them off (true until the 20261220000000 update).
  const [brand, showBrand] = await Promise.all([
    loadBrand(event.organization_id),
    supabase
      .from("events")
      .select("show_brand")
      .eq("id", eventId)
      .maybeSingle()
      .then((r) => (r.data as { show_brand?: boolean } | null)?.show_brand !== false),
  ]);
  const hasBrand = Boolean(brand.logo || brand.color);
  const brandSwitch = hasBrand ? (
    <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm">
        <span className="font-semibold">{showBrand ? "Shown on this event" : "Off for this event"}</span>
        <span className="block text-muted">
          {showBrand
            ? "This event's public pages show your logo and color."
            : "This event's public pages use the standard look, without your logo or color."}
        </span>
      </p>
      <ActionButton action={setEventShowBrand.bind(null, eventId, !showBrand)} variant="secondary">
        {showBrand ? "Hide on this event" : "Show on this event"}
      </ActionButton>
    </div>
  ) : null;
  const [{ count }, { data: fileData }, { count: bandCount }, { count: parentCount }, { count: boothCount }] = await Promise.all([
    supabase.from("shifts").select("id", { count: "exact", head: true }).eq("event_id", eventId),
    supabase
      .from("event_files")
      .select("id, event_id, label, path, file_name, content_type, size_bytes, audiences, visible_from, uploaded_by, uploaded_at")
      .eq("event_id", eventId)
      .order("created_at"),
    supabase.from("bands").select("id", { count: "exact", head: true }).eq("event_id", eventId),
    supabase.from("parent_registrations").select("id", { count: "exact", head: true }).eq("event_id", eventId),
    supabase.from("fair_booths").select("id", { count: "exact", head: true }).eq("event_id", eventId),
  ]);
  // Email settings: who the emails come from, and where replies go (lib/event-sender).
  const admin = createAdminClient();
  const [{ data: replyRow, error: replyError }, { data: creator }, { data: org }] = await Promise.all([
    supabase.from("event_email_settings").select("replies, reply_to, sender_id").eq("event_id", eventId).maybeSingle(),
    event.created_by ? admin.from("profiles").select("full_name, email").eq("id", event.created_by).maybeSingle() : Promise.resolve({ data: null }),
    // Read on the server: a co-host of one event can't read the account itself.
    admin.from("organizations").select("name, account_kind, school").eq("id", event.organization_id).maybeSingle(),
  ]);
  // Only the Account Host deletes events.
  const { data: isAccountHost } = await supabase.rpc("is_org_owner", { org: event.organization_id });
  const conference = hasConferences(event.event_type);
  // Notifications: each kind of email the event sends its organizers, and who gets it.
  const kinds = notifyKinds(event.event_type);
  const [{ data: memberRows }, { data: leadRows }, { data: notifyRows, error: notifyError }] = await Promise.all([
    admin.from("organization_members").select("user_id, role, profiles(full_name, email)").eq("organization_id", event.organization_id),
    admin
      .from("event_staff")
      .select("user_id, role, profiles(full_name, email)")
      .eq("event_id", eventId)
      .in("role", conference ? ["co_host"] : ["co_host", "volunteer_director"]),
    supabase.from("event_notification_recipients").select("kind, member_ids, extra_emails").eq("event_id", eventId),
  ]);
  type PersonRow = { user_id: string; role?: string; profiles: { full_name: string | null; email: string | null } | null };
  const person = (m: PersonRow, role: string): TeamMember => ({
    id: m.user_id,
    name: m.profiles?.full_name?.trim() || m.profiles?.email || "Someone on your team",
    email: m.profiles?.email ?? null,
    role,
  });
  const hostMembers = ((memberRows ?? []) as unknown as PersonRow[])
    .map((m) => person(m, m.role === "owner" ? "Account Host" : "Co-host"))
    .sort((a, b) => Number(b.role === "Account Host") - Number(a.role === "Account Host"));
  const members: TeamMember[] = [
    ...hostMembers,
    ...((leadRows ?? []) as unknown as PersonRow[])
      .filter((l) => !hostMembers.some((h) => h.id === l.user_id))
      .map((l) => person(l, l.role === "co_host" ? "Co-host" : "Volunteer Lead")),
  ];
  const savedKinds = new Map(
    ((notifyRows ?? []) as { kind: NotifyKind; member_ids: string[]; extra_emails: string[] }[]).map((r) => [r.kind, r]),
  );
  // Not saved yet: who gets each kind today (the teacher for bookings, every host for withdrawals, no one for the rest).
  const notifyPicked = Object.fromEntries(
    kinds.map(({ kind }) => [
      kind,
      savedKinds.get(kind)?.member_ids ??
        (kind === "bookings" ? hostMembers.filter((m) => m.id === event.created_by).map((m) => m.id) : kind === "band_withdrew" ? hostMembers.map((m) => m.id) : []),
    ]),
  ) as Partial<Record<NotifyKind, string[]>>;
  const notifyExtras = [...new Set([...savedKinds.values()].flatMap((r) => r.extra_emails))].map((email) => ({
    email,
    kinds: kinds.map((k) => k.kind).filter((k) => savedKinds.get(k)?.extra_emails.includes(email)),
  }));
  const notifySaved = savedKinds.size > 0;
  // What each person's daily volunteer summary includes (none saved before the 20270102000000 update).
  const [me, { data: digestRows }] = await Promise.all([
    requireUser(),
    supabase.from("volunteer_digest_prefs").select("user_id, new_bookings, changes, cancellations").eq("event_id", eventId),
  ]);
  const digestPrefs = Object.fromEntries(
    ((digestRows ?? []) as ({ user_id: string } & DigestPrefs)[]).map(({ user_id, ...p }) => [user_id, p]),
  );
  // Who emails can come from: the account's hosts, each with how the emails would show ("Becca Smith, Boosters via …").
  const senders = ((memberRows ?? []) as unknown as PersonRow[])
    .map((m) => {
      const shown = senderName({
        person: m.profiles?.full_name,
        organization: org?.name,
        school: org?.account_kind === "teacher" ? org.school : null,
      });
      return {
        id: m.user_id,
        label: `${m.profiles?.full_name?.trim() || m.profiles?.email || "Someone on your team"} (${m.role === "owner" ? "Account Host" : "Co-host"})`,
        email: m.profiles?.email ?? null,
        shownAs: `${shown ? `${shown} via ` : ""}${product.name}`,
        owner: m.role === "owner",
      };
    })
    .sort((a, b) => Number(b.owner) - Number(a.owner));
  // Not chosen yet: whoever created the event.
  const savedSender = (replyRow as { sender_id?: string | null } | null)?.sender_id;
  const sender = senders.find((x) => x.id === (savedSender ?? event.created_by)) ?? senders[0];
  const repliesOn = replyRow ? replyRow.replies : true;
  const replyTo = replyRow?.reply_to || sender?.email || (creator?.email as string | undefined) || "";
  const repliesUnavailable = isSchemaError(replyError);
  const bandsHere = hasBands(event.event_type);
  const groupsHere = hasEnsembles(event.event_type);
  // Demo mode adds sample sponsors only where the Sponsors add-on is on.
  const sponsorsHere = section === "more" && isSponsorKind(event.event_type) && (await sponsorsEnabled(event.organization_id));
  const words = groupWords(event.event_type);
  const fileRows = (fileData ?? []) as (EventFile & { uploaded_by: string | null; uploaded_at: string })[];
  const uploaded = await uploadedLines(fileRows, event.timezone);
  const files = fileRows.map((f) => ({
    id: f.id,
    label: f.label,
    meta: fileMeta(f),
    audiences: f.audiences,
    visibleFrom: f.visible_from,
    hiddenNote: isShowing(f, event.timezone) ? null : `Hidden until ${formatDate(f.visible_from!, { year: undefined })}`,
    href: fileHref(f.id),
    uploaded: uploaded.get(f.id) ?? null,
  }));

  // Team: everyone on the tabs (co-hosts of every event, and this event's co-hosts, Volunteer Leads, and
  // Coordinators), counted the same way for everyone who can open this page.
  const [{ count: coHostCount }, { data: eventTeam }] = await Promise.all([
    admin.from("organization_members").select("user_id", { count: "exact", head: true }).eq("organization_id", event.organization_id).eq("role", "admin"),
    admin.from("event_staff").select("user_id, role").eq("event_id", eventId),
  ]);
  const teamCount =
    (coHostCount ?? 0) + new Set((eventTeam ?? []).filter((s) => !conference || s.role === "co_host").map((s) => s.user_id)).size;
  const base = `/dashboard/events/${eventId}/edit`;
  const sections: SettingsSection[] = [
    { id: "details", label: "Event details", done: true, status: eventTypeLabel(event.event_type) },
    { id: "team", label: "Team setup", done: teamCount > 0, status: teamCount ? `${teamCount} ${teamCount === 1 ? "person" : "people"}` : "Optional" },
    { id: "emails", label: "Email settings", done: Boolean(replyRow || notifySaved), status: replyRow || notifySaved ? "Saved" : "Default" },
    ...(conference ? [] : [{ id: "files", label: "Maps and documents", done: files.length > 0, status: files.length ? `${files.length} ${files.length === 1 ? "file" : "files"}` : "Optional" }]),
    { id: "more", label: "Publishing and more", done: event.status === "published", status: event.status === "published" ? "Live" : "Draft" },
  ];
  const published = event.status === "published";
  // Could it be published again after unpublishing? Not after a plan ends, or once another event takes a one-at-a-time spot.
  const republishBlocked = published && section === "more" ? await republishReason(supabase, eventId) : null;
  // A live event: how many people are in it (booked, signed up, or registered), so unpublishing and deleting
  // say what happens to them (light check, 2026-11-08). Only fetched on Publishing and more.
  const onMore = section === "more";
  const [bookedNow, volunteersNow, bandsNow] = onMore
    ? await Promise.all([
        hasConferences(event.event_type) ? conferenceBookedCount(supabase, eventId) : Promise.resolve(0),
        usesJobs(event.event_type)
          ? supabase.from("volunteers").select("id", { count: "exact", head: true }).eq("event_id", eventId).then((r) => r.count ?? 0)
          : Promise.resolve(0),
        hasEnsembles(event.event_type)
          ? supabase.from("bands").select("id", { count: "exact", head: true }).eq("event_id", eventId).is("scratched_at", null).then((r) => r.count ?? 0)
          : Promise.resolve(0),
      ])
    : [0, 0, 0];
  const people = (n: number, one: string, many: string) => (n === 1 ? `1 ${one} has` : `${n} ${many} have`);
  // What unpublishing stops, in each kind's own words, and what happens to the people already in it.
  const unpublishIntro = hasConferences(event.event_type)
    ? `Your booking page is live${bookedNow ? `, and ${people(bookedNow, "person", "people")} booked` : ""}. Unpublishing hides the page and stops new bookings.${bookedNow ? " Their times stay booked, and nobody is emailed." : " Nobody is emailed."}`
    : event.event_type === "band_contest"
      ? `Your event is live${bandsNow || volunteersNow ? `, and ${[bandsNow ? people(bandsNow, "band", "bands").replace(/ ha(s|ve)$/, "") : null, volunteersNow ? people(volunteersNow, "volunteer", "volunteers").replace(/ ha(s|ve)$/, "") : null].filter(Boolean).join(" and ")} ${bandsNow + volunteersNow === 1 ? "has" : "have"} signed up` : ""}. Unpublishing hides its public pages and closes band registration and volunteer sign-up.${bandsNow || volunteersNow ? " They stay registered and signed up, and nobody is emailed." : " Nobody is emailed."} After you publish again, open volunteer sign-up again from the event page.`
      : hasRooms(event.event_type)
        ? `Your festival is live.${[
            bandsNow ? ` ${bandsNow === 1 ? "1 group has" : `${bandsNow} groups have`} registered` : "",
            volunteersNow ? `${bandsNow ? " and" : ""} ${volunteersNow === 1 ? "1 volunteer has" : `${volunteersNow} volunteers have`} signed up` : "",
          ].join("")}${bandsNow || volunteersNow ? "." : ""} Unpublishing hides the festival page and closes group registration and volunteer sign-up.${bandsNow || volunteersNow ? " They stay registered and signed up, and nobody is emailed." : " Nobody is emailed."}`
      : event.event_type === "volunteer"
        ? `Your event is live${volunteersNow ? `, and ${people(volunteersNow, "volunteer", "volunteers")} signed up` : ""}. Unpublishing hides its public pages and closes volunteer sign-up.${volunteersNow ? " They keep their shifts, and nobody is emailed." : " Nobody is emailed."}`
        : "Your event is live. Unpublishing hides its public pages and stops every sign-up and registration. Nobody is emailed.";
  // Deleting: what goes with it.
  const deleteWhat = hasConferences(event.event_type) && bookedNow
    ? `Removes the event and its ${bookedNow === 1 ? "1 booking" : `${bookedNow} bookings`}.`
    : hasEnsembles(event.event_type) && (bandsNow || volunteersNow)
      ? `Removes the event and its ${[bandsNow ? `${bandsNow} registered ${bandsNow === 1 ? words.one : words.many}` : null, volunteersNow ? (volunteersNow === 1 ? "1 volunteer" : `${volunteersNow} volunteers`) : null].filter(Boolean).join(" and ")}.`
      : usesJobs(event.event_type) && volunteersNow
        ? `Removes the event and its ${volunteersNow === 1 ? "1 volunteer" : `${volunteersNow} volunteers`}.`
        : null;
  // A live festival's registration: open, closed early (reopens until the deadline), or past its deadline (reopens with a new one).
  const today = utcToZonedDate(new Date().toISOString(), event.timezone);
  const regDeadline = event.band_registration_deadline as string | null;
  const regPast = Boolean(regDeadline && regDeadline < today);
  const festivalRegistration = {
    state: regPast ? ("past" as const) : event.band_registration_open ? ("open" as const) : ("closed" as const),
    until: regDeadline ? `the end of ${formatDate(regDeadline, { year: undefined })}` : "you close it",
    intro: regPast
      ? `Registration closed at the end of ${formatDate(regDeadline!, { year: undefined })}. To give directors more time, reopen it with a new deadline before the festival.`
      : event.band_registration_open
        ? `Open${regDeadline ? ` through ${formatDate(regDeadline, { year: undefined })}` : ""}. It closes on its own after the deadline. Close it early if your festival is full.`
        : `Closed early. ${regDeadline ? `You can reopen it until ${formatDate(regDeadline, { year: undefined })}.` : "You can reopen it any time."}`,
    affected: `Directors can't register, change, or withdraw a group until you reopen it.${bandsNow ? ` The ${bandsNow === 1 ? "1 group" : `${bandsNow} groups`} already registered keep their place.` : ""} The registration link says registration is closed. Nobody is emailed. You can reopen it here.`,
  };
  const afterUnpublish = republishBlocked
    ? `${republishBlocked} If you unpublish it, you can't publish it again until that changes.`
    : "You can publish again anytime.";
  // Demo mode, for FieldCommand admins (src/lib/demo.ts).
  const demo =
    section === "more" && (await supabase.rpc("is_platform_admin")).data
      ? {
          active: Boolean(
            (await createAdminClient().from("demo_events").select("event_id").eq("owner_id", (await requireUser()).id).eq("event_id", eventId).maybeSingle()).data,
          ),
        }
      : null;
  const conferenceHere = conference;
  const booking = bookingWords(event.event_type);

  return (
    // data-required-marks: a small asterisk on each box that has to be filled in (globals.css).
    <div className="mx-auto max-w-5xl" data-required-marks>
      {guided ? (
        <SetupHeader current={section} back={{ href: `/dashboard/events/${eventId}`, label: "Save and finish later", guard: true }} />
      ) : (
        <>
          {/* The Details step has no "Back to" link (it would jump ahead to Publish); Event settings opened during setup goes back to the steps. */}
          {!stepOnly && (
            <Link href={`/dashboard/events/${eventId}`} className="mb-3 inline-block text-sm text-muted hover:text-foreground">
              ← {!published && steppedSetup ? "Back to setup" : `Back to ${event.name}`}
            </Link>
          )}
          <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{stepOnly ? "Event details" : "Event settings"}</h1>
          <SavedBy eventId={eventId} area={["details", "files"]} className="mt-2" />
          {/* Only where there are boxes to fill in. */}
          {section !== "more" && <p className="mt-1 text-sm text-muted">Boxes marked * are required.</p>}
        </>
      )}
      {/* A meetings draft's Details step: the step bar is the one menu, so no second one beside it (decisions 2026-11-08). */}
      <div className={guided || stepOnly ? "mt-6" : "mt-6 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8"}>
        {!guided && !stepOnly && <SettingsNav sections={sections} current={section} base={base} />}
        <div id="settings-panel" className="min-w-0 space-y-6">
          {section === "details" && (
            <>
              <Panel
                title="Event details"
                intro={
                  when
                    ? `The name and time zone everyone sees. The day or weekly hours are set in ${when.setupName}.`
                    : setup
                      ? "The name and time zone everyone sees."
                      : "The name, dates, times, and venue everyone sees."
                }
              >
                <EventForm
                  action={updateEvent.bind(null, eventId)}
                  organizationId={event.organization_id}
                  initial={{
                    name: event.name,
                    startsOn: event.starts_on,
                    endsOn: event.ends_on,
                    startTime: utcToZonedTime(event.window_start, event.timezone),
                    endTime: utcToZonedTime(event.window_end, event.timezone),
                    timezone: event.timezone,
                    venue: {
                      name: event.venue_name,
                      address: event.venue_address,
                      placeId: event.venue_place_id,
                      lat: event.venue_lat,
                      lng: event.venue_lng,
                    },
                    askChildName,
                  }}
                  venueSearchEnabled={isPlacesConfigured}
                  submitLabel={guided ? "Save and continue" : "Save changes"}
                  hasShifts={(count ?? 0) > 0}
                  eventType={event.event_type}
                  when={when}
                  stickySave={!guided}
                  autosave={!guided && !published}
                  next={
                    stepOnly
                      ? event.event_type === "volunteer"
                        ? { href: `/dashboard/events/${eventId}/volunteering`, label: "Next up: Jobs and shifts" }
                        : event.event_type === "band_contest"
                          ? { href: `/dashboard/events/${eventId}/bands`, label: "Next up: Band registration" }
                          : hasRooms(event.event_type)
                            ? { href: `/dashboard/events/${eventId}/rooms`, label: "Next up: Rooms and schedule" }
                          : { href: `/dashboard/events/${eventId}/conferences/times`, label: "Next up: Meeting times" }
                      : undefined
                  }
                  setup={guided ? { next: nextStep } : undefined}
                  extra={guided && badgesHere ? <SetupLogo eventId={eventId} logo={brand.logo} color={brand.color} /> : undefined}
                />
              </Panel>

              {/* In the guided setup, the logo sits in the details step's own box, above Save and continue. */}
              {badgesHere && !guided && (
                <Panel id="logo" title="Logo and color">
                  <p className="text-sm text-muted">
                    {/* Each kind hears where its logo shows first (light check, 2026-11-08). */}
                    {event.event_type === "band_contest"
                      ? "One logo for your account, shown next to ours on your registration page and each band's page, and printed on volunteer badges."
                      : "One logo for your account, shown next to ours at the top of your public event pages and printed on volunteer badges."}{" "}
                    Print badges from{" "}
                    <Link href={`/dashboard/events/${eventId}/volunteering/badges`} className="font-medium text-brand underline">
                      {volunteerAreaName(event.event_type)}
                    </Link>
                    .
                  </p>
                  <div className="mt-3">
                    <LogoForm eventId={eventId} logo={brand.logo} color={brand.color} />
                  </div>
                  {brandSwitch}
                </Panel>
              )}
              {/* Conferences don't set the logo here, but can switch off the one the account has. */}
              {!badgesHere && hasBrand && !guided && (
                <Panel id="logo" title="Your account's logo and color" intro="Set on your account's other events. You can leave them off this one.">
                  {brandSwitch}
                </Panel>
              )}

            </>
          )}

          {section === "files" && (
            <Panel
              title="Maps and documents"
              intro={
                groupsHere
                  ? `Share a ${bandsHere ? "stadium" : "building"} map, parking map, or director packet. Choose who sees each one: the public page, ${words.one} directors, volunteers, or your team.`
                  : "Share a site map, parking map, or volunteer guide. Choose who sees each one: the public page, volunteers, or your team."
              }
            >
              <FilesManager
                files={files}
                audiences={groupsHere ? AUDIENCES : AUDIENCES.filter((a) => a.value !== "directors")}
                prepareUpload={prepareUpload.bind(null, eventId)}
                saveFile={saveFile.bind(null, eventId)}
                deleteFile={deleteFile.bind(null, eventId)}
                canNotify={bandsHere}
              />
            </Panel>
          )}
          {section === "files" && stepFooter}

          {section === "team" && (
            <div>
              <h2 className="text-xl font-semibold">Team setup</h2>
              <p className="mb-4 mt-1 text-sm text-muted">
                {conference
                  ? "Co-hosts share your account: they can see your bookings, and reschedule or cancel meetings."
                  : `Everyone helping you run ${event.name}, one tab per role. ${leadWords(event.event_type).many} can also be added from each ${usesJobs(event.event_type) ? `job in ${volunteerAreaName(event.event_type)}` : "sign-up in Volunteer Setup"}.`}
              </p>
              <TeamRoles eventId={eventId} roles={conference ? ["hosts"] : ["hosts", "volunteer-leads", "section-leads"]} open={typeof tab === "string" ? tab : null}
                href={(t) => `${guided ? setupHref(eventId, "team") : `/dashboard/events/${eventId}/edit?section=team`}&tab=${t}`}
              />
              {stepFooter}
            </div>
          )}

          {section === "emails" && (
            <EmailStep setup={guided} action={saveEmailSetup.bind(null, eventId, nextStep ?? `/dashboard/events/${eventId}`)} back={prevStep} skip={nextStep}>
              <Panel
                title="Who emails come from"
                intro="Everyone who gets an email about this event sees this name. Pick who it's from, and whether people can reply."
              >
                {repliesUnavailable ? (
                  <p className="text-sm text-muted">
                    A database update is needed before this can be set up. See “Applying database updates” in the setup guide.
                  </p>
                ) : (
                  <RepliesForm
                    bare={guided}
                    action={saveReplies.bind(null, eventId)}
                    replies={repliesOn}
                    replyTo={replyTo}
                    senders={senders.map(({ id, label, shownAs }) => ({ id, label, shownAs }))}
                    sender={sender?.id ?? null}
                    who={
                      conference
                        ? "Families"
                        : groupsHere
                          ? `${words.one[0].toUpperCase()}${words.one.slice(1)} directors and volunteers`
                          : hasParents(event.event_type)
                            ? "Families and volunteers"
                            : "Volunteers"
                    }
                  />
                )}
              </Panel>

              <Panel
                id="notifications"
                title="Who gets notifications"
                intro="Pick who gets each kind of email about this event. Volunteers, families, and directors get their own emails either way."
              >
                {isSchemaError(notifyError) ? (
                  <p className="text-sm text-muted">
                    A database update is needed before notifications can be set up. See “Applying database updates” in the setup guide.
                  </p>
                ) : (
                  <>
                    <NotifyForm
                      bare={guided}
                      action={saveNotifyRecipients.bind(null, eventId)}
                      kinds={kinds}
                      members={members}
                      picked={notifyPicked}
                      extras={notifyExtras}
                      max={MAX_EXTRA_EMAILS}
                      digestPrefs={digestPrefs}
                      meId={me.id}
                    />
                    <p className="mt-3 text-sm text-muted">
                      Someone missing?{" "}
                      <Link href={guided ? setupHref(eventId, "team") : `${base}?section=team`} className="font-medium text-brand underline">
                        Add them in Team setup
                      </Link>
                      .
                    </p>
                  </>
                )}
              </Panel>
            </EmailStep>
          )}

          {section === "more" && (
            <>
              <Panel
                title="Publishing"
                intro={
                  published
                    ? `${unpublishIntro} ${afterUnpublish}`
                    : guided
                      ? "Ready for people to see it? Publish now and your event page goes live. You can also publish later from your event page."
                      : "Your event isn't published yet. Publish it from the event page when you're ready."
                }
              >
                {!published && guided ? (
                  <ActionButton action={publishAndOpen.bind(null, eventId)} variant="go" pendingText="Publishing…">
                    Publish event
                  </ActionButton>
                ) : published ? (
                  <ActionButton
                    action={setEventPublished.bind(null, eventId, false)}
                    // Reversible, so an outline: red is kept for deleting.
                    variant="secondary"
                    confirmMessage={`Unpublish? ${unpublishIntro} ${afterUnpublish}`}
                  >
                    Unpublish event
                  </ActionButton>
                ) : (
                  <Link href={`/dashboard/events/${eventId}#publish`} className="inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand">
                    Go to Publish
                  </Link>
                )}
              </Panel>

              {/* A live festival closes (and reopens) registration here, away from its event page (owner, 2026-11-11). */}
              {published && hasRooms(event.event_type) && (
                <Panel id="registration" title="Group registration" intro={festivalRegistration.intro}>
                  <div className="flex flex-wrap items-center gap-2">
                    {festivalRegistration.state === "open" ? (
                      <ActionButton
                        action={setBandRegistrationOpen.bind(null, eventId, false)}
                        // Reversible, so an outline: the confirm window says who's affected.
                        variant="secondary"
                        pendingText="Closing…"
                        confirmMessage={`Close group registration? ${festivalRegistration.affected}`}
                        confirmLabel="Close registration"
                      >
                        Close registration
                      </ActionButton>
                    ) : festivalRegistration.state === "closed" ? (
                      <ActionButton
                        action={setBandRegistrationOpen.bind(null, eventId, true)}
                        variant="secondary"
                        pendingText="Reopening…"
                        confirmMessage={`Reopen group registration? Directors can register, change, or withdraw a group again until ${festivalRegistration.until}. Nobody is emailed.`}
                        confirmLabel="Reopen registration"
                      >
                        Reopen registration
                      </ActionButton>
                    ) : (
                      <ReopenRegistration action={reopenBandRegistration.bind(null, eventId)} today={today} deadlineRequired />
                    )}
                  </div>
                </Panel>
              )}

              <Panel id="kind" title="Kind of event" intro="What the event is for decides which pages and tools it has.">
                <div className="space-y-3">
                  <p>
                    This is {isMeeting(event.event_type) ? "for " : "a "}<strong>{event.event_type === "conference" ? "parent-teacher conference" : eventTypeLabel(event.event_type).toLowerCase()}</strong>.{" "}
                    <span className="text-muted">{TYPE_SUMMARY[event.event_type as keyof typeof TYPE_SUMMARY] ?? TYPE_SUMMARY.band_contest}</span>
                  </p>
                  {hasConferences(event.event_type) ? (
                    <p className="text-sm text-muted">
                      {isMeeting(event.event_type) ? "Meetings stay meetings" : "A conference stays a conference"}. For another kind of event, create a new one.
                    </p>
                  ) : groupsHere && (bandCount ?? 0) > 0 ? (
                    <p className="text-sm text-muted">
                      {bandCount} {bandCount === 1 ? `${words.one} has` : `${words.many} have`} registered, so this has to stay a{" "}
                      {eventTypeLabel(event.event_type).toLowerCase()}.
                    </p>
                  ) : hasBooths(event.event_type) && (boothCount ?? 0) > 0 ? (
                    <p className="text-sm text-muted">This fair has booths and partners, so it has to stay a school fair.</p>
                  ) : hasParents(event.event_type) && (parentCount ?? 0) > 0 ? (
                    <p className="text-sm text-muted">
                      {parentCount} parent{parentCount === 1 ? " has" : "s have"} registered, so this has to stay a school visitor event.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {EVENT_TYPES.filter((t) => t.value !== (event.event_type ?? "band_contest") && !hasConferences(t.value)).map((t) => (
                        <ActionButton
                          key={t.value}
                          action={setEventType.bind(null, eventId, t.value)}
                          variant="secondary"
                          confirmMessage={`Make this a ${t.label.toLowerCase()}? ${SWITCH_NOTE[t.value as keyof typeof SWITCH_NOTE]} Volunteers and shifts stay as they are.`}
                        >
                          Make it a {t.label.toLowerCase()}
                        </ActionButton>
                      ))}
                    </div>
                  )}
                </div>
              </Panel>

              {demo && !guided && (
                <Panel title="Try it as someone else">
                  <div className="space-y-3">
                  <p className="text-sm leading-6 text-muted">
                    {conferenceHere
                      ? booking.child
                        ? "Show a teacher how conferences work, as the teacher or as a parent booking a time."
                        : "Show how meetings work, as the organizer or as someone booking a time."
                      : "See this event the way each person on it does, without switching emails."}
                  </p>
                  <details className="text-sm leading-6 text-muted">
                    <summary className="cursor-pointer font-medium text-foreground">How demo works</summary>
                    {conferenceHere ? (
                      <div className="mt-2 space-y-2">
                        <p>
                          {booking.child ? (
                            <>
                              Tap <strong className="text-foreground">Teacher</strong> to see it as the teacher, or{" "}
                              <strong className="text-foreground">Parent</strong> to see the booking page a family gets (publish the conference first).
                            </>
                          ) : (
                            <>
                              Tap <strong className="text-foreground">Organizer</strong> to see it as yourself, or{" "}
                              <strong className="text-foreground">Someone booking</strong> to see the booking page people get (publish your meetings first).
                            </>
                          )}
                          A bar at the top switches between them; <strong className="text-foreground">Back to me</strong> returns you here.
                        </p>
                        <p>
                          The first time, about two of every three meeting times fill with sample {booking.child ? "families" : "people"} (up
                          to eight). If there are no meeting times yet, sample ones are set up (15-minute meetings, their choice of how to
                          meet, Room 214). Sample {booking.child ? "families" : "people"} never get emails, and <strong className="text-foreground">Remove demo people</strong> takes all of it back off.
                        </p>
                      </div>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <p>
                          Tap a role and this browser signs in as a demo person in that role: a co-host, a Volunteer Lead, a Coordinator (of
                          the first stations),{groupsHere && <> the director of &ldquo;Demo High School&rdquo;,</>} a volunteer with a shift,
                          or a parent looking at the public page. A bar at the top switches roles; <strong className="text-foreground">Back to me</strong>{" "}
                          takes the demo people and sample data back off and returns you here, still signed in.
                        </p>
                        <p>
                          The first time, the event fills with sample data for its kind: sign-ups and shifts with a dozen volunteers
                          {bandsHere ? ", six bands" : groupsHere ? ", five groups and three rooms" : ""}
                          {event.event_type === "school_visit" ? ", and 400 sample families with one to three children each" : ""}
                          {event.event_type === "fair" ? ", eight booths across four zones" : ""}
                          {sponsorsHere ? ", and nine made-up sponsors with logos at four levels (unless it has sponsors already)" : ""}. Use a practice event: the demo people
                          really are on it. Sample people never get emails, and <strong className="text-foreground">Remove demo people</strong>{" "}
                          takes all of it back off.
                        </p>
                      </div>
                    )}
                  </details>
                  <DemoStart eventId={eventId} personas={personasFor(event.event_type)} active={demo.active} />
                  </div>
                </Panel>
              )}

              {guided ? (
                stepFooter
              ) : !isAccountHost ? null : (
                <Panel title="Delete this event" intro={`${deleteWhat ?? "Removes the event and everything in it."} This can't be undone.`}>
                  <DeleteEventButton name={event.name} action={deleteEvent.bind(null, eventId)} />
                </Panel>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** One titled card in a settings section. */
function Panel({ id, title, intro, children }: { id?: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

/**
 * Email settings: each form saves on its own, or in the guided setup, one form
 * around both that Continue saves before the next step.
 */
function EmailStep({
  setup,
  action,
  back,
  skip,
  children,
}: {
  setup: boolean;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  back?: string;
  skip?: string;
  children: React.ReactNode;
}) {
  if (!setup) return <>{children}</>;
  return (
    <ActionForm action={action} resetOnSuccess={false} className="space-y-6">
      {/* Where to go once saved: the next step, or wherever Back or Save and finish later was pressed. */}
      <input type="hidden" name="next" value="" />
      {children}
      <SetupFooter back={back} skip={skip} submit={<SubmitButton pendingText="Saving…">Continue</SubmitButton>} />
    </ActionForm>
  );
}

/**
 * Why this live event couldn't be published again if it were unpublished now
 * (org_can_publish answers as if it were a draft), or null when it could.
 */
async function republishReason(supabase: Awaited<ReturnType<typeof createClient>>, eventId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("org_can_publish", { p_event: eventId });
  return !error && typeof data === "string" ? data : null;
}

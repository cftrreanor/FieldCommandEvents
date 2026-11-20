import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getEventAccess } from "@/lib/data";
import { duplicateCounts } from "@/lib/duplicate-event";
import { canDuplicateKind, comesOverParts, coordinatorWords, duplicateBack, listAnd, longRange, mapsAndDocuments, plural } from "@/lib/duplicate-words";
import { eventTypeLabel } from "@/lib/event-types";
import { loadAccountHost } from "@/lib/plan";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { formatTimeRange, utcToZonedDate } from "@/lib/time";
import { DuplicateForm, type DuplicateSource } from "./duplicate-form";

export const metadata: Metadata = { title: "Duplicate event" };

/**
 * Duplicate event (owner decisions: docs/design-decisions/2026-11-20-duplicate-event.md): one page from every way
 * in (New event, My events, Event settings). The organizer names the copy and picks its new first day; the page
 * says what comes over and what starts fresh. The database decides who may (duplicate_event); a Co-host of one
 * event is told who can do it for them.
 */
export default async function DuplicatePage({ params, searchParams }: PageProps<"/dashboard/events/[eventId]/duplicate">) {
  const { eventId } = await params;
  const { from, name: keptName, on: keptOn } = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();
  const { data: ev } = await supabase
    .from("events")
    .select("id, name, event_type, status, organization_id, timezone, starts_on, ends_on, venue_name, band_registration_deadline, band_registration_opens_on, classifications")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) missing();
  const back = duplicateBack(typeof from === "string" ? from : undefined, eventId, ev.event_type ?? "");
  const header = (
    <>
      <Link href={back.href} className="mb-3 inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground">
        ← {back.label}
      </Link>
      <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Duplicate event</h1>
    </>
  );
  if (!canDuplicateKind(ev.event_type)) {
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <Card className="mt-6 text-sm leading-6">
          <p>
            {eventTypeLabel(ev.event_type)}s can&apos;t be duplicated yet. Only events with volunteer jobs can: volunteer events, school fairs, band
            contests, and festivals.
          </p>
        </Card>
      </div>
    );
  }

  const [{ data: admin }, access] = await Promise.all([supabase.rpc("is_org_admin", { org: ev.organization_id }), getEventAccess(eventId)]);
  if (!admin) {
    // Anyone who doesn't host it goes back to their own events.
    if (!access.isHost) redirect("/dashboard");
    // A Co-host of this event only: who can do it for them (the same panel as Event settings).
    const host = await loadAccountHost(supabase, ev.organization_id, user.id);
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <Card className="mt-6 space-y-3 text-sm leading-6">
          <p className="font-semibold">{host.name ? `${host.name} can duplicate this event for you.` : "Your Account Host can duplicate this event for you."}</p>
          <p className="text-muted">Only the Account Host and Co-hosts of every event can duplicate events. You&apos;re a Co-host of {ev.name} only.</p>
          {host.email && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <a
                href={`mailto:${host.email}?subject=${encodeURIComponent(`Duplicate ${ev.name}?`)}`}
                className="inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand"
              >
                Email {host.name.split(/\s+/)[0] || "them"}
              </a>
              <span className="text-muted [overflow-wrap:anywhere]">{host.email}</span>
            </p>
          )}
        </Card>
      </div>
    );
  }

  const tz = ev.timezone || "America/Chicago";
  const [{ data: stationRows }, { data: shiftRows }, { data: fileRows }, { data: leadRows }, { data: staffRows }, { data: memberRows }, { data: pendingRows }, { count: volunteers }, { count: bands }, { count: rooms }] =
    await Promise.all([
      supabase.from("stations").select("id, name, checkpoint_kind").eq("event_id", eventId).order("sort_order").order("created_at"),
      supabase.from("shifts").select("station_id, starts_at, ends_at").eq("event_id", eventId).order("starts_at"),
      supabase.from("event_files").select("label, file_name").eq("event_id", eventId).order("created_at"),
      supabase.from("station_leads").select("station_id, user_id").eq("event_id", eventId).order("created_at"),
      supabase.from("event_staff").select("user_id, role, profiles(full_name, email)").eq("event_id", eventId),
      supabase.from("organization_members").select("user_id, profiles(full_name, email)").eq("organization_id", ev.organization_id),
      // Invitations to lead a job that nobody accepted: they don't come over (held ones belong to a copy, never a source).
      supabase.from("invitations").select("email, station_id").eq("event_id", eventId).eq("role", "section_lead").is("accepted_at", null).not("token", "is", null),
      supabase.from("volunteers").select("id", { count: "exact", head: true }).eq("event_id", eventId),
      supabase.from("bands").select("id", { count: "exact", head: true }).eq("event_id", eventId),
      ev.event_type === "group_event" ? supabase.from("rooms").select("id", { count: "exact", head: true }).eq("event_id", eventId) : Promise.resolve({ count: 0 }),
    ]);
  const stations = (stationRows ?? []) as { id: string; name: string; checkpoint_kind: string | null }[];
  const jobName = (id: string | null) => stations.find((s) => s.id === id)?.name ?? "a job";
  type P = { full_name: string | null; email: string | null } | null;
  const people = new Map<string, { name: string; member: boolean }>();
  for (const r of (staffRows ?? []) as unknown as { user_id: string; profiles: P }[]) people.set(r.user_id, { name: r.profiles?.full_name || r.profiles?.email || "A team member", member: false });
  for (const r of (memberRows ?? []) as unknown as { user_id: string; profiles: P }[]) people.set(r.user_id, { name: r.profiles?.full_name || r.profiles?.email || "A team member", member: true });
  // One line per person, with every job they lead (the copy sends each one invitation).
  const leads = new Map<string, { name: string; member: boolean; jobs: string[] }>();
  for (const l of (leadRows ?? []) as { station_id: string; user_id: string }[]) {
    const p = people.get(l.user_id) ?? { name: "A team member", member: false };
    const entry = leads.get(l.user_id) ?? { ...p, jobs: [] };
    entry.jobs.push(jobName(l.station_id));
    leads.set(l.user_id, entry);
  }
  const coordinators = [...leads.values()];
  // The same counts as Event settings' panel and New event (duplicateCounts), so every screen agrees.
  const counts = (await duplicateCounts([eventId], ev.organization_id)).get(eventId)!;
  // Co-hosts and Volunteer Leads of this event only don't come over: named.
  const notAdded = ((staffRows ?? []) as unknown as { user_id: string; role: string; profiles: P }[])
    .filter((r) => (r.role === "co_host" || r.role === "volunteer_director") && !people.get(r.user_id)?.member)
    .map((r) => `${r.profiles?.full_name || r.profiles?.email || "A team member"} (${r.role === "co_host" ? "Co-host" : "Volunteer Lead"} of ${ev.name} only)`);

  const source: DuplicateSource = {
    id: ev.id,
    name: ev.name,
    kind: ev.event_type,
    startsOn: ev.starts_on,
    endsOn: ev.ends_on,
    dates: longRange(ev.starts_on, ev.ends_on),
    today: utcToZonedDate(new Date().toISOString(), tz),
    shifts: ((shiftRows ?? []) as { station_id: string; starts_at: string; ends_at: string }[]).map((s) => ({
      job: jobName(s.station_id),
      day: utcToZonedDate(s.starts_at, tz),
      time: formatTimeRange(s.starts_at, s.ends_at, tz, { zone: false }),
    })),
    deadline: ev.band_registration_deadline,
    opensOn: ev.band_registration_opens_on,
    counts,
    copying: comesOverParts(ev.event_type, counts, false),
  };

  const jobs = plural(stations.length, "job", "jobs");
  const stops = stations.filter((s) => s.checkpoint_kind).length;
  const files = (fileRows ?? []).map((f) => f.label || f.file_name);
  const mapsLine = files.length ? (
    <li>
      {mapsAndDocuments(files.length)} ({listAnd(files)}), hidden until you publish
    </li>
  ) : null;
  const pending = ((pendingRows ?? []) as { email: string; station_id: string | null }[]).map((p) => `${p.email}'s invitation for ${jobName(p.station_id)}`);
  const classifications = (ev.classifications ?? []).length;
  const shiftsLine = `${plural(source.counts.shifts, "shift", "shifts")} on the new dates, at the same times of day, with the same number of spots`;
  // Everything comes over except volunteers, personal details, and dates (owner decision): typed-in dates are blanked.
  const newDateLine = <li>Dates typed into descriptions and notes are left as &ldquo;[new date]&rdquo; for you to fill in</li>;

  // What comes over and what starts fresh, in each kind's own words (the shared "Starts fresh" lines last).
  const comesOver =
    ev.event_type === "band_contest" ? (
      <>
        <li>Name, venue, times, time zone, and description</li>
        <li>
          Registration setup: {plural(classifications, "classification", "classifications")}, information for directors, payment link, chaperone limit,
          meals, and contact for directors
        </li>
        {newDateLine}
        <li>Registration dates, moved by the same number of days (left blank if that&apos;s in the past)</li>
        <li>Ready times and equipment spots</li>
        {stations.length > 0 && (
          <li>
            {plural(stations.length, "volunteer job", "volunteer jobs")}
            {stops ? `, ${plural(stops, "check-in stop", "check-in stops")}` : ""}, {plural(source.counts.shifts, "shift", "shifts")}
            {source.counts.items ? `, and ${plural(source.counts.items, "thing to bring", "things to bring")}` : ""}
          </li>
        )}
        {mapsLine}
      </>
    ) : ev.event_type === "group_event" ? (
      <>
        <li>Name, venue, times, time zone, and description</li>
        <li>{plural(rooms ?? 0, "room", "rooms")}, minutes per group, and walking time</li>
        {newDateLine}
        <li>
          Registration setup: {plural(classifications, "classification", "classifications")}, registration questions, information for directors, payment
          link, meals, and contact for directors
        </li>
        <li>Registration dates, moved by the same number of days (left blank if that&apos;s in the past)</li>
        {stations.length > 0 && (
          <li>
            {plural(stations.length, "volunteer job", "volunteer jobs")} and {plural(source.counts.shifts, "shift", "shifts")}
            {source.counts.items ? `, and ${plural(source.counts.items, "thing to bring", "things to bring")}` : ""}
          </li>
        )}
        {mapsLine}
      </>
    ) : (
      <>
        <li>Name, venue, times, time zone, and description</li>
        {stations.length > 0 && (
          <li>
            {jobs}, with their instructions and age rules ({listAnd(stations.map((s) => s.name))})
          </li>
        )}
        {source.counts.shifts > 0 && <li>{shiftsLine}</li>}
        {source.counts.items > 0 && <li>{plural(source.counts.items, "thing to bring", "things to bring")}, with how many of each are needed</li>}
        {ev.event_type === "fair" && <li>Zones</li>}
        {mapsLine}
        {newDateLine}
      </>
    );
  const startsFresh = (
    <>
      {ev.event_type === "band_contest" ? (
        <>
          <li>Bands and director invitations{bands ? `: the ${plural(bands, "band", "bands")} registered stay on ${ev.name}` : ""}</li>
          <li>The performance schedule</li>
        </>
      ) : ev.event_type === "group_event" ? (
        <>
          <li>Groups and their times{bands ? `: the ${plural(bands, "group", "groups")} registered stay on ${ev.name}` : ""}</li>
          <li>Who arrived and which rooms were done</li>
        </>
      ) : null}
      <li>Volunteers{volunteers ? `: the ${plural(volunteers, "volunteer who signed up stays", "volunteers who signed up stay")} on ${ev.name}` : " aren't copied"}</li>
      <li>{ev.event_type === "band_contest" || ev.event_type === "group_event" ? "Sponsors, check-ins, and announcements" : "Check-ins and announcements"}</li>
      <li>Where replies go, and who gets notified</li>
      {notAdded.length > 0 ? (
        notAdded.map((n) => <li key={n}>{n} isn&apos;t added</li>)
      ) : (
        <li>Co-hosts and Volunteer Leads of {ev.name} only</li>
      )}
      {pending.length > 0 && <li>{listAnd(pending)}, never accepted</li>}
    </>
  );

  const invited = coordinators.filter((c) => !c.member);
  const members = coordinators.filter((c) => c.member);
  const who = (list: typeof coordinators) => listAnd(list.map((c) => `${c.name} (${listAnd(c.jobs)})`));
  const coordinatorLine =
    coordinators.length === 0 ? null : (
      <>
        <p className="font-semibold">{coordinatorWords(counts.coordinators, counts.invited)}</p>
        {invited.length > 0 && (
          <>
            <p>
              <span className="font-semibold">
                {invited.length === 1 ? "1 comes over as an invitation." : `${invited.length} come over as invitations.`}
              </span>{" "}
              You choose who&apos;s emailed when you publish.{" "}
              {invited.length === 1 ? "They're asked again, so they can say yes for the new dates." : "Each is asked again, so they can say yes for the new dates."}
            </p>
            <p className="text-muted">{who(invited)}</p>
          </>
        )}
        {members.length > 0 && (
          <p className={invited.length ? "mt-2" : undefined}>
            <span className="font-semibold">Already on your team, so they keep leading the same {members.length === 1 && members[0].jobs.length === 1 ? "job" : "jobs"}:</span>{" "}
            <span className="text-muted">{who(members)}</span>
          </p>
        )}
      </>
    );

  return (
    <div className="mx-auto max-w-3xl" data-required-marks>
      {header}
      <p className="mt-2 text-muted">
        A new draft from {ev.name} ({source.dates}). Nothing on {ev.name} changes.
      </p>
      <DuplicateForm
        source={source}
        initialName={typeof keptName === "string" ? keptName.slice(0, 120) : suggestedName(ev.name)}
        // Without a year to move on, the name starts selected so typing replaces it.
        selectName={typeof keptName !== "string" && suggestedName(ev.name) === ev.name}
        initialDay={typeof keptOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(keptOn) && keptOn >= source.today ? keptOn : ""}
        comesOver={comesOver}
        startsFresh={startsFresh}
        coordinatorLine={coordinatorLine}
        cancelHref={back.href}
      />
    </div>
  );
}

/** "Fall Park Cleanup 2026" becomes "Fall Park Cleanup 2027"; a name without a year stays (selected, to type over). */
function suggestedName(name: string) {
  return name.replace(/\b(20\d\d)\b/, (y) => String(Number(y) + 1)).slice(0, 120);
}

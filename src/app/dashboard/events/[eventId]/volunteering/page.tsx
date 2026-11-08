import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { Badge, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { isSchemaError } from "@/lib/schema-check";
import { ALL_DIGEST, type DigestPrefs } from "@/lib/notify-kinds";
import { loadNotifyRecipients } from "@/lib/notify-recipients";
import { saveMyDigestPrefs } from "../../../notify-actions";
import { DigestCard } from "./digest-card";
import { getEventAccess, getOrigin } from "@/lib/data";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { eachDate, formatDate, formatTimeRange, utcToZonedDate, utcToZonedTime } from "@/lib/time";
import { importVolunteers } from "@/app/dashboard/import-actions";
import { SpreadsheetImport } from "@/components/spreadsheet-import";
import { importFields, type Choice } from "@/lib/imports";
import { createStation, moveCheckpoint, publishAndOpenSignups, setVolunteerSignupOpen } from "../../../actions";
import { ActionButton, CopyLinkButton, NewStationForm, type LeadOption } from "../forms";
import { StationTabs, UnsavedChangesProvider } from "./station-steps";
import { FAIR_ZONES, hasBands, hasBooths, hasRooms, leadWords, usesJobs } from "@/lib/event-types";
import { kindLabel, sortStations } from "@/lib/contest-day";
import { CheckInOrderList } from "./check-in-order";
import { twoWeeksBefore } from "@/lib/setup-checklist";
import { JobSignups, StationPanel, type ItemSignup, type RosterEntry, type Shift, type Station, type StationItem } from "../station-panel";
import { SavedBy } from "@/components/saved-by";
import { volunteerTotals } from "@/lib/volunteer-totals";
import { LineIcon } from "@/components/line-icon";

export async function generateMetadata({ params }: PageProps<"/dashboard/events/[eventId]/volunteering">): Promise<Metadata> {
  const { eventId } = await params;
  const { data } = await (await createClient()).from("events").select("event_type").eq("id", eventId).maybeSingle();
  return { title: usesJobs(data?.event_type) ? "Jobs and shifts" : "Volunteer Setup" };
}

type HostRow = { user_id: string; role: "owner" | "admin"; profiles: { full_name: string; email: string } | null };
type StaffRow = { user_id: string; role: "volunteer_director" | "section_lead"; profiles: { full_name: string; email: string } | null };
const roleLabel = (role: "volunteer_director" | "section_lead", type: string | null) =>
  role === "volunteer_director" ? "Volunteer Lead" : leadWords(type).one;
const HOST_LABEL = { owner: "Host", admin: "Co-host" } as const;

/** Volunteer sign-up and one tab per station (section) with its own shift schedule. */
export default async function VolunteeringPage({ params, searchParams }: PageProps<"/dashboard/events/[eventId]/volunteering">) {
  const { eventId } = await params;
  const { station: tab, more } = await searchParams;
  const access = await getEventAccess(eventId);
  if (!access.canManage) redirect(`/dashboard/events/${eventId}`);
  const user = await requireUser();
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, organization_id, slug, name, status, event_type, volunteer_signup_open, timezone, starts_on, ends_on, window_start, window_end")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) missing();
  // Group events: the rooms, suggested as station locations.
  const { data: roomData } = hasRooms(event.event_type)
    ? await supabase.from("rooms").select("name, note").eq("event_id", eventId).order("name")
    : { data: [] };
  const locations = (roomData ?? []).map((r) => [r.name, r.note].filter(Boolean).join(" · "));

  const [{ data: stationData, error: stationsError }, { data: shiftData }, { data: staff }, { data: leadRows }, { data: hostData }, { data: inviteData }] = await Promise.all([
    supabase
      .from("stations")
      // Every column: showing arrives with the 20270105000000 update.
      .select("*")
      .eq("event_id", eventId)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("shifts")
      // Every column: adults_only and min_age arrive with the 20270102000000 update.
      .select("*")
      .eq("event_id", eventId)
      .order("starts_at"),
    supabase.from("event_staff").select("user_id, role, profiles(full_name, email)").eq("event_id", eventId),
    supabase.from("station_leads").select("station_id, user_id").eq("event_id", eventId).order("created_at"),
    // Only hosts can read the organization's members (co-hosts can lead stations too).
    access.isHost
      ? supabase
          .from("organization_members")
          .select("user_id, role, profiles(full_name, email)")
          .eq("organization_id", event.organization_id)
          .order("created_at")
      : Promise.resolve({ data: [] }),
    // Coordinators invited but not joined yet, shown on their sign-up.
    supabase.from("invitations").select("email, station_id").eq("event_id", eventId).eq("role", "section_lead").is("accepted_at", null),
  ]);
  // Check-in stations first, in the band's order, matching the volunteer sign-up page.
  if (stationsError) missing();
  // A volunteer event's (or band contest's) jobs: the setup redesign's words, layout, and saving as you type.
  const jobsHere = usesJobs(event.event_type);
  const bandsHere = hasBands(event.event_type);
  const published = event.status === "published";
  const stations = sortStations((stationData ?? []) as unknown as Omit<Station, "lead_ids">[]).map((st) => ({
    ...st,
    lead_ids: (leadRows ?? []).filter((l) => l.station_id === st.id).map((l) => l.user_id),
  }));
  const checkpoints = stations.filter((s) => s.checkpoint_kind);

  // Fairs: zone suggestions for stations.
  const [{ data: zoneRows }, { data: boothZones }] = hasBooths(event.event_type)
    ? await Promise.all([
        supabase.from("fair_zones").select("name").eq("event_id", eventId).order("created_at"),
        supabase.from("fair_booths").select("zone").eq("event_id", eventId).not("zone", "is", null),
      ])
    : [{ data: [] }, { data: [] }];
  // The fair's zones (made on Booths & Partners), or the usual five until there are some.
  const made = [
    ...(zoneRows ?? []).map((z) => z.name),
    ...stations.map((s) => (s as { zone?: string | null }).zone),
    ...(boothZones ?? []).map((b) => b.zone),
  ].filter((z): z is string => Boolean(z));
  const zones = hasBooths(event.event_type) ? [...new Set(made.length ? made : FAIR_ZONES)] : undefined;

  const shifts = (shiftData ?? []) as Shift[];
  // Items to bring (stations without times), and for the open one, who's bringing what.
  const { data: itemData } = await supabase
    .from("station_items")
    .select("id, station_id, name, needed, claimed_count")
    .eq("event_id", eventId)
    .order("sort_order")
    .order("created_at");
  const items = (itemData ?? []) as StationItem[];
  const staffRows = (staff ?? []) as unknown as StaffRow[];
  const hosts = (hostData ?? []) as unknown as HostRow[];

  // The open tab: ?station=<id>, "new" to add one (also when there are none yet), the first station, or
  // one of the tabs after the sign-ups: "import" (volunteers from a spreadsheet), "order" (band contests' check-in order).
  // A volunteer event's import sits under "More options" at the end of the page, not in the job tabs.
  const other = tab === "import" && !jobsHere ? "import" : tab === "order" && hasBands(event.event_type) ? "order" : null;
  const adding = !other && (tab === "new" || stations.length === 0);
  const current = adding || other ? null : (stations.find((s) => s.id === tab) ?? stations[0]);
  const currentShifts = current ? shifts.filter((s) => s.station_id === current.id) : [];
  const currentItems = current ? items.filter((i) => i.station_id === current.id) : [];
  const itemSignups: ItemSignup[] | undefined =
    current?.signup_kind === "items" && currentItems.length
      ? (
          ((
            await supabase
              .from("item_signups")
              .select("id, item_id, note, volunteers(full_name, email, phone)")
              .in("item_id", currentItems.map((i) => i.id))
              .order("created_at")
          ).data ?? []) as unknown as { id: string; item_id: string; note: string | null; volunteers: { full_name: string; email: string | null; phone: string | null } | null }[]
        ).map((r) => ({
          id: r.id,
          item_id: r.item_id,
          note: r.note,
          volunteer_name: r.volunteers?.full_name ?? "A volunteer",
          email: r.volunteers?.email ?? null,
          phone: r.volunteers?.phone ?? null,
        }))
      : undefined;
  // Who's signed up, for organizers and the sign-up's own leads.
  const roster =
    current && current.signup_kind !== "items"
      ? (((await supabase.rpc("station_roster", { p_station_id: current.id })).data ?? []) as RosterEntry[])
      : undefined;

  const tz = event.timezone;
  const days = eachDate(event.starts_on, event.ends_on);
  const windowLabel = formatTimeRange(event.window_start, event.window_end, tz);
  const windowTimes = { start: utcToZonedTime(event.window_start, tz).slice(0, 5), end: utcToZonedTime(event.window_end, tz).slice(0, 5) };
  // Adults each shift still needs, for jobs that save spots for adults (after the 20270110000000 update).
  const { data: needRows } = await supabase.rpc("shift_adult_needs", { p_event_id: eventId });
  const adultsNeeded = Object.fromEntries(((needRows ?? []) as { shift_id: string; adults_needed: number }[]).map((r) => [r.shift_id, r.adults_needed]));
  const origin = await getOrigin();
  const signupUrl = `${origin}/e/${event.slug}/volunteer`;
  const [qrSvg, qrPng] = await Promise.all([
    QRCode.toString(signupUrl, { type: "svg", margin: 1, width: 160 }),
    QRCode.toDataURL(signupUrl, { margin: 2, width: 1024 }),
  ]);
  // Each job's own shifts and things to bring, and the jobs volunteers can see that have some.
  const ownShifts = (id: string) => shifts.filter((x) => x.station_id === id);
  const ownItems = (id: string) => items.filter((x) => x.station_id === id);
  const hasSome = (st: Station) => ownShifts(st.id).length + ownItems(st.id).length > 0;
  // Totals count only what volunteers can see, the same way as the event page.
  const { sentence } = volunteerTotals(stations, shifts, items);
  const previewHref = `/e/${event.slug}/volunteer`;

  const nameOf = (userId: string | null) => {
    if (!userId) return null;
    if (userId === user.id) return "You";
    const p = [...staffRows, ...hosts].find((s) => s.user_id === userId)?.profiles;
    return p?.full_name || p?.email || "Team member";
  };
  const leadOptions: LeadOption[] = [
    ...(access.isHost ? [{ id: user.id, label: "Me" }] : []),
    ...hosts
      .filter((h) => h.user_id !== user.id)
      .map((h) => ({ id: h.user_id, label: `${h.profiles?.full_name || h.profiles?.email || "Team member"} (${HOST_LABEL[h.role]})` })),
    ...[...new Map(staffRows.filter((s) => s.user_id !== user.id && !hosts.some((h) => h.user_id === s.user_id)).map((s) => [s.user_id, s])).values()].map((s) => ({
      id: s.user_id,
      label: `${s.profiles?.full_name || s.profiles?.email || "Team member"} (${roleLabel(s.role, event.event_type)})`,
    })),
  ];
  // Each shift as a spreadsheet might name it: "Parking 9:00–11:00 AM", "Morning Parking"…
  const multiDay = days.length > 1;
  // Only jobs volunteers can see take sign-ups, imported ones included.
  const shiftChoices: Choice[] = shifts.filter((sh) => stations.some((st) => st.id === sh.station_id && st.showing !== false)).map((sh) => {
    const station = stations.find((s) => s.id === sh.station_id)?.name ?? "";
    const time = formatTimeRange(sh.starts_at, sh.ends_at, tz, { zone: false });
    const day = multiDay ? `${formatDate(utcToZonedDate(sh.starts_at, tz), { year: undefined })} ` : "";
    return {
      value: sh.id,
      label: `${station}: ${sh.title} · ${day}${time}`,
      also: [sh.title, `${station} ${sh.title}`, `${station} ${time}`, `${sh.title} ${time}`, `${station} ${day}${time}`],
    };
  });
  const tabHref = (id: string) => `/dashboard/events/${eventId}/volunteering?station=${id}`;

  // Your own daily volunteer summary: whether the hosts picked you, and what it includes (after the 20270102000000 update).
  const [digestPicked, { data: myDigest, error: digestError }] = await Promise.all([
    loadNotifyRecipients(eventId).then((m) => m.get("volunteer_digest")),
    supabase.from("volunteer_digest_prefs").select("new_bookings, changes, cancellations").eq("event_id", eventId).eq("user_id", user.id).maybeSingle(),
  ]);
  const digest = isSchemaError(digestError)
    ? null
    : { receiving: Boolean(digestPicked?.memberIds.includes(user.id)), prefs: (myDigest as DigestPrefs | null) ?? ALL_DIGEST };

  // Volunteers from a spreadsheet: a tab on most events, under "More options" on a volunteer event.
  const importVolunteersBlock = (
    <>
      <h3 className="text-lg font-semibold">Import volunteers</h3>
      <p className="mt-1 mb-4 text-sm text-muted">
        {jobsHere ? (
          <>
            Optional. Have names from a paper sheet or another sign-up site? Add them to their shifts here. Use one row for
            each person and shift. People who share an email are signed up together. If a shift is full, it gets more spots.
          </>
        ) : (
          <>
            Optional. Already have sign-ups from a paper sheet or another sign-up site? Add them to their shifts here. One row
            per person per shift; people who share an email are signed up together, on the same shifts. A full shift makes
            room for them.
          </>
        )}
      </p>
      {shiftChoices.length === 0 ? (
        <p className="text-sm">
          {jobsHere
            ? "Add a job and its shifts first. Each volunteer you import goes onto one of your shifts."
            : "Add a sign-up and its shifts first. Each volunteer you import goes onto one of your shifts."}
        </p>
      ) : (
        <SpreadsheetImport
          kind="volunteers"
          fields={importFields("volunteers")}
          choices={{ shift: shiftChoices }}
          noun={{ one: "sign-up", many: "sign-ups" }}
          templateName="volunteers.csv"
          emailOption="Email each volunteer a confirmation with their shifts and a calendar invite"
          action={importVolunteers.bind(null, eventId)}
        />
      )}
    </>
  );

  return (
    // data-required-marks: a small asterisk on each box that has to be filled in (globals.css).
    <div data-required-marks>
      <Link href={`/dashboard/events/${eventId}`} className="text-sm text-muted hover:text-foreground">
        ← Back to {event.name}
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{/* The step's own name, as in the step bar and the event page's button (light check, 2026-11-08). */}
          {jobsHere ? "Jobs and shifts" : "Volunteer Setup"}</h1>
        {/* A volunteer event's "+ Add a job" sits by the title, so it's never scrolled out of sight with the tabs. */}
        {jobsHere && stations.length > 0 && (
          <Link
            href={tabHref("new")}
            scroll={false}
            className="inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand"
          >
            + Add a job
          </Link>
        )}
      </div>
      <SavedBy eventId={eventId} area="volunteers" className="mt-2" />
      {/* Volunteer events keep this note at the end, so the jobs come first. */}
      {!jobsHere && (
      <p className="mt-1 text-sm text-muted">
        <LineIcon name="lock" inline />Volunteers&apos; phone numbers (and volunteers under 18) are deleted 10 days after the event. Adults&apos; names, emails, and
        how many shifts they kept stay in your Volunteer tracking for 2 years after their last event.
      </p>
      )}

      {jobsHere && published && (
        <p className="mt-4 flex gap-2 rounded-lg border border-brand/25 bg-brand-soft px-4 py-3 text-sm leading-6">
          <span aria-hidden>ⓘ</span>
          <span>
            <span className="font-semibold">This event is published.</span> Changes reach volunteers as soon as they save. A job shows
            on the sign-up page once it has a shift or a thing to bring. People already signed up get an email if their shift&apos;s time changes.
          </span>
        </p>
      )}

      {/* A volunteer event's draft publishes from its last step (the event page), so its sign-up link waits until then. */}
      {!(jobsHere && !published) && (
      <Card className="mt-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={event.status === "published" && event.volunteer_signup_open ? "live" : "neutral"}>
                {event.status !== "published" ? "Event not published" : event.volunteer_signup_open ? "Sign-up open" : "Sign-up closed"}
              </Badge>
              <span className="text-sm text-muted">
                {sentence}
              </span>
            </div>
            <div>
              <p className="text-sm font-medium">Sign-up link</p>
              <p className="mt-1 break-all text-sm text-muted">{signupUrl}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <CopyLinkButton url={signupUrl} label="Copy link" />
                <a
                  href={previewHref}
                  target="_blank"
                  className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-background"
                >
                  Preview page
                </a>
                <Link
                  href={`/dashboard/events/${eventId}/volunteers`}
                  className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-background"
                >
                  Volunteer check-in
                </Link>
                <Link
                  href={`/dashboard/events/${eventId}/volunteering/badges`}
                  className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-background"
                >
                  Print volunteer badges
                </Link>
                {event.status !== "published" && access.isHost && (
                  <ActionButton
                    action={publishAndOpenSignups.bind(null, eventId)}
                    variant="go"
                    className="min-h-11 px-3! text-sm!"
                    pendingText="Publishing…"
                    confirmMessage="Publish the event and open volunteer sign-ups? Your event page goes live and people can start signing up."
                  >
                    Publish and open sign-ups
                  </ActionButton>
                )}
              </div>
              {/* On its own line, and quiet while sign-up is open, so it isn't tapped by mistake. */}
              {event.status === "published" && access.isHost && (
                <div className="mt-2">
                  <ActionButton
                    action={setVolunteerSignupOpen.bind(null, eventId, !event.volunteer_signup_open)}
                    variant={event.volunteer_signup_open ? "quiet-stop" : "go"}
                    className="min-h-11 px-3! text-sm!"
                    confirmMessage={event.volunteer_signup_open ? "Close volunteer sign-up? People won't be able to sign up anymore. Everyone already signed up keeps their spot." : undefined}
                  >
                    {event.volunteer_signup_open ? "Close volunteer sign-up" : "Open volunteer sign-up"}
                  </ActionButton>
                </div>
              )}
              {/* Tucked away to keep the top of the page short; open it to show or download the code. */}
              <details className="group mt-2">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground">
                  <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
                    ›
                  </span>
                  QR code
                </summary>
                <div className="mt-2 flex flex-col items-start gap-2">
                  <div
                    className="rounded-lg border border-border bg-white p-2"
                    aria-label="QR code for the sign-up link"
                    role="img"
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                  <a href={qrPng} download={`${event.slug}-volunteer-qr.png`} className="inline-flex min-h-11 items-center text-xs font-medium text-brand underline-offset-4 hover:underline">
                    Download QR code
                  </a>
                </div>
              </details>
            </div>
            {event.status !== "published" && !access.isHost && (
              <p className="text-sm text-muted">Sign-ups open once the event&apos;s host publishes it.</p>
            )}
          </div>
      </Card>
      )}

      <section className={jobsHere ? "mt-4" : "mt-10"} aria-labelledby="signups-heading">
        <h2 id="signups-heading" className={jobsHere ? "sr-only" : "text-xl font-semibold"}>
          {jobsHere ? "Jobs" : "Volunteer sign-ups"}
        </h2>
        {/* What a job is: said once, while there are none yet. */}
        {!(jobsHere && stations.length > 0) && (
          <p className="mt-1 mb-4 text-sm text-muted">
            {jobsHere
              ? bandsHere
                ? "A job is a way to help, like parking, concessions, or the gate, or a list of things to bring, like water for the judges. Volunteers pick a shift or an item. A job can also be a check-in stop that bands go through on contest day."
                : "A job is a way to help, like parking or picking up litter, or a list of things to bring, like water and trash bags. Volunteers pick a shift or an item."
              : "Each sign-up is a job, a place, or a list of things to bring, like Parking, Concessions, or a potluck. People sign up for its time slots or its items."}
          </p>
        )}
        <UnsavedChangesProvider
          key={current?.id ?? "new"}
          needsDetails={false}
          needsShifts={false}
        >
          <StationTabs
            tabs={stations.map((st) => {
              const own = ownShifts(st.id);
              const itemsHere = ownItems(st.id);
              return {
                id: st.id,
                name: st.name,
                href: tabHref(st.id),
                active: current?.id === st.id,
                saved: Boolean(st.details_saved_at),
                configured: Boolean(st.details_saved_at) && own.length + itemsHere.length > 0,
                items: st.signup_kind === "items",
                filled: own.reduce((n, x) => n + x.registered_count, 0) + itemsHere.reduce((n, x) => n + x.claimed_count, 0),
                capacity: own.reduce((n, x) => n + x.max_capacity, 0) + itemsHere.reduce((n, x) => n + x.needed, 0),
                job: jobsHere,
                stop: jobsHere ? (st.checkpoint_order ?? undefined) : undefined,
                needsLead: jobsHere && Boolean(st.checkpoint_kind) && st.lead_ids.length === 0,
              };
            })}
            add={jobsHere ? (adding && stations.length > 0 ? { href: tabHref("new"), active: true, label: "New job" } : undefined) : { href: tabHref("new"), active: adding }}
            label={jobsHere ? "Jobs" : undefined}
            extra={[
              ...(jobsHere
                ? []
                : [
                    {
                      key: "import",
                      label: "Import volunteers",
                      status: "Optional",
                      href: tabHref("import"),
                      active: other === "import",
                    },
                  ]),
              ...(hasBands(event.event_type)
                ? [
                    {
                      key: "order",
                      label: jobsHere ? "Band check-in order" : "Check-in order",
                      // Before publishing, the order is later work: say when it's due instead.
                      status: checkpoints.length
                        ? `${checkpoints.length} ${checkpoints.length === 1 ? "stop" : "stops"}`
                        : !published && jobsHere
                          ? `After you publish · Due ${formatDate(twoWeeksBefore(event.starts_on), { year: undefined })}`
                          : "No stops yet",
                      href: tabHref("order"),
                      active: other === "order",
                    },
                  ]
                : []),
            ]}
          />
          <div className={jobsHere ? "mt-2" : "mt-6"}>
            {current ? (
              <StationPanel
                // A fresh panel per station, so its forms never keep the previous tab's choices.
                key={current.id}
                eventId={eventId}
                station={current}
                items={currentItems}
                itemSignups={itemSignups}
                stationShifts={currentShifts}
                event={event}
                days={days}
                windowLabel={windowLabel}
                windowTimes={windowTimes}
                adultsNeeded={adultsNeeded}
                userId={user.id}
                canManage
                locations={locations}
                zones={zones}
                leadNames={current.lead_ids.map((id) => nameOf(id) ?? "Team member")}
                roster={roster}
                kindLocked={
                  current.checkpoint_kind
                    ? jobsHere
                      ? currentShifts.length
                        ? "Check-in stops always take shifts. To switch to things to bring, set Band check-in stop to Not a stop in More options, then delete this job's shifts."
                        : "Check-in stops always take shifts. To switch to things to bring, set Band check-in stop to Not a stop in More options."
                      : "A check-in stop always takes time slots."
                    : current.signup_kind === "items"
                      ? currentItems.length
                        ? `To switch to ${jobsHere ? "shifts" : "time slots"}, first delete this ${jobsHere ? "job" : "sign-up"}'s items.`
                        : null
                      : currentShifts.length
                        ? `To switch to ${jobsHere ? "things to bring" : "items to bring"}, first delete this ${jobsHere ? "job" : "sign-up"}'s ${jobsHere ? "shifts" : "time slots"}.`
                        : null
                }
                leadOptions={leadOptions}
                pendingInvites={(inviteData ?? []).filter((inv) => inv.station_id === current.id).map((inv) => inv.email)}
                job={
                  jobsHere
                    ? {
                        ready: hasSome(current),
                        allReady: stations.every(hasSome),
                        items: current.signup_kind === "items",
                        stops: bandsHere ? checkpoints.length : undefined,
                        openMore: more === "1",
                        links: {
                          order: bandsHere ? tabHref("order") : undefined,
                          addJob: tabHref("new"),
                          preview: previewHref,
                          next: published
                            ? { href: `/dashboard/events/${eventId}`, label: "Back to the event" }
                            : bandsHere
                              ? { href: `/dashboard/events/${eventId}#publish`, label: "Next up: Publish" }
                              : { href: `/dashboard/events/${eventId}#publish`, label: "Next up: Publish your event" },
                        },
                      }
                    : undefined
                }
              />
            ) : other === "import" ? (
              <Card>
                {importVolunteersBlock}
              </Card>
            ) : other === "order" ? (
              <Card>
                <h3 className="font-semibold">{jobsHere ? "Band check-in order" : "Check-in order"}</h3>
                {checkpoints.length > 0 ? (
                  <>
                    <p className="mt-0.5 text-sm text-muted">
                      The stops each band goes through on contest day, in order. Contest-day screens use this order to show whether
                      each band is on track. Stops also come first in the job tabs, in this order.
                    </p>
                    <CheckInOrderList
                      stops={checkpoints.map((c, i) => {
                        const own = ownShifts(c.id);
                        return {
                          id: c.id,
                          name: c.name,
                          href: tabHref(c.id),
                          detail: [
                            kindLabel(c.checkpoint_kind!),
                            c.due_minutes_before_warm_up != null ? `Due ${c.due_minutes_before_warm_up} minutes before warm-up` : null,
                          ]
                            .filter(Boolean)
                            .join(" · "),
                          needs: !own.length ? "Needs a shift" : c.lead_ids.length === 0 ? "Needs a Coordinator to check bands in" : null,
                          up: i > 0 ? moveCheckpoint.bind(null, eventId, c.id, "up") : undefined,
                          down: i < checkpoints.length - 1 ? moveCheckpoint.bind(null, eventId, c.id, "down") : undefined,
                        };
                      })}
                    />
                  </>
                ) : (
                  <p className="mt-0.5 text-sm text-muted">
                    {jobsHere
                      ? "No stops yet. A stop is a place bands go through on contest day, like Parking or the Gate. Choose a job to make it one."
                      : "None yet. In a station's settings, choose what kind of check-in station it is (Parking, Check-in point, Warm-up or Gate) to add it to the bands' path."}
                  </p>
                )}
                {jobsHere && stations.some((s) => !s.checkpoint_kind && s.signup_kind !== "items") && (
                  // The way to add a stop from here: each job that could be one, opening its More options.
                  <div className="mt-4 border-t border-border pt-3">
                    <p className="text-sm font-semibold">{checkpoints.length ? "Make another job a stop" : "Make a job a stop"}</p>
                    <ul className="mt-1 flex flex-wrap gap-x-4">
                      {stations
                        .filter((s) => !s.checkpoint_kind && s.signup_kind !== "items")
                        .map((s) => (
                          <li key={s.id}>
                            <Link
                              href={`${tabHref(s.id)}&more=1`}
                              scroll={false}
                              className="inline-flex min-h-11 items-center text-sm font-medium text-brand underline underline-offset-4"
                            >
                              {s.name}
                            </Link>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </Card>
            ) : (
              <Card>
                <h3 className="text-lg font-semibold">
                  {jobsHere ? (stations.length ? "Add a job" : "Add your first job") : stations.length ? "Add a sign-up" : "Add your first sign-up"}
                </h3>
                <p className="mt-1 mb-4 text-sm text-muted">
                  {jobsHere
                    ? "Choose shifts or things to bring, then name the job. You add the times or items next."
                    : "Name it and choose its type. You'll add its details, Coordinators, and time slots or items next."}
                </p>
                <NewStationForm action={createStation.bind(null, eventId)} openTab job={jobsHere} />
                {jobsHere && !published && stations.length === 0 && (
                  // The way on, as on every other step: optional for a band contest; a volunteer event needs a job first.
                  <p className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
                    <span className="text-muted">
                      {bandsHere ? "No volunteer jobs yet? Add them any time before contest day." : "Publishing needs at least one job with a shift or a thing to bring."}
                    </span>
                    <Link href={`/dashboard/events/${eventId}#publish`} className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
                      Next up: Publish →
                    </Link>
                  </p>
                )}
              </Card>
            )}
          </div>
        </UnsavedChangesProvider>
      </section>
      {digest && (
        <section className={jobsHere ? "mt-6" : "mt-8"}>
          <DigestCard
            action={saveMyDigestPrefs.bind(null, eventId)}
            prefs={digest.prefs}
            receiving={digest.receiving}
            hostsLink={access.isHost ? `/dashboard/events/${eventId}/edit?section=emails#notifications` : undefined}
          />
        </section>
      )}
      {/* A job's sign-ups, below the daily summary: the job's own card is just for setting it up. */}
      {jobsHere && current && (
        <JobSignups
          station={current}
          shifts={currentShifts}
          items={currentItems}
          itemSignups={itemSignups}
          roster={roster}
          event={event}
          eventId={eventId}
        />
      )}
      {jobsHere && (
        // Away from the jobs, so it doesn't pull focus from setting them up.
        <details open={tab === "import"} className="group mt-6 rounded-lg border border-border bg-surface">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold sm:px-6 [&::-webkit-details-marker]:hidden">
            More options: import volunteers from a spreadsheet
            <span aria-hidden className="text-brand transition group-open:rotate-90">
              ›
            </span>
          </summary>
          <div className="border-t border-border p-4 sm:p-6">{importVolunteersBlock}</div>
        </details>
      )}
      {jobsHere && (
        <p className="mt-6 text-sm text-muted">
          <LineIcon name="lock" inline />Volunteers&apos; phone numbers, and everything about helpers under 18, are deleted 10 days after the event. Adults&apos;
          names, emails, and how many shifts they kept stay in your Volunteer tracking for 2 years after their last event.
        </p>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { retryContestCopy, startContestOver } from "@/app/dashboard/actions";
import { openBandRegistrationNow, publishAndOpenBandRegistration, reopenBandRegistration, setBandRegistrationOpen, updateBandSettings } from "@/app/dashboard/band-actions";
import { Badge, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { cancelScheduledInvite, fixInviteAddress, sendBandInvites } from "@/app/dashboard/band-invite-actions";
import { importBandPrefills } from "@/app/dashboard/import-actions";
import { SpreadsheetImport } from "@/components/spreadsheet-import";
import { importFields } from "@/lib/imports";
import { InvitePastBands, type PastDirector } from "./invite-past-bands";
import { bandInviteEmail } from "@/lib/band-invite-email";
import { customWords, loadSystemEmail } from "@/lib/system-email-overrides";
import { groupWords, hasEnsembles, hasRooms } from "@/lib/event-types";
import { BAND_COLUMNS, deadlinePassed, opensLater, registrationIsOpen, type BandRow } from "@/lib/bands";
import { getEventAccess, getOrigin } from "@/lib/data";
import { formatPhone } from "@/lib/phone";
import { missing } from "@/lib/schema-check";
import { loadMealOrders, loadMealSettings } from "@/lib/meals";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateRange, utcToZonedDate } from "@/lib/time";
import { ActionButton, CopyLinkButton } from "../forms";
import { BandSettingsForm } from "./settings-form";
import { SavedBy } from "@/components/saved-by";
import { RegisteredBands } from "./registered-bands";
import { SetupTabs } from "../../_components/setup-tabs";
import { ReopenRegistration } from "./reopen-registration";
import { RegistrationSettings } from "./registration-settings";

export const metadata: Metadata = { title: "Band registration" };
// Sending a long list of invitations finishes after the page answers; give it time.
export const maxDuration = 300;

/** The day before a YYYY-MM-DD date: the last day registration can close. */
function dayBefore(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Band (or group) Registration, like Volunteer Setup: a card with where
 * registration stands, its link, and the one button for what's next; then
 * tabs: Registered bands (once registration has opened), Registration
 * settings, and Invite directors.
 */
export default async function BandsPage({ params, searchParams }: PageProps<"/dashboard/events/[eventId]/bands">) {
  const { eventId } = await params;
  const { tab, copied, copy } = await searchParams;
  const access = await getEventAccess(eventId);
  // Volunteer and Coordinators get the read-only schedule instead.
  if (!access.isHost) redirect(`/dashboard/events/${eventId}/schedule`);

  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, slug, name, status, event_type, timezone, starts_on, ends_on, venue_name, band_registration_open, band_registration_deadline, band_registration_opens_on, director_info, chaperone_limit, classifications, payment_link")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) missing();
  if (!hasEnsembles(event.event_type)) redirect(`/dashboard/events/${eventId}`);
  const roomsHere = hasRooms(event.event_type);
  const w = groupWords(event.event_type);

  const user = await requireUser();
  const [{ data: bandData }, { data: contact }, { data: contactPhone }, { data: profile }] = await Promise.all([
    supabase.from("bands").select(BAND_COLUMNS).eq("event_id", eventId).order("created_at"),
    supabase.from("event_director_contacts").select("name, email").eq("event_id", eventId).maybeSingle(),
    supabase.rpc("director_contact_phone", { ev: eventId }),
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
  ]);
  const [{ data: pastData }, { data: prefillData }, { data: inviteData }] = await Promise.all([
    supabase.rpc("past_band_directors", { p_event: eventId }),
    supabase.from("band_prefills").select("email, band_name, school_name, head_director_name").eq("event_id", eventId).order("created_at"),
    supabase.from("band_invitations").select("email, sent_at, failed_at, failed_reason, scheduled_for, replaced_by").eq("event_id", eventId),
  ]);
  const invitedLabel = (iso: string) => `Invited ${formatDate(utcToZonedDate(iso, event.timezone), { year: undefined })}`;
  // Saved wording for the invitation (Email settings), so the preview shows what's sent.
  const inviteWording = await loadSystemEmail("director_invite");
  type InviteRow = { email: string; sent_at: string | null; failed_at: string | null; failed_reason: "address" | "service" | null; scheduled_for: string | null; replaced_by: string | null };
  const invites = new Map(((inviteData ?? []) as InviteRow[]).map((i) => [i.email.toLowerCase(), i]));
  const invitedAt = new Map([...invites].filter(([, i]) => i.sent_at).map(([e, i]) => [e, i.sent_at as string]));
  // Each director's invitation state, beyond "Invited <date>".
  const inviteState = (email: string) => {
    const i = invites.get(email.toLowerCase());
    return {
      failed: i?.failed_at ? (i.failed_reason ?? "service") : (false as const),
      movedTo: i?.replaced_by ?? null,
      // Waiting for registration to open: the day it opens now (it may have moved since they were chosen).
      scheduled:
        i && !i.sent_at && i.scheduled_for
          ? event.band_registration_opens_on && regLater
            ? `Goes out ${formatDate(event.band_registration_opens_on, { year: undefined })}`
            : "Goes out with the next send"
          : null,
    };
  }
  const registeredEmails = new Set(((bandData ?? []) as BandRow[]).map((b) => b.head_director_email.toLowerCase()));
  // Directors whose details the host imported, one line per director.
  const imported = new Map<string, PastDirector>();
  for (const p of (prefillData ?? []) as { email: string; band_name: string; school_name: string | null; head_director_name: string | null }[]) {
    const email = p.email.toLowerCase();
    const band = p.school_name ? `${p.band_name} (${p.school_name})` : p.band_name;
    const d = imported.get(email);
    if (d) d.bands.push(band);
    else
      imported.set(email, {
        email,
        name: p.head_director_name ?? "",
        bands: [band],
        note: "From your spreadsheet",
        registered: registeredEmails.has(email),
        invited: invitedAt.has(email) ? invitedLabel(invitedAt.get(email)!) : null,
      });
  }
  const pastDirectors: PastDirector[] = ((pastData ?? []) as {
    email: string;
    full_name: string;
    bands: string[];
    last_event: string;
    registered: boolean;
    invited_at: string | null;
  }[]).map((d) => ({
    email: d.email,
    name: d.full_name,
    bands: d.bands,
    note: `Last registered for ${d.last_event}`,
    registered: d.registered,
    invited: d.invited_at ? invitedLabel(d.invited_at) : null,
  }));
  // Past directors are band directors so far; group events start fresh.
  const directors = [...imported.values(), ...(roomsHere ? [] : pastDirectors.filter((d) => !imported.has(d.email.toLowerCase())))];
  const regOpen = registrationIsOpen(event);
  // Published, and set to open on a day still to come.
  const regLater = event.status === "published" && event.band_registration_open && opensLater(event);
  const today = utcToZonedDate(new Date().toISOString(), event.timezone);
  const pastDeadline = event.band_registration_open && deadlinePassed(event);
  const bands = (bandData ?? []) as BandRow[];
  const origin = await getOrigin();
  const registrationUrl = `${origin}/e/${event.slug}/bands`;



  const settingsDone = Boolean(contact);
  const published = event.status === "published";
  const invitedCount = [...invites.values()].filter((i) => i.sent_at && !i.replaced_by).length;
  const scheduledCount = [...invites.values()].filter((i) => !i.sent_at && i.scheduled_for && !i.replaced_by).length;
  // Registered bands shows once registration has opened (or closed after it did): before that there's nothing to see.
  const showBands = regOpen || pastDeadline || bands.length > 0;
  // Directors who were emailed an invitation and haven't registered yet.
  const invitedWaiting = directors.filter((d) => d.invited && !d.registered).length;
  // The preview is addressed to the first director on the list.
  const previewTo = directors.find((d) => !d.registered) ?? directors[0];

  // The open tab: ?tab=, else the bands once there are any to show, else the settings.
  const tabs = [...(showBands ? ["bands"] : []), "settings", "invite"] as const;
  const current = tabs.find((t) => t === tab) ?? (showBands ? "bands" : "settings");
  const base = `/dashboard/events/${eventId}/bands`;
  const [qrSvg, qrPng] = await Promise.all([
    QRCode.toString(registrationUrl, { type: "svg", margin: 1, width: 160 }),
    QRCode.toDataURL(registrationUrl, { margin: 2, width: 1024 }),
  ]);
  const contest = event.event_type === "band_contest";
  // Bands in each classification (withdrawn bands don't count): those classifications stay.
  const bandsIn: Record<string, number> = {};
  for (const b of bands) if (!b.scratched_at) bandsIn[b.classification] = (bandsIn[b.classification] ?? 0) + 1;
  const contactValues = {
    name: contact?.name || profile?.full_name || "",
    phone: formatPhone(contact ? contactPhone : profile?.phone),
    email: contact?.email || user.email || "",
  };
  // Meals for visiting bands, and what each band asked for (after the 20270111000000 update).
  const [mealSettings, mealOrders] = await Promise.all([
    loadMealSettings(supabase, eventId),
    loadMealOrders(supabase, ((bandData ?? []) as { id: string }[]).map((b) => b.id)),
  ]);
  const registrationForm = (next?: { href: string; label: string }) => (
    <RegistrationSettings
      eventId={eventId}
      initial={{
        classifications: event.classifications ?? [],
        deadline: event.band_registration_deadline ?? "",
        opensOn: event.band_registration_opens_on ?? "",
        directorInfo: event.director_info ?? "",
        paymentLink: event.payment_link ?? "",
        chaperoneLimit: event.chaperone_limit,
        contact: contactValues,
        meals: mealSettings.ready
          ? { offered: mealSettings.offered, priceCents: mealSettings.priceCents, details: mealSettings.details, options: mealSettings.options }
          : null,
      }}
      bandsIn={bandsIn}
      contactSaved={settingsDone}
      next={next}
      draft={!published}
      today={today}
      alreadyOpen={regOpen}
      contest={{ day: event.starts_on, label: formatDate(event.starts_on, { weekday: undefined, year: undefined }), lastDeadline: dayBefore(event.starts_on) }}
    />
  );

  // A band contest before it's published: step 2 of its setup (the steps sit above, from the layout).
  if (contest && !published) {
    // Just started from a previous contest: what came over (or that it didn't), and what to check.
    const fromId = typeof copied === "string" && /^[\w-]{1,64}$/.test(copied) ? copied : null;
    const copyFailed = Boolean(fromId) && copy === "failed";
    const copiedFrom = fromId
      ? ((await supabase.from("events").select("name, starts_on, band_registration_deadline, band_registration_opens_on, payment_link, meals_offered").eq("id", fromId).maybeSingle())
          .data as {
          name: string;
          starts_on: string;
          band_registration_deadline: string | null;
          band_registration_opens_on: string | null;
          payment_link: string | null;
          meals_offered: boolean | null;
        } | null)
      : null;
    const copyNote = copiedFrom && !copyFailed ? await copySummary(supabase, eventId, copiedFrom, event) : null;
    return (
      <div data-required-marks>
        <Link href={`/dashboard/events/${eventId}`} className="text-sm text-muted hover:text-foreground">
          ← Back to {event.name}
        </Link>
        <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Band registration</h1>
        <p className="mt-2 max-w-2xl text-muted">
          What directors pick and read when they register. You can invite directors and share the link once you publish.
        </p>
        <a href={`/e/${event.slug}/bands`} target="_blank" className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4">
          Preview what directors see <span className="sr-only">(opens in a new tab)</span>
        </a>
        {copiedFrom && copyNote && (
          <div role="status" className="mt-4 flex gap-2 rounded-lg border border-brand/25 bg-brand-soft px-4 py-3 text-sm leading-6">
            <span aria-hidden>ⓘ</span>
            <div className="space-y-1.5">
              <p>
                <span className="font-semibold">
                  Copied from your {formatDate(copiedFrom.starts_on, { weekday: undefined })} contest, {copiedFrom.name}.
                </span>{" "}
                Its registration settings are filled in below{copyNote.jobs}.
              </p>
              {copyNote.dates.length > 0 && (
                <ul className="list-disc pl-5">
                  {copyNote.dates.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
              {copyNote.shiftsOutside > 0 && (
                <p>
                  {copyNote.shiftsOutside === 1 ? "1 shift falls" : `${copyNote.shiftsOutside} shifts fall`} outside the new contest&apos;s hours. Check{" "}
                  {copyNote.shiftsOutside === 1 ? "it" : "them"} on the{" "}
                  <Link href={`/dashboard/events/${eventId}/volunteering`} className="font-semibold text-brand underline underline-offset-4">
                    Volunteers step
                  </Link>
                  .
                </p>
              )}
              <p>Check {copyNote.check}, and anything that&apos;s different this time.</p>
              <StartOver eventId={eventId} />
            </div>
          </div>
        )}
        {copyFailed && copiedFrom && (
          <div role="alert" className="mt-4 space-y-2 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm leading-6">
            <p>
              <span className="font-semibold">The setup from {copiedFrom.name} didn&apos;t come over.</span> Your new contest is saved. Try copying
              again, or set up registration below.
            </p>
            <ActionButton
              action={retryContestCopy.bind(null, eventId, fromId!)}
              variant="secondary"
              pendingText="Copying…"
              confirmMessage={`Try copying from ${copiedFrom.name} again? Its registration settings replace anything you've entered below since.`}
              confirmLabel="Copy again"
            >
              Try copying again
            </ActionButton>
          </div>
        )}
        <div className="mt-6">{registrationForm({ href: `/dashboard/events/${eventId}/volunteering`, label: "Next up: Jobs and shifts" })}</div>
      </div>
    );
  }


  return (
    // data-required-marks: a small asterisk on each box that has to be filled in (globals.css).
    <div data-required-marks>
      <Link href={`/dashboard/events/${eventId}`} className="text-sm text-muted hover:text-foreground">
        ← Back to {event.name}
      </Link>
      <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">{w.One} registration</h1>
      <SavedBy eventId={eventId} area="bands" className="mt-2" />

      {/* Where registration stands, its link, and the one button for what's next. */}
      <Card className="mt-6">
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={!published ? "neutral" : regOpen ? "live" : "neutral"}>
                {!published ? "Event not published" : regOpen ? "Registration open" : regLater ? `Opens ${formatDate(event.band_registration_opens_on!, { weekday: undefined, year: undefined })}` : "Registration closed"}
              </Badge>
              <span className="text-muted">
                {[
                  showBands ? `${bands.length} ${bands.length === 1 ? w.one : w.many} registered` : null,
                  regOpen && event.band_registration_deadline
                    ? `Closes at the end of ${formatDate(event.band_registration_deadline)}`
                    : pastDeadline
                      ? `The deadline (${formatDate(event.band_registration_deadline!)}) has passed`
                      : regOpen
                        ? "No deadline set"
                        : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </p>
            {invitedWaiting > 0 && (
              <p className="text-sm">
                <Link href={`${base}?tab=invite`} scroll={false} className="font-medium text-brand underline-offset-4 hover:underline">
                  {invitedWaiting} invited {invitedWaiting === 1 ? "director hasn't" : "directors haven't"} registered yet
                </Link>
              </p>
            )}
          </div>
          {!settingsDone && !regOpen && (
            <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
              Save your{" "}
              <Link href={`${base}?tab=settings`} scroll={false} className="font-medium underline">
                registration settings
              </Link>{" "}
              first, so directors see the right classifications and information.
            </p>
          )}
          <div>
            <p className="text-sm font-medium">Registration link</p>
            <p className="mt-1 break-all text-sm text-muted">{registrationUrl}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <CopyLinkButton url={registrationUrl} label="Copy link" />
              <a href={`/e/${event.slug}/bands`} target="_blank" className="inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand">
                Preview page
              </a>
              {!published && (
                <ActionButton
                  action={publishAndOpenBandRegistration.bind(null, eventId)}
                  variant="go"
                  className="px-3! text-xs!"
                  pendingText="Publishing…"
                  confirmMessage={`Publish the event and open ${w.one} registration? Your event page goes live and directors can start registering.`}
                >
                  Publish and open registration
                </ActionButton>
              )}
              {published && regLater && (
                <>
                  <ActionButton
                    action={openBandRegistrationNow.bind(null, eventId)}
                    variant="secondary"
                    pendingText="Opening…"
                    confirmMessage={`Open ${w.one} registration now? Directors can register from today instead of ${formatDate(event.band_registration_opens_on!, { year: undefined })}, and any invitations you scheduled go out now.`}
                    confirmLabel="Open registration now"
                  >
                    Open registration now
                  </ActionButton>
                  <Link href={`${base}?tab=settings`} scroll={false} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-brand underline underline-offset-4">
                    Change opening day
                  </Link>
                </>
              )}
              {published && !regLater && !pastDeadline && (
                <ActionButton
                  action={setBandRegistrationOpen.bind(null, eventId, !event.band_registration_open)}
                  variant={event.band_registration_open ? "quiet-stop" : "go"}
                  confirmMessage={
                    event.band_registration_open
                      ? `Close ${w.one} registration early? Directors can't register or change a registration until you reopen it${invitedWaiting > 0 ? `, including the ${invitedWaiting} invited ${invitedWaiting === 1 ? "director who hasn't" : "directors who haven't"} registered yet` : ""}. Invitation links show that registration is closed. Nobody is emailed.`
                      : undefined
                  }
                  confirmLabel={event.band_registration_open ? "Close registration" : undefined}
                >
                  {event.band_registration_open ? "Close registration" : "Open registration"}
                </ActionButton>
              )}
              {/* Opens a new-deadline box, which takes its own line. */}
              {published && pastDeadline && <ReopenRegistration action={reopenBandRegistration.bind(null, eventId)} today={today} deadlineRequired={contest} />}
            </div>
            <p className="mt-2 text-sm text-muted">
              Directors who use this link confirm their email with a code after they fill in the form. Directors you{" "}
              <Link href={`${base}?tab=invite`} scroll={false} className="font-medium text-brand underline-offset-4 hover:underline">
                invite by email
              </Link>{" "}
              start from their email, with their {w.one}&apos;s details filled in.
            </p>
            {/* Tucked away to keep the top of the page short; open it to show or download the code. */}
            <details className="group mt-1">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground">
                <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
                  ›
                </span>
                QR code
              </summary>
              <div className="mt-2 flex flex-col items-start gap-2">
                <div
                  className="rounded-lg border border-border bg-white p-2"
                  aria-label="QR code for the registration link"
                  role="img"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
                <a href={qrPng} download={`${event.slug}-${w.one}-registration-qr.png`} className="inline-flex min-h-11 items-center text-xs font-medium text-brand underline-offset-4 hover:underline">
                  Download QR code
                </a>
              </div>
            </details>
          </div>
        </div>
      </Card>

      <div className="mt-10">
        <SetupTabs
          label={`${w.One} registration`}
          tabs={[
            ...(showBands
              ? [{ key: "bands", label: `Registered ${w.many}`, status: `${bands.length} ${bands.length === 1 ? w.one : w.many}`, href: `${base}?tab=bands`, active: current === "bands" }]
              : []),
            {
              key: "settings",
              label: "Registration settings",
              status: settingsDone ? "Saved" : "Needs to be done",
              mark: settingsDone ? ("done" as const) : ("todo" as const),
              href: `${base}?tab=settings`,
              active: current === "settings",
            },
            { key: "invite", label: "Invite directors", status: invitedCount ? `${invitedCount} invited` : scheduledCount ? `${scheduledCount} scheduled` : "Optional", href: `${base}?tab=invite`, active: current === "invite" },
          ]}
        />
        <div className="mt-6">
          {current === "bands" && (
            <RegisteredBands
              bands={bands}
              meals={mealSettings.offered ? { orders: mealOrders, options: mealSettings.options, priceCents: mealSettings.priceCents } : null}
              classifications={event.classifications}
              words={w}
              groups={roomsHere}
              fileName={`${event.name.replace(/[^\w -]+/g, "").trim() || "registrations"} ${w.many}.csv`}
            />
          )}
          {current === "settings" && contest && (
            <div>
              <h2 className="text-lg font-semibold">Registration settings</h2>
              <p className="mt-1 mb-4 text-sm text-muted">What directors pick and read when they register.</p>
              {registrationForm()}
            </div>
          )}
          {current === "settings" && !contest && (
            <Card>
              <h2 className="text-lg font-semibold">Registration settings</h2>
              <p className="mt-1 mb-4 text-sm text-muted">What directors pick and read when they register.</p>
              <BandSettingsForm
                action={updateBandSettings.bind(null, eventId)}
                chaperoneLimit={event.chaperone_limit}
                classifications={event.classifications}
                deadline={event.band_registration_deadline ?? ""}
                directorInfo={event.director_info ?? ""}
                contact={{
                  name: contact?.name || profile?.full_name || "",
                  phone: formatPhone(contact ? contactPhone : profile?.phone),
                  email: contact?.email || user.email || "",
                }}
                contactSaved={settingsDone}
                one={w.one}
              />
            </Card>
          )}
          {current === "invite" && (
            <Card>
              <h2 className="text-lg font-semibold">Invite directors</h2>
              <p className="mt-1 mb-6 text-sm text-muted">
                Optional. Bring in {w.many} you already work with, and email their directors an invitation to register.
              </p>
              <div className="space-y-8">
                <div>
                  <h3 className="font-semibold">Send invitations</h3>
                  {directors.length > 0 ? (
                    <>
                      <p className="mt-1 mb-3 text-sm text-muted">
                        {imported.size > 0 && !roomsHere && pastDirectors.length > 0
                          ? "From your spreadsheet and your earlier contests"
                          : imported.size > 0
                            ? "From your spreadsheet"
                            : "From your earlier contests"}
                        . Their {w.one}&apos;s details are filled in for them.
                      </p>
                      <InvitePastBands
                        directors={directors.map((d) => ({ ...d, ...inviteState(d.email) }))}
                        canSend={regOpen || regLater}
                        cantSendReason={pastDeadline ? `Registration has closed. Reopen it to send invitations.` : `Publish the event and open ${w.one} registration to send invitations.`}
                        scheduleFor={regLater ? formatDate(event.band_registration_opens_on!, { year: undefined }) : null}
                        send={sendBandInvites.bind(null, eventId)}
                        fixAddress={fixInviteAddress.bind(null, eventId)}
                        cancelScheduled={cancelScheduledInvite.bind(null, eventId)}
                        one={w.one}
                        preview={bandInviteEmail({
                          firstName: previewTo?.name?.split(" ")[0] || null,
                          host: profile?.full_name || "You",
                          one: w.one,
                          event,
                          fromSpreadsheet: imported.size > 0,
                          reminder: false,
                          email: previewTo?.email ?? "director@school.org",
                          custom: customWords("director_invite", inviteWording, {
                            first_name: previewTo?.name?.split(" ")[0] ?? "",
                            host: profile?.full_name || "You",
                            group: w.one,
                            event_name: event.name,
                            event_dates: formatDateRange(event.starts_on, event.ends_on),
                            at_venue: event.venue_name ? `at ${event.venue_name}` : "",
                          }),
                        })}
                      />
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-muted">
                      No directors to invite yet. Import your list below, and they show up here.
                    </p>
                  )}
                </div>
                <div>
                  <h3 id="import" className="scroll-mt-6 font-semibold">{directors.length ? "Someone else? Import a spreadsheet" : "Import your director list"}</h3>
                  <p className="mt-1 mb-3 text-sm text-muted">
                    Importing doesn&apos;t register anyone. The directors show up {directors.length ? "in the list above" : "here"} to invite, and each one
                    checks their details and registers.
                  </p>
                  <SpreadsheetImport
                    kind="bands"
                    fields={importFields("bands", { words: w, trucks: !roomsHere })}
                    choices={{ classification: event.classifications.map((c: string) => ({ value: c, label: c })) }}
                    chaperoneLimit={event.chaperone_limit}
                    noun={{ one: w.one, many: w.many }}
                    templateName={`${w.one}-registrations.csv`}
                    action={importBandPrefills.bind(null, eventId)}
                  />
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/** After copying from a previous contest: which registration dates moved or were dropped, what to check, and the jobs that came over. */
async function copySummary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  from: { band_registration_deadline: string | null; band_registration_opens_on: string | null; payment_link: string | null; meals_offered: boolean | null },
  event: { band_registration_deadline: string | null; band_registration_opens_on: string | null; director_info: string | null },
) {
  const [{ data: stations }, { data: ev }, { data: shifts }] = await Promise.all([
    supabase.from("stations").select("checkpoint_kind").eq("event_id", eventId),
    supabase.from("events").select("window_start, window_end").eq("id", eventId).maybeSingle(),
    supabase.from("shifts").select("starts_at, ends_at").eq("event_id", eventId),
  ]);
  const stops = (stations ?? []).filter((s) => s.checkpoint_kind).length;
  const jobs = (stations ?? []).length - stops;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const counts = [jobs && plural(jobs, "volunteer job", "volunteer jobs"), stops && plural(stops, "check-in stop", "check-in stops")].filter(Boolean).join(" and ");
  const dates: string[] = [];
  const date = (d: string) => formatDate(d, { weekday: undefined });
  if (from.band_registration_deadline) {
    dates.push(
      event.band_registration_deadline
        ? `Registration deadline moved to ${date(event.band_registration_deadline)}`
        : "The registration deadline would have been in the past, so it's blank. Pick a new one",
    );
  }
  if (from.band_registration_opens_on) {
    dates.push(
      event.band_registration_opens_on
        ? `Registration opens moved to ${date(event.band_registration_opens_on)}`
        : "Registration opens would have been in the past, so it's blank. Pick a new date or leave it empty to open when you publish",
    );
  }
  const start = ev?.window_start ? new Date(ev.window_start).getTime() : null;
  const end = ev?.window_end ? new Date(ev.window_end).getTime() : null;
  const shiftsOutside =
    start && end ? (shifts ?? []).filter((s) => new Date(s.starts_at).getTime() < start || new Date(s.ends_at).getTime() > end).length : 0;
  const check = [event.director_info && "the fee and dates in the information for directors", from.payment_link && "the payment link", from.meals_offered && "the meal price"].filter(
    Boolean,
  ) as string[];
  if (!check.length) check.push("the settings below");
  const list = check.length > 2 ? `${check.slice(0, -1).join(", ")}, and ${check.at(-1)}` : check.join(" and ");
  return { jobs: counts ? `, and its ${counts} ${jobs + stops === 1 ? "is" : "are"} on the Volunteers step` : "", dates, shiftsOutside, check: list };
}

/** Picked the wrong contest: delete this one (nothing published, no bands) and pick again. */
function StartOver({ eventId }: { eventId: string }) {
  return (
    <ActionButton
      action={startContestOver.bind(null, eventId)}
      variant="secondary"
      pendingText="Starting over…"
      confirmMessage="Start over from a different contest? This deletes this new contest and everything set up in it so far, then takes you back to pick another. Your date stays."
      confirmLabel="Delete and start over"
      className="mt-1"
    >
      Picked the wrong contest? Start over
    </ActionButton>
  );
}

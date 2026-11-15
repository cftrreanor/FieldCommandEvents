import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { LineIcon } from "@/components/line-icon";
import { requireUser } from "@/lib/auth";
import { getEventAccess, getOrigin } from "@/lib/data";
import { hasParents } from "@/lib/event-types";
import { formatPhone } from "@/lib/phone";
import { ADULTS, closesAtLabel, parentRegistrationClosed, sortedAdults, type Child } from "@/lib/parents";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateRange, utcToZonedDate, utcToZonedTime, zoneName } from "@/lib/time";
import { checkInSummary, visitorListStatus, type ReportSummary, type VisitorListStatus } from "@/lib/visitor-lists";
import {
  copyLine,
  deletedLine,
  deletionDay,
  familiesDeletedLine,
  joinNames,
  keptUntil,
  plural,
  REPORT_NAME,
  saveBefore,
  savedLine,
  SEND_TO_OFFICE,
  shortDate,
  WHO_SEES,
} from "@/lib/visitor-words";
import { ActionButton, CopyLinkButton } from "../forms";
import { saveParentSettings, setParentRegistrationOpen } from "./actions";
import { FamiliesList, type ListedFamily } from "./families-list";
import { CopyConfirmButton, CopyUndoButton, DownloadLink, NamesToCheck, type NameToCheck } from "./visitor-controls";
import { ParentSettingsForm } from "./settings-form";
import { importParents } from "@/app/dashboard/import-actions";
import { SpreadsheetImport } from "@/components/spreadsheet-import";
import { GRADE_CHOICES, importFields } from "@/lib/imports";
import { SavedBy } from "@/components/saved-by";
import { SetupTabs } from "../../_components/setup-tabs";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Parent Registration" };
}

/**
 * School visitor events. Hosts: Parent Registration, like Band Registration:
 * a card with where registration stands, its link, and the one button for
 * what's next; then tabs for the families, the settings, and importing.
 * Checking parents in at the door is its own page (check-in/), like volunteer
 * check-in; the team only ever goes there.
 */
export default async function ParentRegistrationPage({ params, searchParams }: PageProps<"/dashboard/events/[eventId]/parents">) {
  const { eventId } = await params;
  const { tab } = await searchParams;
  const access = await getEventAccess(eventId);
  if (!access.isHost) redirect(`/dashboard/events/${eventId}/parents/check-in`);
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, slug, name, status, event_type, timezone, starts_on, ends_on, parent_registration_open, parent_registration_closes_at, parent_walk_ins_allowed")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) missing();
  if (!hasParents(event.event_type)) redirect(`/dashboard/events/${eventId}`);

  // Practice check-ins from the day before don't count once the event starts.
  await supabase.rpc("clear_practice_parent_check_ins", { p_event: eventId });
  const [user, { data }, { data: emailRows }, summary, { data: checkRows }, { data: hostRows }] = await Promise.all([
    requireUser(),
    supabase.from("parent_registrations").select(`id, parent_name, phone, children, created_at, ${ADULTS}`).eq("event_id", eventId).order("parent_name"),
    // Email addresses come only from this Host/Co-host function (never readable from the table).
    supabase.rpc("parent_registration_emails", { p_event: eventId }),
    // The report's numbers and state: live, final, or deleted (Hosts and Co-hosts).
    checkInSummary(supabase, eventId).catch(() => null),
    // Names the app split from one box, where the split could be wrong.
    supabase
      .from("parent_registration_adults")
      .select("id, first_name, last_name, typed_name, full_name")
      .eq("event_id", eventId)
      .eq("name_needs_check", true)
      .order("last_name")
      .order("first_name"),
    supabase.rpc("event_hosts", { p_event: eventId }),
  ]);
  if (!summary) missing();
  const tz = event.timezone;
  // The visitor list's last download, and what's new or corrected since (while families' details are kept).
  const listStatus: VisitorListStatus | null = summary.kept ? await visitorListStatus(supabase, eventId).catch(() => null) : null;
  const emails = new Map(((emailRows ?? []) as { registration_id: string; email: string }[]).map((e) => [e.registration_id, e.email]));
  const families: ListedFamily[] = (data ?? []).map((r) => ({
    id: r.id,
    adults: sortedAdults(r.adults).map((a) => ({
      id: a.id,
      name: a.full_name,
      firstName: a.first_name,
      sentToOffice: Boolean(a.sent_to_office_at),
      checkedIn: Boolean(a.checked_in_at),
    })),
    children: (r.children ?? []) as Child[],
    email: emails.get(r.id) ?? "",
    phone: r.phone ? formatPhone(r.phone) : null,
    registeredOn: utcToZonedDate(r.created_at, tz),
  }));
  const childCount = families.reduce((n, f) => n + f.children.length, 0);
  const adultCount = families.reduce((n, f) => n + f.adults.length, 0);
  const namesToCheck: NameToCheck[] = ((checkRows ?? []) as { id: string; first_name: string; last_name: string; typed_name: string | null; full_name: string }[]).map(
    (a) => ({ id: a.id, typed: a.typed_name || a.full_name, first: a.first_name, last: a.last_name }),
  );
  const hosts = (hostRows ?? []) as { user_id: string; full_name: string | null; kind: "owner" | "every" | "event" }[];
  const accountHost = hosts.find((h) => h.kind === "owner");

  const today = utcToZonedDate(new Date().toISOString(), tz);
  const over = today > event.ends_on;
  const isEventDay = today >= event.starts_on && !over;
  // The front-office mark can be set until check-in locks after the event's last day.
  const canStop = summary.kept && !over;
  const link = `${await getOrigin()}/e/${event.slug}/parents`;
  const closed = parentRegistrationClosed(event);
  const closesAt = event.parent_registration_closes_at;
  // "Closed Fri, Nov 13" once that time has passed, "Closes" before.
  const deadlinePassed = Boolean(closesAt && new Date(closesAt) <= new Date());
  const closeWord = deadlinePassed ? "Closed" : "Closes";
  const published = event.status === "published";
  const [qrSvg, qrPng] = await Promise.all([
    QRCode.toString(link, { type: "svg", margin: 1, width: 160 }),
    QRCode.toDataURL(link, { margin: 2, width: 1024 }),
  ]);

  // Registered families shows once registration has opened (or anyone's on the list): before that there's nothing to see.
  const showFamilies = families.length > 0 || event.parent_registration_open || closed === "deadline" || closed === "over";
  const tabs = [...(showFamilies ? ["families"] : []), "settings", ...(over ? [] : ["import"])];
  const current = tabs.find((t) => t === tab) ?? tabs[0];
  const base = `/dashboard/events/${eventId}/parents`;
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  // One size for every button in the registration link's row (Copy link's).
  const rowButton =
    "inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-3 text-sm font-semibold hover:border-brand hover:bg-background";
  // After the clean-up: what registered, from the names-free totals kept (past tense; the link's tools are gone).
  const deleted = summary.deleted;
  const keptTotals =
    deleted && summary.families !== null
      ? `${joinNames([n(summary.families, "family", "families"), n(summary.adults ?? 0, "adult", "adults"), n(summary.children ?? 0, "child", "children")])} registered`
      : null;

  return (
    // data-required-marks: a small asterisk on each box that has to be filled in (globals.css).
    <div data-required-marks>
      <Link href={`/dashboard/events/${eventId}`} className="text-sm text-muted hover:text-foreground">
        ← Back to {event.name}
      </Link>
      <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Parent Registration</h1>
      <SavedBy eventId={eventId} area="parents" className="mt-2" />
      <p className="mt-2 text-sm text-muted">
        {formatDateRange(event.starts_on, event.ends_on)} · All times are {zoneName(tz)}.
      </p>

      {/* The one thing to do now: send names to the visitor system, check in at the door, save the report, or what's left. */}
      <VisitorCard
        summary={summary}
        listStatus={listStatus}
        namesToCheck={namesToCheck}
        eventId={eventId}
        tz={tz}
        startsOn={event.starts_on}
        endsOn={event.ends_on}
        isEventDay={isEventDay}
        over={over}
        registration={closed === null ? "open" : closed === "deadline" && closesAt ? `closed ${shortDate(utcToZonedDate(closesAt, tz))}` : "closed"}
      />

      {/* Where registration stands, its link, and the one button for what's next. */}
      <Card className="mt-6">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={!published ? "neutral" : closed === null ? "live" : "neutral"}>
            {!published ? "Event not published" : closed === null ? "Registration open" : showFamilies ? "Registration closed" : "Not open yet"}
          </Badge>
          <span className="text-muted">
            {[
              deleted
                ? keptTotals && `${keptTotals} · ${n(summary.checked_in ?? 0, "adult", "adults")} checked in`
                : showFamilies
                  ? `${n(families.length, "family", "families")} · ${n(adultCount, "adult", "adults")} · ${n(childCount, "child", "children")}`
                  : null,
              closesAt && closed !== "over" ? `${closeWord} ${closesAtLabel(closesAt, tz)}` : null,
              closed === "over" ? "The event is over" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </p>
        {!deleted && (
        <div className="mt-4">
          <p className="text-sm font-medium">Registration link</p>
          <p className="mt-1 text-sm break-words text-muted">
            {/* Long links break after a slash, not mid-word, on a phone. */}
            {link.split("/").map((part, i, all) => (
              <span key={i}>
                {part}
                {i < all.length - 1 && (
                  <>
                    /<wbr />
                  </>
                )}
              </span>
            ))}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyLinkButton url={link} label="Copy link" />
            <a href={`/e/${event.slug}/parents`} target="_blank" className={rowButton}>
              Preview page
            </a>
            {/* On the event day the top card's "Open check-in" is the way in. */}
            {!isEventDay && (
              <Link href={`${base}/check-in`} className={rowButton}>
                Check-in
              </Link>
            )}
            {published && closed === null && (
              <ActionButton
                action={setParentRegistrationOpen.bind(null, eventId, false)}
                variant="stop"
                className="px-3!"
                confirmMessage="Close parent registration? Parents won't be able to register."
                cancelLabel="Cancel"
              >
                Close registration
              </ActionButton>
            )}
            {/* Closed by hand: a quiet way back, until the event day (names added after that miss the school's checks). */}
            {published && closed === "closed" && !deadlinePassed && showFamilies && today < event.starts_on && (
              <ActionButton
                action={setParentRegistrationOpen.bind(null, eventId, true)}
                variant="secondary"
                className="px-3!"
                confirmMessage={`Reopen parent registration? Families can register from the link again. Anyone new needs to go to your school's visitor system before ${shortDate(event.starts_on)}.`}
                confirmLabel="Reopen registration"
                cancelLabel="Cancel"
              >
                Reopen registration
              </ActionButton>
            )}
            {published && closed === "closed" && !showFamilies && (
              <ActionButton action={setParentRegistrationOpen.bind(null, eventId, true)} variant="go" className="px-3!">
                Open registration
              </ActionButton>
            )}
          </div>
          {!published && (
            <p className="mt-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
              Publish the event from its main page first, then open registration here.
            </p>
          )}
          {(closed === "deadline" || (closed === "closed" && deadlinePassed && showFamilies)) && closesAt && today < event.starts_on && (
            <p className="mt-3 text-sm">
              Registration closed on {closesAtLabel(closesAt, tz)}. To reopen it, change or remove the closing time in{" "}
              <Link href={`${base}?tab=settings`} scroll={false} className="font-medium text-brand underline-offset-4 hover:underline">
                Registration settings
              </Link>
              .
            </p>
          )}
          <p className="mt-2 text-sm text-muted">
            {over ? "" : "Parents get a reminder to bring their photo ID the day before. "}
            {keptUntil(event.ends_on)}
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
              <a href={qrPng} download={`${event.slug}-parent-registration-qr.png`} className="inline-flex min-h-11 items-center text-xs font-medium text-brand underline-offset-4 hover:underline">
                Download QR code
              </a>
            </div>
          </details>
        </div>
        )}
      </Card>

      <div className="mt-10">
        <SetupTabs
          label="Parent registration"
          tabs={[
            ...(showFamilies
              ? [
                  {
                    key: "families",
                    label: "Registered families",
                    short: "Families",
                    // After the clean-up, the kept total (the families themselves are gone).
                    status: n(deleted ? (summary.families ?? 0) : families.length, "family", "families"),
                    href: `${base}?tab=families`,
                    active: current === "families",
                  },
                ]
              : []),
            {
              key: "settings",
              label: "Registration settings",
              short: "Settings",
              status: closesAt ? `${closeWord} ${formatDate(utcToZonedDate(closesAt, tz), { year: undefined, weekday: undefined })}` : "Optional",
              // A phone's tab is narrow: once closed, the word alone.
              shortStatus: closesAt && deadlinePassed ? "Closed" : undefined,
              mark: closesAt ? ("done" as const) : undefined,
              href: `${base}?tab=settings`,
              active: current === "settings",
            },
            ...(over ? [] : [{ key: "import", label: "Import families", short: "Import", status: "Optional", href: `${base}?tab=import`, active: current === "import" }]),
          ]}
        />
        <div className="mt-6">
          {current === "families" && (
            <Card>
              <h2 className="text-lg font-semibold">Registered families{summary.deleted ? "" : ` (${families.length})`}</h2>
              {summary.deleted ? (
                <div className="mt-1 space-y-2 text-sm leading-6 text-muted">
                  <p>{familiesDeletedLine(event.ends_on)}</p>
                  {keptTotals && (
                    <p>
                      {keptTotals}. {n(summary.checked_in ?? 0, "adult", "adults")} checked in at the event door
                      {summary.sent_to_office ? `, and ${summary.sent_to_office} ${summary.sent_to_office === 1 ? "was" : "were"} sent to the front office` : ""}.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <p className="mt-1 mb-4 text-sm text-muted">
                    {over ? (
                      "Everyone who registered or was imported."
                    ) : (
                      <>
                        Everyone who registered or was imported. Check them in at the door from{" "}
                        <Link href={`${base}/check-in`} className="font-medium text-brand underline-offset-4 hover:underline">
                          Check-in
                        </Link>{" "}
                        on the day.
                      </>
                    )}
                  </p>
                  {families.length > 0 && (
                    <Downloads
                      base={base}
                      eventId={eventId}
                      startsOn={event.starts_on}
                      reportOpen={today >= event.starts_on}
                      over={over}
                      canStop={canStop}
                      adults={adultCount}
                      namesToCheck={namesToCheck.length}
                      isAccountHost={accountHost?.user_id === user.id}
                      accountHostName={accountHost?.full_name?.trim() || "your Account Host"}
                    />
                  )}
                  <FamiliesList eventId={eventId} families={families} canStop={canStop} />
                </>
              )}
            </Card>
          )}
          {current === "settings" && (
            <Card>
              <h2 className="text-lg font-semibold">Registration settings</h2>
              <p className="mt-1 mb-4 text-sm text-muted">When registration closes on its own, and whether parents who didn&apos;t register can still come.</p>
              {closed === "over" ? (
                <p className="text-sm text-muted">The event is over.</p>
              ) : (
                <ParentSettingsForm
                  action={saveParentSettings.bind(null, eventId, tz)}
                  date={closesAt ? utcToZonedDate(closesAt, tz) : ""}
                  time={closesAt ? utcToZonedTime(closesAt, tz) : ""}
                  walkIns={event.parent_walk_ins_allowed}
                  zone={`All times are ${zoneName(tz)}`}
                />
              )}
            </Card>
          )}
          {current === "import" && (
            <Card>
              <h2 className="text-lg font-semibold">Import families</h2>
              <p className="mt-1 mb-4 text-sm text-muted">
                Optional. Already collected registrations, like from a Google Form? Add them so they&apos;re on the check-in list. One row
                per child; rows with the same email become one family. Families already registered are left as they are.
              </p>
              <SpreadsheetImport
                kind="parents"
                fields={importFields("parents")}
                choices={{ grade: GRADE_CHOICES }}
                noun={{ one: "family", many: "families" }}
                templateName="parent-registrations.csv"
                emailOption="Email each family a confirmation with their link, a calendar invite, and the photo ID reminder"
                action={importParents.bind(null, eventId)}
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

const LINK = "font-medium text-brand underline underline-offset-4";
const PRIMARY_LINK = "inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-center text-sm font-semibold text-brand-foreground hover:bg-brand-hover";
const OUTLINE_LINK =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-field-border bg-surface px-4 text-center text-sm font-semibold hover:border-brand hover:bg-background";

/** A warning that's due: the deletion date (docs/design-lessons.md L9). The title in bold, what's known under it. */
function Warn({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div role="note" className="flex gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm leading-6">
      <LineIcon name="warning" className="mt-0.5 size-5 shrink-0 text-warning" />
      <div className="space-y-2">
        <p className="font-semibold">{title}</p>
        {children}
      </div>
    </div>
  );
}

/**
 * Parent Registration's top card: the one thing to do now. Before the day, send names to the school's visitor
 * system (names to check first, then the download); on the day, the door and the report; after the event, save the
 * report before it's deleted, until someone confirms the school has a copy; after that, what's left.
 */
function VisitorCard({
  summary,
  listStatus,
  namesToCheck,
  eventId,
  tz,
  startsOn,
  endsOn,
  isEventDay,
  over,
  registration,
}: {
  summary: ReportSummary;
  listStatus: VisitorListStatus | null;
  namesToCheck: NameToCheck[];
  eventId: string;
  tz: string;
  startsOn: string;
  endsOn: string;
  isEventDay: boolean;
  over: boolean;
  /** "open", "closed", or "closed Mon, Nov 30". */
  registration: string;
}) {
  const base = `/dashboard/events/${eventId}/parents`;
  const adults = summary.adults ?? 0;
  const reportLink = `${base}/report`;

  if (summary.deleted) {
    return (
      <Card className="mt-6 space-y-3 p-4 sm:p-5">
        {summary.families === null ? (
          <p className="text-sm leading-6">{familiesDeletedLine(endsOn)}</p>
        ) : adults === 0 ? (
          <p className="text-sm leading-6">No families registered for this event.</p>
        ) : (
          <>
            <p className="text-sm leading-6">{deletedLine(endsOn)}</p>
            <Link href={reportLink} className={OUTLINE_LINK}>
              Open visitor check-in report
            </Link>
          </>
        )}
      </Card>
    );
  }

  if (over) {
    if (adults === 0) {
      return (
        <Card className="mt-6 p-4 sm:p-5">
          <p className="text-sm leading-6">The event is over. No families registered, so there&apos;s no visitor check-in report.</p>
        </Card>
      );
    }
    const result = (
      <p className="text-sm leading-6">
        The event is over. {summary.checked_in} of {plural(adults, "registered adult", "registered adults")} checked in.
      </p>
    );
    // Someone confirmed the school has its copy: the warning's done, the date still stands.
    if (summary.copy_confirmed_at) {
      return (
        <Card className="mt-6 space-y-3 p-4 sm:p-5">
          <p className="text-sm leading-6">
            {copyLine(summary.copy_confirmed_by_name, utcToZonedDate(summary.copy_confirmed_at, tz), endsOn)} <CopyUndoButton eventId={eventId} />
          </p>
          {result}
          <Link href={reportLink} className={OUTLINE_LINK}>
            Open visitor check-in report
          </Link>
        </Card>
      );
    }
    return (
      <Card className="mt-6 space-y-3 border-brand p-4 sm:p-5">
        <Warn title={saveBefore(endsOn)}>
          <p>
            {summary.saved_at
              ? `${savedLine(summary.saved_by_name, utcToZonedDate(summary.saved_at, tz), summary.saved_kind)} Once the copy is where your school keeps its records, confirm it here.`
              : "Nobody has printed or downloaded it yet."}
          </p>
        </Warn>
        {result}
        <div className="flex flex-wrap items-start gap-2">
          <Link href={reportLink} className={summary.saved_at ? OUTLINE_LINK : PRIMARY_LINK}>
            Open visitor check-in report
          </Link>
          {/* Once a print or download is on record, confirming the school kept it is what's left to do. */}
          <CopyConfirmButton eventId={eventId} deleteOn={deletionDay(endsOn)} primary={Boolean(summary.saved_at)} />
        </div>
      </Card>
    );
  }

  if (isEventDay) {
    return (
      <Card className="mt-6 space-y-3 border-brand p-4 sm:p-5">
        <div className="space-y-1 text-sm leading-6">
          <p>
            <span className="font-semibold">It&apos;s the day of the event.</span> Check parents in at the door, after their photo ID.
          </p>
          {adults > 0 && (
            <p className="text-muted">
              {summary.checked_in} of {plural(adults, "registered adult", "registered adults")} checked in so far
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`${base}/check-in`} className={PRIMARY_LINK}>
            Open check-in
          </Link>
          {adults > 0 && (
            <Link href={reportLink} className={OUTLINE_LINK}>
              Open visitor check-in report
            </Link>
          )}
        </div>
      </Card>
    );
  }

  // Before the day: nothing to send until someone registers.
  if (adults === 0 || !listStatus) return null;
  const hasPrev = Boolean(listStatus.last_at);
  const added = hasPrev ? listStatus.new_adults : 0;
  const corrected = hasPrev ? listStatus.changed_adults : 0;
  const removed = hasPrev ? listStatus.removed_adults : 0;
  const changes = added + corrected + removed;
  const since = joinNames([added ? `${added} new` : "", corrected ? `${corrected} corrected` : "", removed ? `${removed} removed` : ""].filter(Boolean));
  const unchecked = namesToCheck.length;
  return (
    <Card className="mt-6 space-y-3 border-brand p-4 sm:p-5">
      <div className="space-y-1 text-sm leading-6">
        <p className="font-semibold">
          {registration === "open"
            ? `Registration is open. ${plural(adults, "adult has", "adults have")} registered so far.`
            : registration === "closed"
              ? `Registration is closed. ${plural(adults, "adult", "adults")} registered.`
              : `Registration ${registration}. ${plural(adults, "adult", "adults")} registered.`}
        </p>
        <p>Send their names to your school&apos;s visitor system before {shortDate(startsOn)}.</p>
        <p className="text-muted">
          {hasPrev
            ? `${listStatus.last_by_name ?? "Someone"} last downloaded the list ${shortDate(utcToZonedDate(listStatus.last_at!, tz))} · ${since ? `${since} since` : "nothing new since"}`
            : "Nobody has downloaded the list yet."}
        </p>
      </div>
      <NamesToCheck eventId={eventId} names={namesToCheck} />
      {/* One main button that follows where things stand: what's changed since the last download, or everyone. */}
      <div className="flex flex-wrap gap-2">
        {changes > 0 ? (
          <DownloadLink href={`${base}/download?list=visitor&only=new`} primary namesToCheck={unchecked}>
            {`Download ${plural(changes, "new and changed name", "new and changed names")}`}
          </DownloadLink>
        ) : (
          <DownloadLink href={`${base}/download?list=visitor`} primary={!hasPrev} namesToCheck={unchecked}>
            {allAdultsLabel(adults, listStatus.rows)}
          </DownloadLink>
        )}
      </div>
      {changes > 0 && (
        <p className="text-sm leading-6 text-muted">
          New, corrected, and removed adults only. Corrected rows show the name they had before; removed ones are marked Removed. The whole list
          is under Registered families.
        </p>
      )}
    </Card>
  );
}

/** "Download all 481 adults (612 rows)": one row per adult per child. */
const allAdultsLabel = (adults: number, rows: number) => `Download all ${plural(adults, "adult", "adults")} (${plural(rows, "row", "rows")})`;

/**
 * Registered families' downloads and the report, with the lines that explain them beside them: the front office,
 * who to add as a Co-host, and who sees what (once). After the event the report has its own button at the top.
 */
function Downloads({
  base,
  eventId,
  startsOn,
  reportOpen,
  over,
  canStop,
  adults,
  namesToCheck,
  isAccountHost,
  accountHostName,
}: {
  base: string;
  eventId: string;
  startsOn: string;
  reportOpen: boolean;
  over: boolean;
  canStop: boolean;
  adults: number;
  namesToCheck: number;
  isAccountHost: boolean;
  accountHostName: string;
}) {
  const block = "flex flex-col items-start gap-1.5 rounded-lg border border-border p-3";
  const can = over ? `open the ${REPORT_NAME.toLowerCase()} and save it` : `download the visitor list and open the ${REPORT_NAME.toLowerCase()}`;
  return (
    <div className="mb-6 space-y-3">
      <div className={`grid gap-3 ${over ? "md:grid-cols-2" : "lg:grid-cols-3"}`}>
        <div className={block}>
          <DownloadLink href={`${base}/download?list=visitor`} namesToCheck={namesToCheck}>
            {`Download visitor list: all ${plural(adults, "adult", "adults")}`}
          </DownloadLink>
          <p className="text-sm text-muted">One row per adult per child, first and last names apart, for your school&apos;s visitor system</p>
        </div>
        <div className={block}>
          <DownloadLink href={`${base}/download?list=class`}>Download class list</DownloadLink>
          <p className="text-sm text-muted">One row per child, for teachers and planning</p>
        </div>
        {!over && (
          <div className={block}>
            {reportOpen ? (
              <Link href={`${base}/report`} className={OUTLINE_LINK}>
                Open visitor check-in report
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="inline-flex min-h-11 cursor-not-allowed items-center rounded-md border border-field-border px-4 text-sm font-semibold text-disabled"
              >
                Open visitor check-in report
              </span>
            )}
            <p className="text-sm text-muted">{reportOpen ? "Who has checked in at the door so far" : `Opens ${shortDate(startsOn)}, the day of the event`}</p>
          </div>
        )}
      </div>
      {canStop && (
        <p className="text-sm leading-6 text-muted">
          If someone doesn&apos;t clear the school&apos;s check, choose <span className="font-semibold text-foreground">{SEND_TO_OFFICE}</span> under their
          name below. Check-in then shows a note asking them to go to the front office, in place of their Check in button.
        </p>
      )}
      <p className="text-sm leading-6 text-muted">
        {over ? "Does your front office keep the school's visitor records?" : "Does your front office run the visitor checks?"}{" "}
        {isAccountHost ? (
          <>
            <Link href={`/dashboard/events/${eventId}/edit?section=team&tab=hosts`} className={LINK}>
              Add your front office as a Co-host
            </Link>{" "}
            so they can {can}.
          </>
        ) : (
          `Ask ${accountHostName} to add your front office as a Co-host, so they can ${can}.`
        )}
      </p>
      <p className="text-sm leading-6 text-muted">{WHO_SEES}</p>
    </div>
  );
}

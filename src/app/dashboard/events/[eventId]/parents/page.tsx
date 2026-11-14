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
import { deletedLine, plural, REPORT_NAME, saveBefore, savedLine, shortDate, WHO_SEES } from "@/lib/visitor-words";
import { ActionButton, CopyLinkButton } from "../forms";
import { saveParentSettings, setParentRegistrationOpen } from "./actions";
import { FamiliesList, type ListedFamily } from "./families-list";
import { DownloadLink, NamesToCheck, type NameToCheck } from "./visitor-controls";
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
  const smallButton = "inline-flex min-h-9 items-center rounded-md border border-border bg-surface px-3 text-xs font-medium hover:bg-background";
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

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
              showFamilies ? `${n(families.length, "family", "families")} · ${n(adultCount, "adult", "adults")} · ${n(childCount, "child", "children")}` : null,
              closesAt && closed !== "over" ? `${closed === "deadline" ? "Closed" : "Closes"} ${closesAtLabel(closesAt, tz)}` : null,
              closed === "over" ? "The event is over" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </p>
        <div className="mt-4">
          <p className="text-sm font-medium">Registration link</p>
          <p className="mt-1 break-all text-sm text-muted">{link}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyLinkButton url={link} label="Copy link" />
            <a href={`/e/${event.slug}/parents`} target="_blank" className={smallButton}>
              Preview page
            </a>
            <Link href={`${base}/check-in`} className={smallButton}>
              Check-in
            </Link>
            {published && (closed === null || closed === "closed") && (
              <ActionButton
                action={setParentRegistrationOpen.bind(null, eventId, !event.parent_registration_open)}
                variant={event.parent_registration_open ? "stop" : "go"}
                className="px-3! text-xs!"
                confirmMessage={event.parent_registration_open ? "Close parent registration? Parents won't be able to register." : undefined}
              >
                {event.parent_registration_open ? "Close registration" : "Open registration"}
              </ActionButton>
            )}
          </div>
          {!published && (
            <p className="mt-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
              Publish the event from its main page first, then open registration here.
            </p>
          )}
          {closed === "deadline" && closesAt && (
            <p className="mt-3 text-sm">
              Registration closed on its own on {closesAtLabel(closesAt, tz)}. To reopen it, change or remove the closing time in{" "}
              <Link href={`${base}?tab=settings`} scroll={false} className="font-medium text-brand underline-offset-4 hover:underline">
                Registration settings
              </Link>
              .
            </p>
          )}
          <p className="mt-2 text-sm text-muted">
            Parents get a reminder to bring their photo ID the day before. Children&apos;s details are deleted 30 days after the event
            {over ? `, on ${formatDate(addDays(event.ends_on, 31), { year: undefined })}` : ""}.
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
      </Card>

      <div className="mt-10">
        <SetupTabs
          label="Parent registration"
          tabs={[
            ...(showFamilies
              ? [{ key: "families", label: "Registered families", status: n(families.length, "family", "families"), href: `${base}?tab=families`, active: current === "families" }]
              : []),
            {
              key: "settings",
              label: "Registration settings",
              status: closesAt ? `${closed === "deadline" ? "Closed" : "Closes"} ${formatDate(utcToZonedDate(closesAt, tz), { year: undefined, weekday: undefined })}` : "Optional",
              mark: closesAt ? ("done" as const) : undefined,
              href: `${base}?tab=settings`,
              active: current === "settings",
            },
            ...(over ? [] : [{ key: "import", label: "Import families", status: "Optional", href: `${base}?tab=import`, active: current === "import" }]),
          ]}
        />
        <div className="mt-6">
          {current === "families" && (
            <Card>
              <h2 className="text-lg font-semibold">Registered families{summary.deleted ? "" : ` (${families.length})`}</h2>
              {summary.deleted ? (
                <p className="mt-1 text-sm text-muted">
                  {summary.deleted_at
                    ? `Families' and children's details were deleted on ${formatDate(utcToZonedDate(summary.deleted_at, tz))}, as promised to families.`
                    : "Families' and children's details were deleted 30 days after the event, as promised to families."}
                </p>
              ) : (
                <>
                  <p className="mt-1 mb-4 text-sm text-muted">
                    Everyone who registered or was imported. Check them in at the door from{" "}
                    <Link href={`${base}/check-in`} className="font-medium text-brand underline-offset-4 hover:underline">
                      Check-in
                    </Link>{" "}
                    on the day.
                  </p>
                  {families.length > 0 && (
                    <Downloads
                      base={base}
                      eventId={eventId}
                      startsOn={event.starts_on}
                      reportOpen={today >= event.starts_on}
                      over={over}
                      canStop={canStop}
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

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const LINK = "font-medium text-brand underline underline-offset-4";
const PRIMARY_LINK = "inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-center text-sm font-semibold text-brand-foreground hover:bg-brand-hover";
const OUTLINE_LINK =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-field-border bg-surface px-4 text-center text-sm font-semibold hover:border-brand hover:bg-background";

/** A warning that's due: the deletion date (docs/design-lessons.md L9). */
function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p role="note" className="flex gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm leading-6">
      <LineIcon name="warning" className="mt-0.5 size-5 shrink-0 text-warning" />
      <span className="font-semibold">{children}</span>
    </p>
  );
}

/**
 * Parent Registration's top card: the one thing to do now. Before the day, send names to the school's visitor
 * system (names to check first, then the download); on the day, the door and the report; after the event, save the
 * report before it's deleted; after that, what's left.
 */
function VisitorCard({
  summary,
  listStatus,
  namesToCheck,
  eventId,
  tz,
  startsOn,
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
          <p className="text-sm leading-6">Families&apos; and children&apos;s details were deleted 30 days after the event, as promised to families.</p>
        ) : adults === 0 ? (
          <p className="text-sm leading-6">No families registered for this event.</p>
        ) : (
          <>
            <p className="text-sm leading-6">{deletedLine(utcToZonedDate(summary.deleted_at ?? new Date().toISOString(), tz))}</p>
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
    return (
      <Card className="mt-6 space-y-3 border-brand p-4 sm:p-5">
        {summary.saved_at ? (
          <p className="text-sm leading-6">{savedLine(summary.saved_by_name, utcToZonedDate(summary.saved_at, tz), summary.delete_on)}</p>
        ) : (
          <Warn>{saveBefore(summary.delete_on)}</Warn>
        )}
        <p className="text-sm leading-6">
          The event is over. {summary.checked_in} of {plural(adults, "registered adult", "registered adults")} checked in.
        </p>
        <Link href={reportLink} className={summary.saved_at ? OUTLINE_LINK : PRIMARY_LINK}>
          Open visitor check-in report
        </Link>
      </Card>
    );
  }

  if (isEventDay) {
    return (
      <Card className="mt-6 space-y-3 border-brand p-4 sm:p-5">
        <p className="text-sm leading-6">
          <span className="font-semibold">It&apos;s the day of the event.</span> Check parents in at the door, after their photo ID.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={`${base}/check-in`} className={PRIMARY_LINK}>
            Open check-in
          </Link>
          {adults > 0 && (
            <Link href={reportLink} className={OUTLINE_LINK}>
              Open visitor check-in report · {summary.checked_in} of {adults} checked in so far
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
  const since = [added ? `${added} new` : "", corrected ? `${corrected} corrected` : ""].filter(Boolean).join(" and ");
  const what = since || `all ${adults}`;
  const unchecked = namesToCheck.length;
  const label = unchecked
    ? `Download anyway: ${what} (${plural(unchecked, "name", "names")} not checked)`
    : `Download visitor list: ${what}`;
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
      <div className="flex flex-wrap gap-2">
        <DownloadLink href={`${base}/download?list=visitor${since ? "&only=new" : ""}`} primary={!unchecked}>
          {label}
        </DownloadLink>
        {since && <DownloadLink href={`${base}/download?list=visitor`}>{`Download visitor list: all ${adults}`}</DownloadLink>}
      </div>
    </Card>
  );
}

/**
 * Registered families' downloads and the report, with the lines that explain them beside them: the front office,
 * who to add as a Co-host, and who sees what (once).
 */
function Downloads({
  base,
  eventId,
  startsOn,
  reportOpen,
  over,
  canStop,
  isAccountHost,
  accountHostName,
}: {
  base: string;
  eventId: string;
  startsOn: string;
  reportOpen: boolean;
  over: boolean;
  canStop: boolean;
  isAccountHost: boolean;
  accountHostName: string;
}) {
  const block = "flex flex-col items-start gap-1.5 rounded-lg border border-border p-3";
  return (
    <div className="mb-6 space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <div className={block}>
          <DownloadLink href={`${base}/download?list=visitor`}>Download visitor list</DownloadLink>
          <p className="text-sm text-muted">One row per adult per child, first and last names apart, for your school&apos;s visitor system</p>
        </div>
        <div className={block}>
          <DownloadLink href={`${base}/download?list=class`}>Download class list</DownloadLink>
          <p className="text-sm text-muted">One row per child, for teachers and planning</p>
        </div>
        <div className={block}>
          {reportOpen ? (
            <Link href={`${base}/report`} className={OUTLINE_LINK}>
              Open visitor check-in report
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="inline-flex min-h-11 items-center rounded-md border border-dashed border-field-border px-4 text-sm font-semibold text-disabled"
            >
              Open visitor check-in report
            </span>
          )}
          <p className="text-sm text-muted">
            {reportOpen ? (over ? "Final: who checked in at the door" : "Who has checked in at the door so far") : `Opens ${shortDate(startsOn)}, the day of the event`}
          </p>
        </div>
      </div>
      {canStop && (
        <p className="text-sm leading-6 text-muted">
          If someone doesn&apos;t clear the school&apos;s check, use the <span className="font-semibold text-foreground">Stop at the door</span> button next to
          their name below. Check-in then asks them to go to the front office, in place of their Check in button.
        </p>
      )}
      <p className="text-sm leading-6 text-muted">
        Does your front office run the visitor checks?{" "}
        {isAccountHost ? (
          <>
            <Link href={`/dashboard/events/${eventId}/edit?section=team&tab=hosts`} className={LINK}>
              Add your front office as a Co-host
            </Link>{" "}
            so they can download the visitor list and open the {REPORT_NAME.toLowerCase()}.
          </>
        ) : (
          `Ask ${accountHostName} to add your front office as a Co-host, so they can download the visitor list and open the ${REPORT_NAME.toLowerCase()}.`
        )}
      </p>
      <p className="text-sm leading-6 text-muted">{WHO_SEES}</p>
    </div>
  );
}

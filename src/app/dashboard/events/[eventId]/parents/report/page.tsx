import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { LineIcon } from "@/components/line-icon";
import { Card } from "@/components/ui";
import { getEventAccess, getOrigin } from "@/lib/data";
import { hasParents } from "@/lib/event-types";
import { parentRegistrationClosed } from "@/lib/parents";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateRange, formatTime, formatTimeRange, utcToZonedDate, zoneName } from "@/lib/time";
import { checkInReport, checkInSummary, type ReportRow } from "@/lib/visitor-lists";
import {
  copyLine,
  deletedLine,
  deletionDay,
  familiesDeletedLine,
  plural,
  REPORT_GROUPS as GROUPS,
  REPORT_NAME,
  REPORT_RECORDS_NOTE,
  REPORT_SCOPE,
  saveBefore,
  savedLine,
  shortDate,
} from "@/lib/visitor-words";
import { CopyLinkButton } from "../../forms";
import { CopyConfirmButton, CopyUndoButton, DownloadLink } from "../visitor-controls";
import { PrintReportButton, ReportView, type ReportLine } from "./report-view";

export const metadata: Metadata = { title: REPORT_NAME };

/** Text for a CSS string: quotes and backslashes escaped, and nothing that could end the style tag. */
const cssString = (text: string) => `"${text.replace(/[\\"]/g, "\\$&").replace(/[\n\r]/g, " ").replace(/</g, "\\3c ")}"`;

/*
 * Paper is black on white whatever the screen's theme (a dark-mode print came out blank in the mock-ups), letter
 * size with real margins, the event's name at the top of every page and "Page 2 of 7" at the bottom (where the browser
 * supports page margin boxes: Chrome and Edge do; others print without them). Only this page carries it.
 */
const printStyles = (eventName: string) => `@media print {
  @page {
    size: letter; margin: 0.6in 0.5in;
    @top-left { content: ${cssString(`${eventName} · ${REPORT_NAME}`)}; font: 9pt sans-serif; color: #000; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9pt sans-serif; color: #000; }
  }
  html:root {
    color-scheme: light;
    --background: #ffffff; --surface: #ffffff; --raised: #ffffff; --foreground: #000000; --muted: #000000;
    --border: #8a8a8a; --field-border: #000000; --brand: #000000; --brand-soft: #ffffff;
    --warning: #000000; --warning-soft: #ffffff; --danger: #000000; --success: #000000;
  }
  html, body { background: #ffffff !important; color: #000000 !important; font-size: 11pt; }
  main { max-width: none !important; padding: 0 !important; }
}`;

/**
 * The visitor check-in report (docs/design-decisions/2026-11-14-visitor-attendance.md): every registered adult and
 * whether they checked in at the event door. Hosts and Co-hosts only, built on the server from Host-only database
 * functions. Opens on the event day; live that day, final once check-in closes at the end of the event's last day;
 * after the 30-day deletion, names-free totals.
 */
export default async function VisitorReportPage({ params }: PageProps<"/dashboard/events/[eventId]/parents/report">) {
  const { eventId } = await params;
  const access = await getEventAccess(eventId);
  if (!access.isHost) redirect(`/dashboard/events/${eventId}`);
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, slug, name, status, event_type, timezone, starts_on, ends_on, window_start, window_end, parent_registration_open, parent_registration_closes_at")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) missing();
  if (!hasParents(event.event_type)) redirect(`/dashboard/events/${eventId}`);
  const summary = await checkInSummary(supabase, eventId).catch(() => null);
  if (!summary) missing();

  const tz = event.timezone;
  const base = `/dashboard/events/${eventId}/parents`;
  const multiDay = event.starts_on !== event.ends_on;
  const when = `${formatDateRange(event.starts_on, event.ends_on)} · ${formatTimeRange(event.window_start, event.window_end, tz, { zone: false })}`;
  const back = (
    <Link href={base} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground">
      ← Back to Parent Registration
    </Link>
  );
  const heading = (
    <>
      <h1 className="mt-4 text-2xl font-semibold sm:text-3xl print:mt-0">{REPORT_NAME}</h1>
      <p className="mt-1 text-sm text-muted">
        {event.name} · {when} · All times are {zoneName(tz)}
      </p>
    </>
  );

  // After the clean-up: what's left is names-free totals.
  if (summary.deleted) {
    const adults = summary.adults ?? 0;
    return (
      <Shell back={back}>
        {heading}
        <Card className="mt-6 space-y-4">
          {summary.families === null ? (
            <p className="leading-7">{familiesDeletedLine(event.ends_on)} No totals were kept for this event.</p>
          ) : adults === 0 ? (
            <p className="leading-7">No families registered for this event, so there was no one to report.</p>
          ) : (
            <>
              <p className="leading-7">{deletedLine(event.ends_on)}</p>
              <Stats
                items={[
                  [summary.sent_to_office ?? 0, "sent to the front office"],
                  [summary.checked_in ?? 0, "checked in"],
                  [summary.not_checked_in ?? 0, "not checked in"],
                ]}
              />
              <p className="text-sm text-muted">
                Of {plural(adults, "registered adult", "registered adults")} in {plural(summary.families, "family", "families")}
              </p>
            </>
          )}
        </Card>
      </Shell>
    );
  }

  // Before the event day there's nothing to report yet (practice check-ins don't count).
  if (summary.today < event.starts_on) {
    return (
      <Shell back={back}>
        {heading}
        <Card className="mt-6">
          <p className="font-semibold">Opens {shortDate(event.starts_on)}, the day of the event</p>
          <p className="mt-1 text-sm leading-6 text-muted">It shows each registered adult and whether they checked in at the event door.</p>
        </Card>
      </Shell>
    );
  }

  const final = summary.is_final;
  const adults = summary.adults ?? 0;

  if (adults === 0) {
    const stillOpen = !final && parentRegistrationClosed(event) === null;
    return (
      <Shell back={back}>
        {heading}
        <Card className="mt-6 space-y-3">
          <p className="leading-7">No families registered, so there&apos;s no one to report.</p>
          {stillOpen && <CopyLinkButton url={`${await getOrigin()}/e/${event.slug}/parents`} label="Copy registration link" />}
        </Card>
      </Shell>
    );
  }

  const rows = await checkInReport(supabase, eventId);
  const now = new Date().toISOString();
  const asOf = formatTime(now, tz);
  const lastDay = shortDate(event.ends_on);
  const lines: ReportLine[] = rows.map((r) => toLine(r, tz, multiDay));

  const counts: Record<ReportLine["status"], number> = {
    front_office: summary.sent_to_office ?? 0,
    checked_in: summary.checked_in ?? 0,
    not_yet: summary.not_checked_in ?? 0,
  };

  return (
    <Shell back={back}>
      {/* Paper is black on white, letter size, whatever the screen's theme. */}
      <style>{printStyles(event.name)}</style>
      {!final && <AutoRefresh seconds={30} />}
      {/* The title first (on a phone too), then the two ways to keep a copy. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          {heading}
          {final ? (
            <p className="mt-1 text-sm font-semibold">Final: check-in closed at the end of {lastDay}</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted print:hidden">
                Updated <span className="tabular-nums">{asOf}</span> · updates on its own
              </p>
              <p className="mt-1 hidden text-sm font-semibold print:block">
                In progress, as of {asOf}, {shortDate(utcToZonedDate(now, tz))}
              </p>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {/* During check-in neither is the main action: a copy made now isn't the record yet (design lessons L28). */}
          <DownloadLink href={`${base}/download?list=report`}>Download report spreadsheet</DownloadLink>
          {/* After the event: printing is the main step until a copy is on record; then it's "Our school has a copy". */}
          <PrintReportButton eventId={eventId} rows={rows.length} primary={final && !summary.copy_confirmed_at && !summary.saved_at} />
        </div>
      </div>

      {/* The counts, in the groups' order; each jumps to its group. */}
      <Stats
        className="mt-5"
        items={GROUPS.map((g) => [counts[g.key], g.key === "not_yet" ? (final ? "not checked in" : "not checked in yet") : g.title.toLowerCase(), `#${g.key}`])}
      />
      <p className="mt-2 text-sm text-muted">
        Of {plural(adults, "registered adult", "registered adults")} in {plural(summary.families ?? 0, "family", "families")}. {REPORT_SCOPE}
      </p>

      <div className="mt-4 print:hidden">
        {!final ? (
          <p className="rounded-md border border-border bg-background px-3 py-2 text-sm leading-6">
            Check-in is still going. The report is final when check-in closes at the end of {lastDay}. A copy printed now says &ldquo;In progress,
            as of {asOf}&rdquo;.
          </p>
        ) : summary.copy_confirmed_at ? (
          <p className="rounded-md border border-border bg-background px-3 py-2 text-sm leading-6">
            {copyLine(summary.copy_confirmed_by_name, utcToZonedDate(summary.copy_confirmed_at, tz), event.ends_on)} <CopyUndoButton eventId={eventId} />
          </p>
        ) : (
          // Stays until a Host or Co-host confirms the school has its copy: printing isn't proof it was kept.
          <div role="note" className="flex gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm leading-6">
            <LineIcon name="warning" className="mt-0.5 size-5 shrink-0 text-warning" />
            <div className="space-y-2">
              <p className="font-semibold">{saveBefore(event.ends_on)}</p>
              <p>
                {summary.saved_at
                  ? `${savedLine(summary.saved_by_name, utcToZonedDate(summary.saved_at, tz), summary.saved_kind, "report")} Once the copy is where your school keeps its records, confirm it here.`
                  : "Nobody has printed or downloaded it yet."}
              </p>
              <CopyConfirmButton eventId={eventId} deleteOn={deletionDay(event.ends_on)} primary={Boolean(summary.saved_at)} />
            </div>
          </div>
        )}
      </div>

      <div className="mt-6">
        <ReportView lines={lines} final={final} />
      </div>
      {/* On paper the dashboard's printed-records note follows (PrintRecordNote); on screen, this one. */}
      <p className="mt-8 text-sm text-muted print:hidden">{REPORT_RECORDS_NOTE}</p>
    </Shell>
  );
}

/** The page's frame. `back` is the back link, for the states without the full report's own top row. */
function Shell({ back, children }: { back?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl">
      {back && <div className="print:hidden">{back}</div>}
      {children}
    </div>
  );
}

/** Counts as figures, each with its noun, in one row (a phone too). With a link, the count jumps to its group. */
function Stats({ items, className = "" }: { items: [number, string, string?][]; className?: string }) {
  return (
    <dl className={`grid max-w-2xl grid-cols-3 gap-x-4 gap-y-3 ${className}`}>
      {items.map(([n, label, href]) => (
        <div key={label} className="flex flex-col-reverse justify-end">
          <dt className="text-xs leading-5 text-muted sm:text-sm">{label}</dt>
          <dd className="text-2xl font-semibold tabular-nums sm:text-3xl print:text-xl">
            {href ? (
              <a href={href} className="underline decoration-muted/50 decoration-1 underline-offset-[6px] hover:decoration-brand print:no-underline">
                {n}
              </a>
            ) : (
              n
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One report row, ready to show. */
function toLine(r: ReportRow, tz: string, multiDay: boolean): ReportLine {
  const name = r.name_needs_check && r.typed_name ? r.typed_name : r.last_name ? `${r.last_name}, ${r.first_name}` : r.first_name;
  const visiting = r.children.map((c) => `${c.name} (${c.grade}, ${c.teacher})`).join("; ");
  let checkedIn: ReportLine["checkedIn"] = null;
  if (r.status === "checked_in" && r.checked_in_at) {
    const time = formatTime(r.checked_in_at, tz);
    checkedIn = { at: multiDay ? `${formatDate(utcToZonedDate(r.checked_in_at, tz), { year: undefined })}, ${time}` : time, by: r.checked_in_by_name };
  }
  return {
    id: r.adult_id,
    name,
    search: [r.full_name, r.typed_name ?? "", r.registered_by, ...r.children.flatMap((c) => [c.name, c.teacher])].join(" ").toLowerCase(),
    visiting,
    status: r.status,
    checkedIn,
  };
}

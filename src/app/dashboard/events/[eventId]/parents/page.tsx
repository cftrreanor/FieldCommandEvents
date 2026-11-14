import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { getEventAccess, getOrigin } from "@/lib/data";
import { hasParents } from "@/lib/event-types";
import { formatPhone } from "@/lib/phone";
import { ADULTS, closesAtLabel, parentRegistrationClosed, sortedAdults, type Child } from "@/lib/parents";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateRange, utcToZonedDate, utcToZonedTime, zoneName } from "@/lib/time";
import { ActionButton, CopyLinkButton } from "../forms";
import { saveParentSettings, setParentRegistrationOpen } from "./actions";
import { FamiliesList, type ListedFamily } from "./families-list";
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
  const [{ data }, { data: emailRows }] = await Promise.all([
    supabase.from("parent_registrations").select(`id, parent_name, phone, children, created_at, ${ADULTS}`).eq("event_id", eventId).order("parent_name"),
    // Email addresses come only from this Host/Co-host function (never readable from the table).
    supabase.rpc("parent_registration_emails", { p_event: eventId }),
  ]);
  const emails = new Map(((emailRows ?? []) as { registration_id: string; email: string }[]).map((e) => [e.registration_id, e.email]));
  const tz = event.timezone;
  const families: ListedFamily[] = (data ?? []).map((r) => ({
    id: r.id,
    adults: sortedAdults(r.adults).map((a) => a.full_name),
    children: (r.children ?? []) as Child[],
    email: emails.get(r.id) ?? "",
    phone: r.phone ? formatPhone(r.phone) : null,
    registeredOn: utcToZonedDate(r.created_at, tz),
  }));
  const childCount = families.reduce((n, f) => n + f.children.length, 0);
  const adultCount = families.reduce((n, f) => n + f.adults.length, 0);

  const today = utcToZonedDate(new Date().toISOString(), tz);
  const over = today > event.ends_on;
  const isEventDay = today >= event.starts_on && !over;
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

      {/* On the day, the door comes first. */}
      {isEventDay && (
        <Card className="mt-6 flex flex-wrap items-center justify-between gap-3 border-brand p-4">
          <p className="text-sm leading-6">
            <span className="font-semibold">It&apos;s the day of the event.</span> Check parents in at the door, after their photo ID.
          </p>
          <Link
            href={`${base}/check-in`}
            className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand-hover"
          >
            Open check-in
          </Link>
        </Card>
      )}

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
              <h2 className="text-lg font-semibold">Registered families ({families.length})</h2>
              <p className="mt-1 mb-4 text-sm text-muted">
                Everyone who registered or was imported. Check them in at the door from{" "}
                <Link href={`${base}/check-in`} className="font-medium text-brand underline-offset-4 hover:underline">
                  Check-in
                </Link>{" "}
                on the day.
              </p>
              <FamiliesList families={families} downloadHref={`${base}/download?list=class`} />
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

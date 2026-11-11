import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { Card, Select } from "@/components/ui";
import { NumberInput } from "@/components/number-input";
import { loadBadges, loadBrand, type Badge, type BadgeRow } from "@/lib/badges";
import { getEventAccess, getOrigin } from "@/lib/data";
import { FILES_BUCKET } from "@/lib/event-files";
import { RECORDS_NOTE } from "@/lib/records";
import { missing } from "@/lib/schema-check";
import { loadEventBrand } from "@/lib/event-brand";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { eachDate, formatDate, formatDateRange } from "@/lib/time";
import { BadgeColorScope, PrintBadgesButton } from "./badge-controls";
import { MapBack } from "./map-back";
import { LineIcon } from "@/components/line-icon";
import { volunteerAreaName } from "@/lib/event-types";

export const metadata: Metadata = { title: "Volunteer badges" };

// The schedule lines that fit on a 4 × 6 badge; the rest are counted.
const MAX_ROWS = 5;
const MAX_BLANKS = 50;

type Paper = "letter" | "card";

/**
 * Volunteer badges for lanyard holders, 4 × 6 inches: the account's logo,
 * the person's name, VOLUNTEER, their whole schedule (Station Lead on the
 * stations they lead), and the public event page's QR code. Printed two to
 * a letter sheet with cut lines, or one per 4 × 6 card, with an optional map
 * on the back. Hosts and Volunteer Leads.
 */
export default async function BadgesPage({ params, searchParams }: PageProps<"/dashboard/events/[eventId]/volunteering/badges">) {
  const { eventId } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const access = await getEventAccess(eventId);
  if (!access.canManage) redirect(`/dashboard/events/${eventId}`);
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, name, slug, status, organization_id, timezone, starts_on, ends_on, event_type")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) missing();

  const days = eachDate(event.starts_on, event.ends_on);
  const station = one(sp.station);
  const day = days.includes(one(sp.day)) ? one(sp.day) : "";
  const blanks = Math.min(MAX_BLANKS, Math.max(0, Number.parseInt(one(sp.blanks), 10) || 0));
  const paper: Paper = one(sp.paper) === "card" ? "card" : "letter";
  const backId = one(sp.back);

  const admin = createAdminClient();
  const publicUrl = `${await getOrigin()}/e/${event.slug}`;
  const [badges, { logo, color: brandColor }, qr, { data: stationData }, { data: fileData }] = await Promise.all([
    loadBadges(eventId, event.timezone, days.length > 1, { station: station || undefined, day: day || undefined }),
    // The event can switch the account's logo and color off (Edit event details).
    loadEventBrand(event.slug).then((b) => (b.logoPath || b.color ? loadBrand(event.organization_id) : { logo: null, color: null })),
    QRCode.toString(publicUrl, { type: "svg", margin: 0 }),
    supabase.from("stations").select("id, name").eq("event_id", eventId).order("sort_order").order("created_at"),
    // Maps for the back: what the team can see (hosts see every file).
    admin.from("event_files").select("id, label, path, content_type, audiences").eq("event_id", eventId).order("created_at"),
  ]);
  const maps = ((fileData ?? []) as { id: string; label: string; path: string; content_type: string; audiences: string[] }[]).filter(
    (f) => access.isHost || f.audiences.some((a) => a === "team" || a === "volunteers" || a === "public"),
  );
  const back = maps.find((m) => m.id === backId);
  const backUrl = back ? (await admin.storage.from(FILES_BUCKET).createSignedUrl(back.path, 60 * 30)).data?.signedUrl : undefined;

  // Nobody signed up at all (not just none matching the choices): said up front, since there's nothing to print yet.
  const nobody = badges.length === 0 && (station || day ? (await loadBadges(eventId, event.timezone, days.length > 1, {})).length === 0 : true);
  const cards: (Badge | null)[] = [...badges, ...Array.from({ length: blanks }, () => null)];
  const perSheet = paper === "letter" ? 2 : 1;
  const sheets: (Badge | null)[][] = [];
  for (let i = 0; i < cards.length; i += perSheet) sheets.push(cards.slice(i, i + perSheet));
  const dates = formatDateRange(event.starts_on, event.ends_on);
  const field = "mt-1 w-full";

  return (
    <div className="badge-page">
      {/* Paper size and margins for the printer; everything but the sheets is hidden on paper. */}
      <style>{`
        @page { size: ${paper === "letter" ? "8.5in 11in" : "4in 6in"}; margin: 0; }
        @media print {
          main { padding: 0 !important; margin: 0 !important; max-width: none !important; }
          [data-print-note] { display: none !important; }
          .badge-preview { background: none !important; padding: 0 !important; margin: 0 !important; overflow: visible !important; }
          .badge-sheet { box-shadow: none !important; margin: 0 !important; break-after: page; }
        }
      `}</style>

      <div className="print:hidden">
        <Link href={`/dashboard/events/${eventId}/volunteering`} className="text-sm text-muted hover:text-foreground">
          ← Back to {volunteerAreaName(event.event_type)}
        </Link>
        <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Volunteer badges</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Create and print out badges for lanyard holders, with each volunteer&apos;s schedule. Under-18 volunteers show a first name and
          last initial only.
        </p>
        {nobody && (
          <p role="note" className="mt-4 flex max-w-2xl gap-2 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm leading-6">
            <LineIcon name="warning" className="mt-0.5 size-5 text-warning" />
            <span>
              <strong>No one has signed up yet, so there are no badges to print.</strong> Badges fill in as people sign up. To print some
              now, add blank badges for walk-ups below.
            </span>
          </p>
        )}

        <Card className="mt-6 space-y-6">
          <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" method="get">
            <label className="text-sm font-semibold">
              Who
              <Select name="station" defaultValue={station} className={field}>
                <option value="">Every volunteer</option>
                {(stationData ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </label>
            {days.length > 1 && (
              <label className="text-sm font-semibold">
                Day
                <Select name="day" defaultValue={day} className={field}>
                  <option value="">Every day</option>
                  {days.map((d) => (
                    <option key={d} value={d}>
                      {formatDate(d, { year: undefined })}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <label className="text-sm font-semibold">
              Blank badges for walk-ups
              <NumberInput name="blanks" defaultValue={blanks ? String(blanks) : ""} placeholder="0" maxLength={2} className={field} />
            </label>
            <label className="text-sm font-semibold">
              Paper
              <Select name="paper" defaultValue={paper} className={field}>
                <option value="letter">Letter, 2 per sheet</option>
                <option value="card">4 × 6 cards</option>
              </Select>
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Map on the back
              <Select name="back" defaultValue={back?.id ?? ""} className={field}>
                <option value="">No back (one-sided)</option>
                {maps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.content_type === "application/pdf" ? " (first page of the PDF)" : ""}
                  </option>
                ))}
              </Select>
              <span className="mt-1 block text-xs font-normal text-muted">
                {maps.length ? "From this event's Maps and documents." : "Upload a map in Maps and documents in Event settings to print it on the back."}
              </span>
            </label>
            <div className="flex items-end sm:col-span-2">
              <button type="submit" className="inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand">
                Update preview
              </button>
            </div>
          </form>

          {/* Uploads all live in Maps and documents on Edit details: the logo and the maps. */}
          {access.isHost && (
            <p className="border-t border-border pt-5 text-sm text-muted">
              {logo ? "Your logo is on the badges." : "Badges show the event name at the top until you add your logo."}{" "}
              <Link href={`/dashboard/events/${eventId}/edit?section=details#logo`} className="font-medium text-brand underline">
                {logo ? "Change the logo or add maps" : "Add your logo or maps"}
              </Link>{" "}
              in Maps and documents.
            </p>
          )}

          <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm leading-6">
              <p className="font-semibold">
                {badges.length} {badges.length === 1 ? "badge" : "badges"}
                {blanks > 0 && ` and ${blanks} blank`} · {sheets.length} {paper === "letter" ? (sheets.length === 1 ? "sheet" : "sheets") : sheets.length === 1 ? "card" : "cards"}
              </p>
              <p className="text-muted">
                {back
                  ? `Print double-sided${paper === "letter" ? ", flipping on the long edge" : ""}, at actual size (100%).`
                  : "Print at actual size (100%), not “fit to page.”"}
                {event.status !== "published" && " The QR code opens your public event page once the event is published."}
              </p>
            </div>
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <PrintBadgesButton disabled={cards.length === 0} />
              {cards.length === 0 && <p className="text-sm text-muted">{nobody ? "Nothing to print until someone signs up" : "No badges match these choices"}</p>}
            </div>
          </div>
          <p className="text-xs leading-5 text-muted">{RECORDS_NOTE}</p>
        </Card>

        {cards.length === 0 && !nobody && (
          <p className="mt-6 text-muted">No volunteers match. Choose another sign-up or day, or add blank badges for walk-ups.</p>
        )}
      </div>

      {/* The sheets: a preview on screen, the printout on paper. Fronts and backs alternate for double-sided printing. */}
      {cards.length > 0 && (
        <BadgeColorScope logo={logo} color={brandColor} className="badge-preview mt-6 -mx-4 overflow-x-auto bg-border/40 px-4 py-6 sm:mx-0 sm:rounded-lg">
          {sheets.map((sheet, i) => (
            <div key={i}>
              <Sheet paper={paper}>
                {sheet.map((b, j) => (
                  <BadgeFront key={b?.key ?? `blank-${i}-${j}`} badge={b} logo={logo} eventName={event.name} dates={dates} qr={qr} cut={paper === "letter"} />
                ))}
              </Sheet>
              {back && backUrl && (
                <Sheet paper={paper}>
                  {/* Same map in every spot, so it lines up whichever way the printer flips the page. */}
                  {Array.from({ length: perSheet }, (_, j) => (
                    <div key={j} className={`relative h-[6in] w-[4in] overflow-hidden bg-white ${paper === "letter" ? "outline outline-1 outline-dashed outline-[#b5b0aa]" : ""}`}>
                      <MapBack url={backUrl} pdf={back.content_type === "application/pdf"} label={back.label} />
                    </div>
                  ))}
                </Sheet>
              )}
            </div>
          ))}
        </BadgeColorScope>
      )}
    </div>
  );
}

/** One printed page: letter with two badges side by side, or a single 4 × 6 card. */
function Sheet({ paper, children }: { paper: Paper; children: React.ReactNode }) {
  return paper === "letter" ? (
    <div className="badge-sheet mx-auto mb-6 flex h-[11in] w-[8.5in] shrink-0 items-start justify-center bg-white pt-[0.5in] shadow-card">{children}</div>
  ) : (
    <div className="badge-sheet mx-auto mb-6 flex h-[6in] w-[4in] shrink-0 bg-white shadow-card">{children}</div>
  );
}

function BadgeFront({
  badge,
  logo,
  eventName,
  dates,
  qr,
  cut,
}: {
  badge: Badge | null;
  logo: string | null;
  eventName: string;
  dates: string;
  qr: string;
  cut: boolean;
}) {
  const rows = badge?.rows ?? [];
  const shown = rows.slice(0, MAX_ROWS);
  const more = rows.length - shown.length;
  return (
    <div
      className={`flex h-[6in] w-[4in] flex-col bg-white px-[0.3in] pt-[0.45in] pb-[0.25in] text-[#1a1a1a] ${cut ? "outline outline-1 outline-dashed outline-[#b5b0aa]" : ""}`}
    >
      {/* Logo, or the event name. */}
      <div className="flex h-[0.8in] items-center justify-center">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="max-h-full max-w-[2.8in] object-contain" />
        ) : (
          <p className="text-center text-[15pt] leading-tight font-semibold">{eventName}</p>
        )}
      </div>

      {/* Name. */}
      <div className="mt-[0.12in] flex h-[1.2in] flex-col items-center justify-center text-center">
        {badge ? (
          <>
            {/* Line heights leave room for the tails of g, j, p, q, and y. */}
            <p className="max-w-full truncate pb-[0.04in] text-[36pt] leading-[1.15] font-bold">{badge.first}</p>
            {badge.last && <p className="mt-[0.02in] max-w-full truncate pb-[0.02in] text-[16pt] leading-[1.3]">{badge.last}</p>}
          </>
        ) : (
          <div className="w-full border-b-2 border-[#1a1a1a] pt-[0.6in]" aria-label="Write a name here" />
        )}
      </div>

      {/* The role. */}
      <p
        className="-mx-[0.3in] mt-[0.12in] py-[0.07in] text-center text-[20pt] font-bold tracking-[0.18em] text-white"
        style={{ backgroundColor: "var(--badge-band, #0b3558)", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
      >
        VOLUNTEER
      </p>

      {/* Schedule. */}
      <div className="mt-[0.14in] min-h-0 flex-1">
        {badge ? (
          <>
            <p className="text-[8pt] font-semibold tracking-wide text-[#5f5c59] uppercase">My schedule</p>
            <ul className="mt-[0.04in] space-y-[0.05in]">
              {shown.map((r) => (
                <ScheduleRow key={r.key} row={r} />
              ))}
            </ul>
            {more > 0 && <p className="mt-[0.04in] text-[8.5pt] text-[#5f5c59]">+{more} more {more === 1 ? "shift" : "shifts"}</p>}
          </>
        ) : (
          <>
            <p className="text-[8pt] font-semibold tracking-wide text-[#5f5c59] uppercase">My schedule</p>
            {[0, 1, 2].map((n) => (
              <div key={n} className="mt-[0.28in] border-b border-[#8a8580]" />
            ))}
          </>
        )}
      </div>

      {/* Event and the public page's QR code. */}
      <div className="flex items-end justify-between gap-3 border-t border-[#d8d4cf] pt-[0.1in]">
        <div className="min-w-0 text-[8.5pt] leading-snug">
          <p className="font-semibold">{eventName}</p>
          <p className="text-[#5f5c59]">{dates}</p>
          <p className="mt-[0.04in] text-[#5f5c59]">Questions? Scan for event info</p>
        </div>
        <div className="size-[0.8in] shrink-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
      </div>
    </div>
  );
}

function ScheduleRow({ row }: { row: BadgeRow }) {
  return (
    <li className="text-[9.5pt] leading-tight">
      {row.when && <span className="font-semibold">{row.when} · </span>}
      <span className={row.when ? "" : "font-semibold"}>{row.station}</span>
      {row.place && <span className="text-[#5f5c59]"> · {row.place}</span>}
      {row.lead && (
        <span
          className="ml-1 inline-block rounded-sm bg-[#1a1a1a] px-[0.05in] align-[1px] text-[7pt] font-bold tracking-wide text-white"
          style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
        >
          COORDINATOR
        </span>
      )}
    </li>
  );
}

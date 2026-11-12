import type { Metadata } from "next";
import { FileLinks } from "@/components/file-links";
import { filesFor } from "@/lib/event-files";
import { EventHeaderBar, EventHeading } from "@/components/event-brand";
import { loadEventBrand } from "@/lib/event-brand";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment } from "react";
import { Badge, Card } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { opensLater, registrationIsOpen } from "@/lib/bands";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateRange, formatTime, formatTimeRange, utcToZonedDate, zoneAbbreviation, zoneName } from "@/lib/time";
import { readPass } from "@/lib/volunteer-pass";
import { groupWords, hasBands, hasBooths, hasConferences, hasParents, hasRooms } from "@/lib/event-types";
import { FestivalPublic } from "./festival-public";
import { closesAtLabel, parentRegistrationClosed } from "@/lib/parents";
import { ScheduleUpdateBanner } from "@/components/schedule-update-banner";
import { EventBannerSlot } from "@/components/event-banner-slot";
import { AutoRefresh } from "@/components/auto-refresh";
import { FairBooths, boothHosts, type PublicBooth } from "./fair-booths";
import { PresentedBy, SponsorLiveLine, SponsorThanks, partnersNotSponsors } from "./public-sponsors";
import { isSponsorKind, type PublicSponsor } from "@/lib/sponsors";
import { loadPublicSponsors } from "@/lib/sponsors-data";
import { LineIcon } from "@/components/line-icon";

type Params = { params: Promise<{ slug: string }> };

type ScheduleRow = {
  performance_order: number;
  perform_at: string | null;
  school_name: string;
  band_name: string;
  classification: string;
};
type FinalsRow = {
  slot_number: number;
  perform_at: string | null;
  school_name: string | null;
  band_name: string | null;
  classification: string | null;
};
type BreakRow = { starts_at: string; minutes: number; label: string };
/** One line of the public schedule, prelims or finals. */
type Line = {
  key: string;
  number: string;
  perform_at: string | null;
  title: string;
  subtitle: string | null;
  /** From the gate's taps on contest day (public_progress). */
  live?: { at_gate: boolean; performed: boolean; scratched: boolean };
};
type ProgressRow = { round: "prelims" | "finals"; number: number; at_gate: boolean; performed: boolean; scratched: boolean };

async function loadEvent(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("id, name, status, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_name, venue_address, venue_place_id, public_notes, volunteer_signup_open, band_registration_open, band_registration_deadline, band_registration_opens_on, performance_order_published, finals_published, schedule_updated_at, parent_registration_open, parent_registration_closes_at, parent_walk_ins_allowed")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const event = await loadEvent((await params).slug);
  return { title: event?.name ?? "Event" };
}

/**
 * Who just performed and who's up next, from the gate's taps. Falls back to
 * the clock when the gate isn't tapping bands through (no taps yet).
 */
function liveNowAndNext(rows: Line[]) {
  const live = rows.some((r) => r.live?.performed || r.live?.at_gate);
  if (!live) return { ...nowAndNext(rows), live: false as const };
  const lastDone = rows.findLastIndex((r) => r.live?.performed);
  const next = rows.slice(lastDone + 1).find((r) => !r.live?.performed && !r.live?.scratched) ?? null;
  return { current: lastDone >= 0 ? rows[lastDone] : null, next, live: true as const };
}

/** Which band is on now and who's next, from the clock. */
function nowAndNext(rows: Line[]) {
  const now = Date.now();
  const timed = rows.filter((r) => r.perform_at);
  const started = timed.filter((r) => new Date(r.perform_at!).getTime() <= now);
  const current = started.at(-1) ?? null;
  const upcoming = timed.filter((r) => new Date(r.perform_at!).getTime() > now);
  return { current, next: upcoming[0] ?? null };
}

export default async function EventPublicPage({ params }: Params) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) missing();
  // A parent-teacher conference's page is its booking page.
  if (hasConferences(event.event_type)) redirect(`/e/${slug}/book`);

  // Volunteering isn't advertised to the public: hosts share the volunteer link
  // directly. People who already signed up (on this device, or with the
  // account they're signed in with) get a shortcut to their shifts.
  const isVolunteer = await volunteersHere(slug, event.id);

  const supabase = await createClient();
  // Festivals have their own section (festival-public.tsx): no band contest calls (speed).
  const roomsHere = hasRooms(event.event_type);
  const none = Promise.resolve({ data: [] as unknown[] });
  // Sponsors load here and only here (never the layout, shared headers, metadata, other pages, or emails).
  const sponsorKind = isSponsorKind(event.event_type) ? event.event_type : null;
  const [{ data: scheduleData }, { data: finalsData }, { data: breakData }, { data: progressData }, { data: boothData }, sponsors] = await Promise.all([
    roomsHere ? none : supabase.rpc("public_schedule", { p_slug: slug }),
    roomsHere ? none : supabase.rpc("public_finals", { p_slug: slug }),
    roomsHere ? none : supabase.rpc("public_breaks", { p_slug: slug }),
    roomsHere ? none : supabase.rpc("public_progress", { p_slug: slug }),
    hasBooths(event.event_type) && event.status === "published" ? supabase.rpc("public_fair_booths", { p_slug: slug }) : none,
    sponsorKind ? loadPublicSponsors(slug) : Promise.resolve([] as PublicSponsor[]),
  ]);
  const booths = (boothData ?? []) as PublicBooth[];
  const progress = (progressData ?? []) as ProgressRow[];
  const liveOf = (round: ProgressRow["round"], n: number) => {
    const p = progress.find((x) => x.round === round && x.number === n);
    return p ? { at_gate: p.at_gate, performed: p.performed, scratched: p.scratched } : undefined;
  };
  const schedule: Line[] = ((scheduleData ?? []) as ScheduleRow[]).map((r) => ({
    key: `p${r.performance_order}`,
    number: String(r.performance_order),
    perform_at: r.perform_at,
    title: r.band_name,
    subtitle: `${r.school_name} · ${r.classification}`,
    live: liveOf("prelims", r.performance_order),
  }));
  const finals: Line[] = ((finalsData ?? []) as FinalsRow[]).map((r) => ({
    key: `f${r.slot_number}`,
    number: `F${r.slot_number}`,
    perform_at: r.perform_at,
    title: r.band_name ?? `Finalist ${r.slot_number}`,
    subtitle: r.band_name ? `${r.school_name} · ${r.classification}` : "To be announced",
    live: liveOf("finals", r.slot_number),
  }));
  const breaks = (breakData ?? []) as BreakRow[];
  const files = event.status === "published" ? await filesFor([event.id], ["public"], () => event.timezone) : [];
  const bandsHere = hasBands(event.event_type);
  const words = groupWords(event.event_type);
  // Festivals show their own "Group directors" card.
  const bandsOpen = hasBands(event.event_type) && registrationIsOpen(event);
  // Registration set to open on a later day: directors see when.
  const bandsLater = hasBands(event.event_type) && event.band_registration_open && opensLater(event) ? event.band_registration_opens_on : null;
  const tz = event.timezone;
  const isEventDay = utcToZonedDate(new Date().toISOString(), tz) >= event.starts_on && utcToZonedDate(new Date().toISOString(), tz) <= event.ends_on;
  // On fair day, volunteers who show up are added at the desk, not online.
  const fairDay = hasBooths(event.event_type) && isEventDay;
  // A volunteer event's page is mostly about signing up.
  const signUp = !bandsHere && event.volunteer_signup_open && !isVolunteer && !fairDay;
  const parentsClosed = hasParents(event.event_type) ? parentRegistrationClosed(event) : "draft";
  const parentsOpen = hasParents(event.event_type) && !parentsClosed;
  // Registration has closed, but parents who didn't register can still come with an ID.
  const parentWalkIns = (parentsClosed === "closed" || parentsClosed === "deadline") && event.parent_walk_ins_allowed;
  const { current, next, live } = liveNowAndNext([...schedule, ...finals]);
  const multiDay = event.starts_on !== event.ends_on;
  const mapUrl = `https://www.google.com/maps/search/?${new URLSearchParams({
    api: "1",
    query: event.venue_address,
    ...(event.venue_place_id ? { query_place_id: event.venue_place_id } : {}),
  })}`;
  const at = (iso: string) =>
    `${multiDay ? `${formatDate(utcToZonedDate(iso, tz), { year: undefined })} · ` : ""}${formatTime(iso, tz)}`;

  // With the account's color, the event name sits on a full-width band of it.
  const band = !!(await loadEventBrand(slug)).color;
  const published = event.status === "published";
  // On the day, one sponsor line ends the live part, and the thank-you section gets a way back up to it. Both end
  // with the day (in the event's time zone, on every day of a multi-day event).
  const festivalDay = roomsHere && isEventDay && event.performance_order_published;
  const liveAt =
    !sponsors.length || !published || !isEventDay
      ? null
      : bandsHere && (schedule.length > 0 || finals.length > 0)
        ? "schedule"
        : festivalDay
          ? "happening-now"
          : fairDay && booths.length > 0
            ? "whats-at-the-event"
            : null;
  // The same place on every kind: after the live list and the volunteer card. On a fair it follows the zone list,
  // set apart by a rule so it doesn't read as one of the zones.
  const liveLine = liveAt ? (
    <SponsorLiveLine sponsors={sponsors} className={liveAt === "whats-at-the-event" ? "mt-8 border-t border-border pt-4" : "mt-6"} />
  ) : null;
  // Fairs: one section for sponsors and the booths' community partners (a business that's both shows once).
  const partners = sponsors.length && hasBooths(event.event_type) ? partnersNotSponsors(boothHosts(booths), sponsors) : [];
  const heading = (
    <EventHeading band={band} title={event.name}>
      <PresentedBy slug={slug} sponsors={sponsors} />
      <p className="mt-2 text-muted">
        {event.starts_on === event.ends_on && event.window_start && event.window_end
          ? `${formatDate(event.starts_on)} · ${formatTimeRange(event.window_start, event.window_end, tz)}`
          : formatDateRange(event.starts_on, event.ends_on)}
      </p>
      {isEventDay && <AutoRefresh status className="mt-1" />}
      {event.venue_address && (
        <p className="mt-1 text-muted">
          {[event.venue_name, event.venue_address].filter(Boolean).join(" · ")} ·{" "}
          <a href={mapUrl} target="_blank" rel="noreferrer" className="font-medium text-brand underline-offset-4 hover:underline">
            Directions
          </a>
        </p>
      )}
      {event.public_notes && <p className="mt-4 leading-7">{event.public_notes}</p>}
    </EventHeading>
  );

  const maps = (
    <>
      {files.length > 0 && (
        <section className="mt-10" aria-labelledby="maps-heading">
          <h2 id="maps-heading" className="text-xl font-semibold">
            Maps &amp; info
          </h2>
          <FileLinks files={files} className="mt-3" />
        </section>
      )}
    </>
  );
  const cards = (
    <>
      {(isVolunteer || bandsOpen || bandsLater || signUp || parentsOpen || parentWalkIns) && event.status === "published" && (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {parentWalkIns && (
            <Link href={`/e/${slug}/parents`} className="block">
              <Card className="h-full border-brand transition hover:bg-brand-soft">
                <p className="font-semibold text-brand">Parents: you can still attend</p>
                <p className="mt-1 text-sm text-muted">
                  Registration is closed, but you can come during the event with a valid government-issued photo ID.
                </p>
              </Card>
            </Link>
          )}
          {parentsOpen && (
            <Link href={`/e/${slug}/parents`} className="block">
              <Card className="h-full border-brand transition hover:bg-brand-soft">
                <p className="font-semibold text-brand">Parents: register to attend</p>
                <p className="mt-1 text-sm text-muted">
                  {isEventDay ? "Register now, then bring your photo ID to the door" : "Register before you come"}
                  {event.parent_registration_closes_at ? ` (closes ${closesAtLabel(event.parent_registration_closes_at, event.timezone)})` : ""}
                  {isEventDay ? "." : ", and bring a government-issued photo ID."}
                </p>
              </Card>
            </Link>
          )}
          {signUp && (
            <Link href={`/e/${slug}/volunteer`} className="block">
              <Card className="h-full border-brand transition hover:bg-brand-soft">
                <p className="font-semibold text-brand">Sign up to volunteer</p>
                <p className="mt-1 text-sm text-muted">Pick a shift that works for you. It takes about a minute.</p>
              </Card>
            </Link>
          )}
          {isVolunteer && (
            <Link href="/my" className="block">
              <Card className="h-full transition hover:border-brand">
                <p className="font-semibold">Your volunteer shifts</p>
                <p className="mt-1 text-sm text-muted">
                  {event.volunteer_signup_open && !fairDay ? "See your shifts, or sign up for more." : "See your shifts and who to report to."}
                </p>
              </Card>
            </Link>
          )}
          {bandsLater && (
            <Card className="h-full">
              <p className="font-semibold">{words.One} directors</p>
              <p className="mt-1 text-sm text-muted">Registration opens on {formatDate(bandsLater)}.</p>
            </Card>
          )}
          {bandsOpen && (
            <Link href={`/e/${slug}/bands`} className="block">
              <Card className="h-full transition hover:border-brand">
                <p className="font-semibold">{words.One} directors</p>
                <p className="mt-1 text-sm text-muted">
                  {roomsHere ? "Register your group for this festival." : "Register your ensemble for this contest."}
                </p>
              </Card>
            </Link>
          )}
        </div>
      )}
    </>
  );

  return (
    <>
    <EventHeaderBar slug={slug} />
    {band && heading}
    {(bandsHere || roomsHere) && event.status === "published" && <ScheduleUpdateBanner slug={slug} version={event.schedule_updated_at} />}
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-12">
      {event.status !== "published" && (
        <Card className="mt-6 bg-brand-soft">
          <p className="text-sm">Preview: this page isn&apos;t public yet. Only your team can see it.</p>
        </Card>
      )}

      {!band && heading}

      <EventBannerSlot eventId={event.id} audience="public" tz={tz} className="mt-6" />

      {/* A fair's attraction list is long: point volunteers to the sign-up first. */}
      {hasBooths(event.event_type) && signUp && event.status === "published" && (
        <p className="mt-6 rounded-lg border border-brand bg-brand-soft px-4 py-3 text-sm">
          <span className="font-semibold">Volunteers needed</span> ·{" "}
          <Link href={`/e/${slug}/volunteer`} className="font-semibold text-brand underline">
            Sign up for a shift
          </Link>
        </p>
      )}

      {hasBooths(event.event_type) && published && (
        <FairBooths booths={booths} partnersThanked={sponsors.length > 0} after={liveAt === "whats-at-the-event" && liveLine} />
      )}

      {!festivalDay && cards}

      {!festivalDay && maps}

      {roomsHere && event.status === "published" && <FestivalPublic slug={slug} event={event} />}

      {/* A festival on its day leads with Happening now and Find a group; the volunteer card comes after, then the day's sponsor line. */}
      {festivalDay && cards}
      {liveAt === "happening-now" && liveLine}
      {festivalDay && maps}

      {bandsHere && (
      <section id="schedule" className="mt-10 scroll-mt-6">
        <h2 className="text-xl font-semibold">Performance schedule</h2>
        {schedule.length === 0 && finals.length === 0 ? (
          <p className="mt-2 text-muted">The performance order hasn&apos;t been posted yet. Check back soon.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">
              All times {zoneName(tz)} (
              {zoneAbbreviation([...schedule, ...finals].find((r) => r.perform_at)?.perform_at ?? new Date().toISOString(), tz)})
              {isEventDay && " · updates automatically"}
            </p>
            {isEventDay && (current || next) && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {current && (
                  <Card className="border-brand">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">{live ? "Just performed" : "On the field"}</p>
                    <p className="mt-1 text-lg font-semibold">{current.title}</p>
                    <p className="text-sm text-muted">{current.subtitle}</p>
                  </Card>
                )}
                {next && (
                  <Card>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Up next{next.live?.at_gate ? " · at the gate" : next.perform_at ? ` · ${formatTime(next.perform_at, tz)}` : ""}
                    </p>
                    <p className="mt-1 text-lg font-semibold">{next.title}</p>
                    <p className="text-sm text-muted">{next.subtitle}</p>
                  </Card>
                )}
              </div>
            )}
            {schedule.length > 0 && finals.length > 0 && <h3 className="mt-8 text-lg font-semibold">Preliminaries</h3>}
            {schedule.length > 0 && (
              <ScheduleList lines={schedule} breaks={breaks} currentKey={isEventDay ? (live ? next?.key : current?.key) : undefined} currentLabel={live ? "Up next" : "Now"} at={at} />
            )}
            {finals.length > 0 && (
              <>
                <h3 className="mt-8 text-lg font-semibold"><LineIcon name="trophy" inline />Finals</h3>
                <ScheduleList lines={finals} breaks={breaks} currentKey={isEventDay ? (live ? next?.key : current?.key) : undefined} currentLabel={live ? "Up next" : "Now"} at={at} />
              </>
            )}
            {liveAt === "schedule" && liveLine}
          </>
        )}
      </section>
      )}

      {sponsorKind && (
        <SponsorThanks slug={slug} kind={sponsorKind} sponsors={sponsors} eventName={event.name} partners={partners} backTo={liveAt ?? undefined} />
      )}
    </main>
    </>
  );
}

/** Numbered schedule rows, with any break that falls between two performances. */
function ScheduleList({
  lines,
  breaks,
  currentKey,
  currentLabel,
  at,
}: {
  lines: Line[];
  breaks: BreakRow[];
  currentKey: string | undefined;
  currentLabel: string;
  at: (iso: string) => string;
}) {
  return (
    <ol className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
      {lines.map((r, i) => {
        const prev = lines[i - 1]?.perform_at;
        const between =
          prev && r.perform_at ? breaks.filter((b) => b.starts_at >= prev && b.starts_at < r.perform_at!) : [];
        const isCurrent = currentKey === r.key;
        return (
          <Fragment key={r.key}>
            {between.map((b) => (
              <li key={b.starts_at} className="flex items-center gap-3 bg-background px-4 py-2 text-sm text-muted">
                <span aria-hidden className="flex w-8 shrink-0 justify-center"><LineIcon name="coffee" className="size-5" /></span>
                <span className="flex-1 font-medium">{b.label}</span>
                <span className="shrink-0 tabular-nums">
                  {at(b.starts_at)} · {b.minutes} min
                </span>
              </li>
            ))}
            <li className={`flex items-center gap-3 px-4 py-3 ${isCurrent ? "bg-brand-soft" : ""}`}>
              <span className="w-8 shrink-0 text-center text-sm font-semibold text-muted">{r.number}</span>
              <div className="min-w-0 flex-1">
                <p className={`truncate font-medium ${r.live?.scratched ? "text-muted line-through" : ""}`}>{r.title}</p>
                {r.subtitle && <p className="truncate text-sm text-muted">{r.subtitle}</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-medium tabular-nums">{r.perform_at ? at(r.perform_at) : "TBA"}</p>
                {isCurrent && <Badge tone="brand">{currentLabel}</Badge>}
                {r.live?.scratched ? (
                  <p className="text-xs text-muted">Withdrawn</p>
                ) : (
                  r.live?.performed && <p className="text-xs font-medium text-success">✓ Performed</p>
                )}
              </div>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

/** Has this visitor volunteered for this event, from this device or with their account? */
async function volunteersHere(slug: string, eventId: string) {
  if ((await readPass()).e.includes(slug)) return true;
  const user = await getUser();
  if (!user?.email) return false;
  const { count } = await (await createClient())
    .from("volunteers")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("email", user.email);
  return Boolean(count);
}

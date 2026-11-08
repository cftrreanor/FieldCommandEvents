import type { Metadata } from "next";
import { SuccessToast } from "@/components/toaster";
import { FileLinks } from "@/components/file-links";
import { filesFor } from "@/lib/event-files";
import Link from "next/link";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { ScheduleUpdateBanner } from "@/components/schedule-update-banner";
import { Badge, Card } from "@/components/ui";
import { bandCalendarEvent, groupCalendarEvent, type BandTimes } from "@/lib/band-calendar";
import { BAND_COLUMNS, readyAt, registrationIsOpen, warmUpEndAt, type BandRow } from "@/lib/bands";
import { getOrigin } from "@/lib/data";
import { googleCalendarUrl } from "@/lib/ics";
import { formatPhone } from "@/lib/phone";
import { CONTEST_INFO_COOKIE } from "@/lib/preferences";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateRange, formatTime, utcToZonedDate, zoneAbbreviation } from "@/lib/time";
import { AutoRefresh } from "@/components/auto-refresh";
import { eventPhase, type BandDay } from "@/lib/contest-day";
import { hasRooms } from "@/lib/event-types";
import { CollapsibleInfo } from "./collapsible-info";
import { DayStatusBanner } from "@/components/day-status";
import { EventBannerSlot } from "@/components/event-banner-slot";
import { dayStatus, groupSteps } from "@/lib/director-day";
import { ContestDayCard, type ProgressRow } from "./contest-day-card";
import { WithdrawBandButton } from "./withdraw-band";
import { withdrawBand } from "@/app/dashboard/band-actions";
import { eventLogoUrl, loadEventBrand } from "@/lib/event-brand";
import { LineIcon } from "@/components/line-icon";
import { loadMealOffer, loadMealOrders } from "@/lib/meals";
import { mealPrice, mealSummary, mealTotal } from "@/lib/meal-price";
import type { IconName } from "@/lib/icons";

export async function generateMetadata({ params }: PageProps<"/dashboard/bands/[bandId]">): Promise<Metadata> {
  const { bandId } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("bands").select("band_name, events(name)").eq("id", bandId).maybeSingle();
  const ev = (data as { band_name: string; events: { name: string } | null } | null)?.events;
  return { title: ev?.name ?? "Registration" };
}

const linkClass = "font-medium text-brand underline-offset-4 hover:underline";

/** A band's page for one contest: when and where to be, then their registration. */
export default async function BandContestPage({ params, searchParams }: PageProps<"/dashboard/bands/[bandId]">) {
  const { bandId } = await params;
  const { registered, saved } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("bands").select(BAND_COLUMNS).eq("id", bandId).maybeSingle();
  const band = data as BandRow | null;
  if (!band) missing();
  // Meals the host provides, and what this band asked for (after the 20270111000000 update).
  const [mealOffer, mealAsk] = await Promise.all([loadMealOffer(supabase, band.event_id), loadMealOrders(supabase, [bandId])]);

  const [{ data: event }, { data: slot }, { data: finalsSlot }, { data: contact }, { data: phone }, cookieStore, { data: day }, { data: progress }] = await Promise.all([
    supabase
      .from("events")
      .select(
        "name, slug, status, event_type, timezone, starts_on, ends_on, venue_name, venue_address, venue_place_id, band_registration_open, band_registration_deadline, band_registration_opens_on, director_info, payment_link, performance_order_published, ready_minutes_before, finals_ready_minutes_before, finals_published, finalists_revealed, schedule_updated_at",
      )
      .eq("id", band.event_id)
      .single(),
    supabase.from("performance_slots").select("performance_order, warm_up_at, warm_up_minutes, perform_at, warm_up_location").eq("band_id", bandId).maybeSingle(),
    supabase.from("finals_slots").select("slot_number, warm_up_at, warm_up_minutes, perform_at, warm_up_location").eq("band_id", bandId).maybeSingle(),
    supabase.from("event_director_contacts").select("name, email, has_phone").eq("event_id", band.event_id).maybeSingle(),
    supabase.rpc("director_contact_phone", { ev: band.event_id }),
    cookies(),
    // Contest day: where the band is along the host's check-in path.
    supabase
      .from("bands")
      .select("id, band_name, bus_count, box_truck_count, truck_trailer_count, semi_truck_count, buses_at, equipment_at, equipment_spot, away_at, left_at, scratched_at")
      .eq("id", bandId)
      .maybeSingle(),
    supabase.rpc("my_band_progress", { p_band_id: bandId }),
  ]);
  if (!event) missing();
  const open = registrationIsOpen(event);
  // Group events: the group's time in each room (readable once posted).
  const group = hasRooms(event.event_type);
  const [{ data: myRooms }, { data: roomData }, { data: checkinData }] = group
    ? await Promise.all([
        supabase.from("room_slots").select("room_id, starts_at, ends_at").eq("band_id", bandId).order("starts_at"),
        supabase.from("rooms").select("id, name, note").eq("event_id", band.event_id),
        // On the day: the team's taps for this group ("Arrived", "Done" per room).
        supabase.from("group_checkins").select("room_id, created_at").eq("band_id", bandId),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const roomById = new Map((roomData ?? []).map((r) => [r.id, r]));
  const tapped = (roomId: string | null) => (checkinData ?? []).find((c) => c.room_id === roomId);
  const arrived = tapped(null);
  const files = await filesFor([band.event_id], ["public", "directors"], () => event.timezone);
  const origin = await getOrigin();
  const mapUrl = `https://www.google.com/maps/search/?${new URLSearchParams({
    api: "1",
    query: event.venue_address,
    ...(event.venue_place_id ? { query_place_id: event.venue_place_id } : {}),
  })}`;
  // Once the contest has finals, the first round is "Preliminaries" everywhere.
  const hasFinals = event.finals_published || event.finalists_revealed;
  // After the band performs in preliminaries, those times fold away.
  const prelimsDone = ((progress ?? []) as ProgressRow[]).some((r) => r.round === "prelims" && r.performed);
  const calendar = (round: "order" | "finals", times: BandTimes) =>
    bandCalendarEvent({
      bandId,
      bandName: band.band_name,
      round,
      hasFinals,
      times,
      event: { ...event, ready_minutes_before: round === "finals" ? event.finals_ready_minutes_before : event.ready_minutes_before },
      url: `${origin}/dashboard/bands/${bandId}`,
    });
  // Festival groups: one calendar entry from the first room to the end of the last.
  const groupCalendar =
    group && event.performance_order_published
      ? groupCalendarEvent({
          bandId,
          bandName: band.band_name,
          stops: (myRooms ?? []).map((s) => ({
            name: roomById.get(s.room_id)?.name ?? "Room",
            note: roomById.get(s.room_id)?.note ?? null,
            starts_at: s.starts_at,
            ends_at: s.ends_at,
          })),
          event,
          url: `${origin}/dashboard/bands/${bandId}`,
        })
      : null;
  const hasContact = contact && (contact.name || contact.has_phone || contact.email);
  const contestDay =
    !group && eventPhase(event, new Date()) === "day" && event.performance_order_published && slot && day && (progress ?? []).length > 0;
  // Group events on the day: arrive, then each room, at a glance.
  const groupDay =
    group && eventPhase(event, new Date()) === "day" && event.performance_order_published && (myRooms ?? []).length > 0
      ? dayStatus(
          groupSteps({ slots: myRooms ?? [], rooms: roomById, checkins: checkinData ?? [], time: (iso) => formatTime(iso, event.timezone) }),
          new Date(),
          (iso) => formatTime(iso, event.timezone),
        )
      : null;
  // On the day itself the day card comes first, so the info starts folded.
  const infoOpen = !contestDay && !groupDay && cookieStore.get(CONTEST_INFO_COOKIE)?.value !== "closed";
  const people = `${band.student_count} ${group ? "participants" : "students"} · ${band.chaperone_count} chaperones`;

  const one = group ? "group" : "band";
  const withdrawn = Boolean(band.scratched_at);
  const phase = eventPhase(event, new Date());
  // Removed outright while registration is open and times aren't posted; marked withdrawn after that.
  const withdrawRemoves = open && !event.performance_order_published;
  const { logoPath } = await loadEventBrand(event.slug);
  const logo = eventLogoUrl(event.slug, logoPath);
  const contactButton = "inline-flex min-h-11 items-center rounded-md border border-field-border px-4 text-sm font-semibold text-brand hover:border-brand";
  const contactButtons = hasContact && (
    <p className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-muted">{contact.name || "Organizer"}</span>
      {contact.email && (
        <a href={`mailto:${contact.email}`} className={contactButton}>
          Email
        </a>
      )}
      {/* No digits on screen; the number only unlocks the day before and on contest day. */}
      {phone && (
        <>
          <a href={`tel:${phone}`} className={contactButton}>
            Call
          </a>
          <a href={`sms:${phone}`} className={contactButton}>
            Text
          </a>
        </>
      )}
    </p>
  );

  const times = group ? (
    event.performance_order_published && (myRooms ?? []).length > 0 ? (
      <Card className="mt-6 border-brand">
        <h2 className="font-semibold">Your schedule</h2>
        {arrived && (
          <p className="mt-1 text-sm font-medium text-success">
            ✓ Checked in at {formatTime(arrived.created_at, event.timezone)}
          </p>
        )}
        <ol className="mt-3 divide-y divide-border">
          {(myRooms ?? []).map((s) => {
            const room = roomById.get(s.room_id);
            const done = tapped(s.room_id);
            return (
              <li key={s.room_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                <span className={done ? "text-muted" : undefined}>
                  <span className="font-semibold">{room?.name ?? "Room"}</span>
                  {room?.note && <span className="text-sm text-muted"> · {room.note}</span>}
                  {done && <span className="text-sm font-medium text-success"> · ✓ Done</span>}
                </span>
                <span className="tabular-nums">
                  {event.starts_on !== event.ends_on && `${formatDate(utcToZonedDate(s.starts_at, event.timezone), { year: undefined })}, `}
                  {formatTime(s.starts_at, event.timezone)}–{formatTime(s.ends_at, event.timezone)}{" "}
                  {zoneAbbreviation(s.starts_at, event.timezone)}
                </span>
              </li>
            );
          })}
        </ol>
        {groupCalendar && (
          <p className="mt-3 flex flex-wrap items-center gap-x-4 text-sm">
            <span className="text-muted">Add to calendar:</span>
            <a href={googleCalendarUrl(groupCalendar)} target="_blank" rel="noreferrer" className={`inline-flex min-h-11 items-center ${linkClass}`}>
              Google
            </a>
            <a href={`/dashboard/bands/${bandId}/calendar?round=rooms`} className={`inline-flex min-h-11 items-center ${linkClass}`}>
              Apple / Outlook
            </a>
          </p>
        )}
      </Card>
    ) : null
  ) : (
    <>
      {event.finalists_revealed && finalsSlot && (
        <TimesCard
          title={`Finals · #${finalsSlot.slot_number}`}
          icon="trophy"
          times={finalsSlot}
          event={{ ...event, ready_minutes_before: event.finals_ready_minutes_before }}
          calendar={calendar("finals", finalsSlot)}
          icsUrl={`/dashboard/bands/${bandId}/calendar?round=finals`}
          highlight
        />
      )}
      {event.performance_order_published && slot && (
        <TimesCard
          title={`${hasFinals ? "Preliminaries" : "Your times"} · #${slot.performance_order} in the order`}
          times={slot}
          done={prelimsDone}
          event={event}
          calendar={calendar("order", slot)}
          icsUrl={`/dashboard/bands/${bandId}/calendar`}
        />
      )}
    </>
  );
  const timesPosted = group ? event.performance_order_published && (myRooms ?? []).length > 0 : event.performance_order_published && Boolean(slot);

  return (
    <div className="mx-auto max-w-2xl">
      {event.status === "published" && (
        <div className="-mx-4 -mt-8 mb-4 sm:-mt-10">
          <ScheduleUpdateBanner slug={event.slug} version={event.schedule_updated_at} />
        </div>
      )}
      <Link href="/dashboard" className="text-sm text-muted hover:text-foreground">
        ← Dashboard
      </Link>
      {registered && (
        <Card className="mt-4 border-success/30 bg-success-soft" role="status">
          <p className="font-medium">You&apos;re registered.</p>
          <p className="mt-1 text-sm text-muted">
            We emailed you a copy. We&apos;ll email again when {group ? "the schedule is" : "performance times are"} posted.
          </p>
        </Card>
      )}
      {saved && <SuccessToast message="Registration updated." />}

      <header className="mt-4">
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <LineIcon name={group ? "group" : "band"} inline />
          <span className="font-semibold">{band.band_name}</span>
          <span className="text-muted">· {band.school_name}</span>
          {withdrawn && <Badge tone="off">Withdrawn</Badge>}
        </p>
        <div className="mt-2 flex items-center gap-3">
          {logo && (
            <span className="flex h-12 max-w-[7rem] shrink-0 items-center rounded-md border border-border bg-white p-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo} alt="Organizer logo" className="max-h-full max-w-full object-contain" />
            </span>
          )}
          <h1 className="min-w-0 text-3xl font-medium tracking-tight sm:text-4xl">{event.name}</h1>
        </div>
        <p className="mt-2 text-muted">
          {formatDateRange(event.starts_on, event.ends_on)} · {[event.venue_name, event.venue_address].filter(Boolean).join(" · ")} ·{" "}
          <a href={mapUrl} target="_blank" rel="noreferrer" className={linkClass}>
            Directions
          </a>{" "}
          ·{" "}
          <Link href={`/e/${event.slug}`} className={linkClass}>
            Full schedule
          </Link>
        </p>
      </header>

      <EventBannerSlot eventId={band.event_id} audience="band_directors" tz={event.timezone} className="mt-6" />

      {withdrawn && !contestDay && (
        <Card className="mt-6 border-danger/40" role="status">
          <h2 className="font-semibold">{band.band_name} has withdrawn</h2>
          <p className="mt-1 text-sm text-muted">
            The organizer has been told. If this is a mistake, contact them{hasContact ? " below" : ""}. Only the organizer can undo it.
          </p>
        </Card>
      )}

      {contestDay && (
        <>
          <AutoRefresh status className="mt-6" />
          <ContestDayCard
            band={day as BandDay & { band_name: string }}
            rows={(progress ?? []) as ProgressRow[]}
            prelims={slot}
            finals={event.finalists_revealed ? finalsSlot : null}
            readyMinutes={event.ready_minutes_before}
            finalsReadyMinutes={event.finals_ready_minutes_before}
            time={(iso) => formatTime(iso, event.timezone)}
            phone={phone}
          />
        </>
      )}

      {groupDay && (
        <>
          <AutoRefresh status className="mt-6" />
          <Card className="mt-6 border-brand">
            <h2 className="font-semibold">Event day</h2>
            <div className="mt-3">
              <DayStatusBanner status={groupDay} phone={phone} doneText="You've finished every room. Thank you." />
            </div>
            <p className="mt-3 text-xs text-muted">Updates as the organizer&apos;s team checks you in. Your times are below.</p>
          </Card>
        </>
      )}

      {/* Before the day: what's done, and what comes next. */}
      {!withdrawn && phase === "before" && (
        <Card className="mt-6">
          <h2 className="font-semibold">What&apos;s next</h2>
          <ol className="mt-3 space-y-3">
            <NextStep done title="Registered">
              {open
                ? event.band_registration_deadline
                  ? `You can change your registration until the end of ${formatDate(event.band_registration_deadline)}.`
                  : "You can change your registration while registration is open."
                : "Registration is closed. Changes go through the organizer."}
            </NextStep>
            <NextStep done={timesPosted} title={group ? "Schedule posted" : "Times posted"}>
              {timesPosted
                ? `Your ${group ? "schedule is" : "times are"} below.`
                : `We'll email you when the organizer posts ${group ? "your group's times in each room" : "your performance time"}.`}
            </NextStep>
            <NextStep done={false} title={group ? "Event day" : "Contest day"}>
              {formatDateRange(event.starts_on, event.ends_on)}
              {event.venue_name ? ` at ${event.venue_name}` : ""}
            </NextStep>
          </ol>
        </Card>
      )}

      {times}

      {(hasContact || event.director_info || event.payment_link || files.length > 0) && (
        <Card className="mt-6">
          <h2 className="font-semibold">From the organizer</h2>
          {contactButtons && <div className="mt-3">{contactButtons}</div>}
          {event.payment_link && (
            <p className="mt-3">
              <a href={event.payment_link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand-hover">
              Pay the entry fee <span className="sr-only">(opens in a new tab)</span>
            </a>
            </p>
          )}
          {event.director_info && (
            <CollapsibleInfo initialOpen={infoOpen} label={`${group ? "Event" : "Contest"} info: fees, arrival, and parking`}>
              <p className="mt-1 whitespace-pre-line text-sm leading-6">{event.director_info}</p>
            </CollapsibleInfo>
          )}
          {files.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">Maps and documents</h3>
              <FileLinks files={files} className="mt-2" />
            </div>
          )}
        </Card>
      )}

      <details className="group mt-6 rounded-xl border border-border bg-surface">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-5 sm:p-6 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Your registration</h2>
              <Badge tone={open && !withdrawn ? "success" : "neutral"}>
                {withdrawn
                  ? "Withdrawn"
                  : open
                    ? event.band_registration_deadline
                      ? `Editable until ${formatDate(event.band_registration_deadline, { year: undefined })}`
                      : "Editable while registration is open"
                    : "Registration closed"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted">
              {band.classification} · {people}
            </p>
          </div>
          <span className="shrink-0 text-sm font-medium text-brand">
            <span className="group-open:hidden">{open && !withdrawn ? "View or edit" : "View"}</span>
            <span className="hidden group-open:inline">Hide</span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-muted transition group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="border-t border-border px-5 pb-5 sm:px-6 sm:pb-6">
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <Item label="Classification">{band.classification}</Item>
            <Item label="People">{people}</Item>
            <Item label="Vehicles">
              {[
                [band.bus_count, "bus", "buses"],
                [band.box_truck_count, "box truck", "box trucks"],
                [band.truck_trailer_count, "truck + trailer", "trucks + trailers"],
                [band.semi_truck_count, "semi", "semis"],
              ]
                .filter(([n]) => Number(n) > 0)
                .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
                .join(" · ") || "None listed"}
            </Item>
            <Item label="Head director">
              {band.head_director_name} · {formatPhone(band.head_director_phone)}
            </Item>
            {band.assistant_directors.length > 0 && <Item label="Assistant directors">{band.assistant_directors.join(", ")}</Item>}
            <Item label={group ? "Group contact email" : "Band contact email"}>{band.contact_email}</Item>
            <Item label="Scheduling conflicts">{band.contest_day_conflicts ?? "None"}</Item>
            <Item label="Accessibility or staging needs">{band.special_needs ?? "None"}</Item>
            {mealOffer && (
              <Item label="Meals">
                {(() => {
                  const order = mealAsk[bandId];
                  const n = order ? mealTotal(order.counts) : 0;
                  if (!n) return order?.note ? `None ordered · ${order.note}` : "None ordered";
                  return [
                    `${mealSummary(order.counts, mealOffer.options)} · ${n} meal${n === 1 ? "" : "s"}${mealOffer.priceCents != null ? `, ${mealPrice(n * mealOffer.priceCents)}` : ""}`,
                    order.note,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                })()}
              </Item>
            )}
          </dl>
          {withdrawn ? null : open ? (
            <Link
              href={`/dashboard/bands/${bandId}/edit`}
              className="mt-5 inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-background"
            >
              Edit registration
            </Link>
          ) : (
            <div className="mt-5 space-y-2 text-sm">
              <p className="text-muted">Registration is closed, so changes go through the organizer.</p>
              {contactButtons}
            </div>
          )}
          {!withdrawn && phase !== "after" && (
            <div className="mt-6 border-t border-border pt-3">
              <WithdrawBandButton
                bandName={band.band_name}
                eventName={event.name}
                removes={withdrawRemoves}
                one={one}
                action={withdrawBand.bind(null, bandId)}
              />
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

/** One line of "What's next": a check when done, an open circle when not. */
function NextStep({ done, title, children }: { done: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <span
        aria-hidden
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${done ? "border-success bg-success text-success-foreground" : "border-field-border"}`}
      >
        {done ? "✓" : ""}
      </span>
      <span className="min-w-0">
        <span className="font-semibold">
          {title}
          <span className="sr-only">{done ? " (done)" : " (still to come)"}</span>
        </span>
        <span className="block text-muted">{children}</span>
      </span>
    </li>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

type TimesEvent = { timezone: string; starts_on: string; ends_on: string; ready_minutes_before: number };

/** Warm-up → ends → ready → performs, as a vertical timeline with the performance time up top. */
function TimesCard({
  title,
  icon,
  times: t,
  event,
  calendar,
  icsUrl,
  highlight = false,
  done = false,
}: {
  title: string;
  /** Shown before the title, hidden from screen readers. */
  icon?: IconName;
  times: BandTimes;
  event: TimesEvent;
  calendar: ReturnType<typeof bandCalendarEvent>;
  icsUrl: string;
  highlight?: boolean;
  /** Already performed: show the times folded, under a "Performed" note. */
  done?: boolean;
}) {
  const tz = event.timezone;
  const multiDay = event.starts_on !== event.ends_on;
  const at = (iso: string) => `${formatTime(iso, tz)} ${zoneAbbreviation(iso, tz)}`;
  const warmEnd = warmUpEndAt(t.warm_up_at, t.warm_up_minutes);
  const ready = readyAt(t.perform_at, event.ready_minutes_before);
  const steps = [
    t.warm_up_at && { label: "Warm-up starts", time: at(t.warm_up_at), note: t.warm_up_location },
    warmEnd && { label: "Warm-up ends", time: at(warmEnd), note: `${t.warm_up_minutes} min` },
    ready && { label: "Ready position", time: at(ready), note: `${event.ready_minutes_before} min before performing` },
    t.perform_at && { label: "Performance", time: at(t.perform_at), note: null },
  ].filter(Boolean) as { label: string; time: string; note: string | null }[];

  const details = (
    <>
      {t.perform_at ? (
        <p className="mt-3">
          <span className="block text-sm text-muted">
            Performs{multiDay ? ` ${formatDate(utcToZonedDate(t.perform_at, tz), { year: undefined })}` : ""}
          </span>
          <span className="text-3xl font-semibold tabular-nums">{at(t.perform_at)}</span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">Performance time to be announced.</p>
      )}
      <ol className="mt-5 space-y-0">
        {steps.map((s, i) => (
          <li key={s.label} className="relative flex gap-3 pb-4 last:pb-0">
            {i < steps.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-border" aria-hidden="true" />}
            <span
              className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ${s.label === "Performance" ? "bg-brand" : "border-2 border-brand bg-surface"}`}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-sm">
                <span className="font-semibold tabular-nums">{s.time}</span> <span className="text-muted">·</span> {s.label}
              </p>
              {s.note && <p className="text-sm text-muted">{s.note}</p>}
            </div>
          </li>
        ))}
      </ol>
      {calendar && (
        <p className="mt-4 flex flex-wrap items-center gap-x-4 text-sm">
          <span className="text-muted">Add to calendar:</span>
          <a href={googleCalendarUrl(calendar)} target="_blank" rel="noreferrer" className={`inline-flex min-h-11 items-center ${linkClass}`}>
            Google
          </a>
          <a href={icsUrl} className={`inline-flex min-h-11 items-center ${linkClass}`}>
            Apple / Outlook
          </a>
        </p>
      )}
    </>
  );

  return (
    <Card className={`mt-6 ${highlight ? "border-brand" : ""}`}>
      <h2 className="font-semibold">
        {icon && <LineIcon name={icon} inline className="text-brand dark:text-foreground" />}
        {title}
      </h2>
      {done ? (
        <>
          <p className="mt-1 text-sm font-medium text-success">✓ Performed</p>
          <details className="group mt-1">
            <summary className={`inline-flex min-h-11 cursor-pointer items-center text-sm ${linkClass}`}>
              <span className="group-open:hidden">Show these times</span>
              <span className="hidden group-open:inline">Hide these times</span>
            </summary>
            {details}
          </details>
        </>
      ) : (
        details
      )}
    </Card>
  );
}

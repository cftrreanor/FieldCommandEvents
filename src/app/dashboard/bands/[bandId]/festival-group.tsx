import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { EventBannerSlot } from "@/components/event-banner-slot";
import { FileLinks } from "@/components/file-links";
import { ScheduleUpdateBanner } from "@/components/schedule-update-banner";
import { SuccessToast } from "@/components/toaster";
import { Badge, Card } from "@/components/ui";
import { withdrawBand } from "@/app/dashboard/band-actions";
import { groupCalendarEvent } from "@/lib/band-calendar";
import { registrationIsOpen, type BandRow } from "@/lib/bands";
import { eventPhase } from "@/lib/contest-day";
import { getOrigin } from "@/lib/data";
import { groupState } from "@/lib/festival-day";
import { filesFor } from "@/lib/event-files";
import { googleCalendarUrl } from "@/lib/ics";
import { longDay, span } from "@/lib/rooms";
import { createClient } from "@/lib/supabase/server";
import { eachDate, formatDate, formatTime, utcToZonedDate, zoneAbbreviation, zoneName } from "@/lib/time";
import { WithdrawBandButton } from "./withdraw-band";

type FestivalEvent = {
  name: string;
  slug: string;
  status: string;
  event_type: string | null;
  timezone: string;
  starts_on: string;
  ends_on: string;
  venue_name: string | null;
  venue_address: string;
  venue_place_id: string | null;
  band_registration_open: boolean;
  band_registration_deadline: string | null;
  band_registration_opens_on: string | null;
  director_info: string | null;
  payment_link: string | null;
  performance_order_published: boolean;
  schedule_updated_at: string | null;
};

const OUT = "inline-flex min-h-11 items-center justify-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";
const LINK = "inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4";

/**
 * A director's page for one festival group (board 17): where and when, the organizer's information, and their
 * registration (changes and withdrawing only until registration closes).
 */
export async function FestivalGroupPage({
  band,
  event,
  registered,
  saved,
}: {
  band: BandRow & { available_day?: string | null };
  event: FestivalEvent;
  registered: boolean;
  saved: boolean;
}) {
  const supabase = await createClient();
  const [{ data: myRooms }, { data: roomData }, { data: markData }, { data: contact }, { data: phone }, files, origin] = await Promise.all([
    supabase.from("room_slots").select("room_id, starts_at, ends_at").eq("band_id", band.id).order("starts_at"),
    supabase.from("rooms").select("id, name, note, path_order").eq("event_id", band.event_id),
    // The team's marks for this group (readable once the festival is published). Only 'done' rows mean arrived or done.
    supabase.from("group_checkins").select("room_id, created_at, kind").eq("band_id", band.id),
    supabase.from("event_director_contacts").select("name, email, has_phone").eq("event_id", band.event_id).maybeSingle(),
    supabase.rpc("director_contact_phone", { ev: band.event_id }),
    filesFor([band.event_id], ["public", "directors"], () => event.timezone),
    getOrigin(),
  ]);
  const tz = event.timezone;
  const rooms = roomData ?? [];
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const outside = rooms.filter((r) => r.path_order == null);
  const slots = myRooms ?? [];
  const marks = markData ?? [];
  const doneIn = (room: string | null) => marks.find((m) => m.room_id === room && m.kind === "done");
  const posted = event.performance_order_published && slots.length > 0;
  const open = registrationIsOpen(event);
  const withdrawn = Boolean(band.scratched_at);
  const phase = eventPhase(event, new Date());
  const day = slots[0] ? utcToZonedDate(slots[0].starts_at, tz) : null;
  const mapUrl = `https://www.google.com/maps/search/?${new URLSearchParams({
    api: "1",
    query: event.venue_address,
    ...(event.venue_place_id ? { query_place_id: event.venue_place_id } : {}),
  })}`;
  const calendar = posted
    ? groupCalendarEvent({
        bandId: band.id,
        bandName: band.band_name,
        stops: slots.map((s) => ({ name: roomById.get(s.room_id)?.name ?? "Room", note: roomById.get(s.room_id)?.note ?? null, starts_at: s.starts_at, ends_at: s.ends_at })),
        event,
        url: `${origin}/dashboard/bands/${band.id}`,
      })
    : null;
  // On the day: the same words as the team's Event day, from the team's marks ("Now" only from a mark).
  const onTheDay =
    posted && phase === "day"
      ? groupState({
          bandId: band.id,
          slots: slots.map((x) => ({ ...x, band_id: band.id })),
          marks: marks.map((m) => ({ ...m, band_id: band.id })),
          now: new Date(),
          live: true,
          roomName: (id) => roomById.get(id)?.name ?? "A room",
          time: (iso) => formatTime(iso, tz),
        })
      : null;
  const hasContact = contact && (contact.name || contact.has_phone || contact.email);
  // The days this group could be on: its own day once it has times, its asked-for day, else every festival day.
  const days = day ? [day] : band.available_day ? [band.available_day] : eachDate(event.starts_on, event.ends_on);
  const closes = event.band_registration_deadline ? ` until registration closes ${formatDate(event.band_registration_deadline)}` : " while registration is open";

  return (
    <div className="mx-auto max-w-2xl">
      {event.status === "published" && (
        <div className="-mx-4 -mt-8 mb-4 sm:-mt-10">
          <ScheduleUpdateBanner slug={event.slug} version={event.schedule_updated_at} />
        </div>
      )}
      {saved && <SuccessToast message="Registration updated." />}
      <Link href="/dashboard" className="inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground">
        ← Your groups
      </Link>
      {registered && (
        <Card className="mt-2 border-success/30 bg-success-soft" role="status">
          <p className="font-medium">{band.band_name} is registered</p>
          <p className="mt-1 text-sm">
            We emailed you a copy. Your group&apos;s times come by email once the organizer{" "}
            {event.performance_order_published ? "adds your group to the schedule" : "posts the schedule"}.
          </p>
        </Card>
      )}

      <header className="mt-2">
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{band.band_name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2">
          <span className="text-muted">
            {band.school_name} · {event.name}
          </span>
          {withdrawn && <Badge tone="off">Withdrawn</Badge>}
        </p>
        <p className="mt-2 text-sm">
          {days.map((d) => longDay(d)).join(" or ")}
          {event.venue_name || event.venue_address ? ` · ${[event.venue_name, event.venue_address].filter(Boolean).join(", ")}` : ""}
        </p>
        {event.venue_address && (
          <a href={mapUrl} target="_blank" rel="noreferrer" className={LINK}>
            Get directions <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </header>

      <EventBannerSlot eventId={band.event_id} audience="band_directors" tz={tz} className="mt-4" />

      {withdrawn && (
        <Card className="mt-6 border-danger/40" role="status">
          <h2 className="font-semibold">{band.band_name} has withdrawn</h2>
          <p className="mt-1 text-sm">The organizer has been told. If this is a mistake, contact them. Only the organizer can undo it.</p>
        </Card>
      )}

      {onTheDay && (
        <>
          <AutoRefresh status className="mt-6" />
          <Card className="mt-2 border-brand">
            <h2 className="font-semibold">Today</h2>
            <p className="mt-2">
              <Badge tone={onTheDay.status.tone}>
                {onTheDay.status.tone === "warning" && <span aria-hidden>◆&nbsp;</span>}
                {onTheDay.status.text}
              </Badge>
            </p>
            <p className="mt-2 text-sm">{onTheDay.line.replace(/ by .*?( ·|$)/, "$1")}</p>
            <p className="mt-3 text-sm">Updates as the festival team marks your group in each room.</p>
          </Card>
        </>
      )}

      {!withdrawn && (
        <Card className="mt-6">
          {posted ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Your times · {longDay(day!)}</h2>
                <Badge tone="success">Posted</Badge>
              </div>
              <ol className="mt-3 divide-y divide-border">
                {slots.map((s) => {
                  const room = roomById.get(s.room_id);
                  const done = doneIn(s.room_id);
                  return (
                    <li key={s.room_id} className="flex gap-3 py-2.5 text-sm">
                      <span className="w-[7rem] shrink-0 tabular-nums">{span(new Date(s.starts_at), new Date(s.ends_at), tz)}</span>
                      <span className="min-w-0">
                        <span className="font-semibold">{room?.name ?? "Room"}</span>
                        {room?.note && <span className="block text-muted">{room.note}</span>}
                        {done && <span className="block font-medium text-success">✓ Done</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-2 text-sm text-muted">
                Times in {zoneName(tz)} ({zoneAbbreviation(slots[0].starts_at, tz)})
              </p>
              {calendar && (
                <div className="mt-3 flex flex-wrap items-center gap-x-4">
                  <span className="text-sm font-semibold">Add to calendar:</span>
                  <a href={googleCalendarUrl(calendar)} target="_blank" rel="noreferrer" className={LINK}>
                    Google
                  </a>
                  <a href={`/dashboard/bands/${band.id}/calendar?round=rooms`} className={LINK}>
                    Apple or Outlook
                  </a>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Your times</h2>
                <Badge>Times not posted yet</Badge>
              </div>
              <p className="mt-2 text-sm">
                {event.performance_order_published
                  ? "Your times come by email once the organizer adds your group to the schedule."
                  : `Your times come by email once the organizer posts the schedule${event.band_registration_deadline && open ? `, after registration closes ${formatDate(event.band_registration_deadline)}` : ""}.`}
              </p>
            </>
          )}
        </Card>
      )}

      {(event.director_info || event.payment_link || hasContact || files.length > 0) && (
        <Card className="mt-6">
          <h2 className="text-lg font-semibold">From the organizer</h2>
          {event.director_info && <p className="mt-2 whitespace-pre-line text-sm leading-6">{event.director_info}</p>}
          {event.payment_link && (
            <a href={event.payment_link} target="_blank" rel="noopener noreferrer" className={`${OUT} mt-3`}>
              Pay the entry fee <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          {hasContact && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="mr-1">{contact.name || "Organizer"}</span>
              {contact.email && (
                <a href={`mailto:${contact.email}`} className={OUT}>
                  Email
                </a>
              )}
              {phone && (
                <>
                  <a href={`tel:${phone}`} className={OUT}>
                    Call
                  </a>
                  <a href={`sms:${phone}`} className={OUT}>
                    Text
                  </a>
                </>
              )}
            </p>
          )}
          {contact?.email && <p className="mt-1 text-sm break-all">{contact.email}</p>}
          {files.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">Maps and documents</h3>
              <FileLinks files={files} className="mt-2" />
            </div>
          )}
        </Card>
      )}

      {outside.length > 0 && (
        <p className="mt-6 text-sm">
          <span className="font-semibold">Also at the festival:</span> {outside.map((r) => `${r.name}${r.note ? ` (${r.note})` : ""}`).join(", ")}
        </p>
      )}

      <Card className="mt-6">
        <h2 className="text-lg font-semibold">Your registration</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          {band.classification && <Item label="Classification">{band.classification}</Item>}
          <Item label="Performers">{band.student_count}</Item>
          {band.chaperone_count != null && <Item label="Chaperones">{band.chaperone_count}</Item>}
          {band.bus_count > 0 && <Item label="Buses">{band.bus_count}</Item>}
          {band.contest_day_conflicts && <Item label="Anything else">{band.contest_day_conflicts}</Item>}
        </dl>
        {withdrawn ? null : open ? (
          <>
            <p className="mt-3 text-sm">You can change your answers{closes}.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Link href={`/dashboard/bands/${band.id}/edit`} className={OUT}>
                Change your registration
              </Link>
              <WithdrawBandButton
                bandName={band.band_name}
                eventName={event.name}
                removes={!event.performance_order_published}
                one="group"
                label="Withdraw your group"
                action={withdrawBand.bind(null, band.id)}
              />
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm">To change your registration, contact the organizer.</p>
        )}
      </Card>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

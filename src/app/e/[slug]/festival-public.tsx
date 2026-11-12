import Link from "next/link";
import type { ReactNode } from "react";
import { RoomSchedule, type ScheduleRoom, type ScheduleSlot } from "@/components/room-schedule";
import { Badge, Card } from "@/components/ui";
import { deadlinePassed, opensLater, registrationIsOpen } from "@/lib/bands";
import { publicGroupLine, roomNowNext, type Mark, type Slot } from "@/lib/festival-day";
import { longDay, span } from "@/lib/rooms";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime, utcToZonedDate, zoneName } from "@/lib/time";
import { FindGroup, type FoundGroup } from "./find-group";

type FestivalEvent = {
  id: string;
  status: string;
  timezone: string;
  starts_on: string;
  ends_on: string;
  band_registration_open: boolean;
  band_registration_deadline: string | null;
  band_registration_opens_on: string | null;
  performance_order_published: boolean;
};
type PublicSlot = ScheduleSlot & { band_id: string };

const BTN = "inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand-hover";
const OUT = "inline-flex min-h-11 items-center justify-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";

/** The room families most want to follow: a performance room by its name, else the first room on the path. */
function mainRoom(path: ScheduleRoom[]) {
  return path.find((r) => /perform|stage|hall|concert|auditorium/i.test(r.name)) ?? path[0];
}

/**
 * The festival's public page (board 15), by stage: weeks before (register, and when times come), registration closed
 * before posting, on the day (each room's Now and Up next as the team marks it, find a group, the main room's list),
 * and after. Band contests and fairs don't use this. `liveEnd` (the day's sponsor line, from the page) goes at the
 * end of the day's live part.
 */
export async function FestivalPublic({ slug, event, liveEnd }: { slug: string; event: FestivalEvent; liveEnd?: ReactNode }) {
  const supabase = await createClient();
  const [{ data: roomData }, { data: slotData }, { data: liveData }] = await Promise.all([
    supabase.from("rooms").select("id, name, note, path_order").eq("event_id", event.id),
    supabase.rpc("public_room_schedule", { p_slug: slug }),
    supabase.rpc("public_room_live", { p_slug: slug }),
  ]);
  const tz = event.timezone;
  const rooms = (roomData ?? []) as ScheduleRoom[];
  const path = rooms.filter((r) => r.path_order != null).sort((a, b) => a.path_order! - b.path_order!);
  const outside = rooms.filter((r) => r.path_order == null);
  const slots = (slotData ?? []) as PublicSlot[];
  const marks = ((liveData ?? []) as { band_id: string; room_id: string | null; kind: string; marked_at: string }[]).map(
    (m): Mark => ({ band_id: m.band_id, room_id: m.room_id, kind: m.kind, created_at: m.marked_at }),
  );
  const now = new Date();
  const today = utcToZonedDate(now.toISOString(), tz);
  const phase = today < event.starts_on ? "before" : today > event.ends_on ? "after" : "day";
  const posted = event.performance_order_published && slots.length > 0;
  const open = registrationIsOpen(event);
  const later = event.status === "published" && event.band_registration_open && opensLater(event);
  const deadline = event.band_registration_deadline;
  const dayOf = (iso: string) => utcToZonedDate(iso, tz);
  const multiDay = event.starts_on !== event.ends_on;
  const time = (iso: string) => formatTime(iso, tz);
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const directorLink = (
    <Link href="/dashboard" className={OUT}>
      Already registered? See your group&apos;s page
    </Link>
  );

  // Find a group: every group with times, its day, each room's times as a row, and on the day where it is now.
  const todaysSlots: Slot[] = slots
    .filter((s) => dayOf(s.starts_at) === today)
    .map((s) => ({ room_id: s.room_id, band_id: s.band_id, starts_at: s.starts_at, ends_at: s.ends_at }));
  const found: FoundGroup[] = [...new Set(slots.map((s) => s.band_id))].map((id) => {
    const mine = slots.filter((s) => s.band_id === id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return {
      id,
      name: mine[0].band_name,
      school: mine[0].school_name,
      day: longDay(dayOf(mine[0].starts_at)),
      times: mine.map((s) => ({ room: roomName.get(s.room_id) ?? "Room", time: span(new Date(s.starts_at), new Date(s.ends_at), tz) })),
      status: phase === "day" ? publicGroupLine(id, todaysSlots, marks, (r) => roomName.get(r) ?? "A room", time) : null,
    };
  });
  // Rooms outside the rotation (a hospitality room, where buses park): listed at every stage, with no times.
  const alsoAt = outside.length > 0 && (
    <p className="mt-4 text-sm">
      <span className="font-semibold">Also at the festival:</span> {outside.map((r) => `${r.name}${r.note ? ` (${r.note})` : ""}`).join(", ")}
    </p>
  );

  return (
    <>
      {phase !== "after" && !posted && (
        <>
          <Card className="mt-8">
            <h2 className="text-lg font-semibold">Group directors</h2>
            {open ? (
              <>
                <p className="mt-1 text-sm">
                  Registration is open{deadline ? ` through ${formatDate(deadline)}` : ""}. No account needed.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/e/${slug}/register`} className={BTN}>
                    Register your group
                  </Link>
                  {directorLink}
                </div>
              </>
            ) : later ? (
              <>
                <p className="mt-1 text-sm">Registration opens {formatDate(event.band_registration_opens_on!)}.</p>
                <div className="mt-3">
                  <Link href={`/e/${slug}/register`} className={OUT}>
                    See the registration page
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm">
                  {deadline && deadlinePassed(event) ? `Registration closed ${formatDate(deadline)}.` : "Registration is closed."} To register now, contact
                  the organizer.
                </p>
                <div className="mt-3">{directorLink}</div>
              </>
            )}
          </Card>
          <Card className="mt-4">
            <h2 className="text-lg font-semibold">Schedule</h2>
            <p className="mt-1 text-sm">
              Times show here once the organizer posts the schedule
              {deadline && !deadlinePassed(event) ? `, after registration closes ${formatDate(deadline)}` : ""}.
            </p>
          </Card>
          {alsoAt}
        </>
      )}

      {posted && phase === "day" && onTheDay()}

      {posted && phase !== "day" && (
        <>
          {phase === "after" ? (
            <Card className="mt-8">
              <h2 className="text-lg font-semibold">This festival has ended</h2>
              <p className="mt-1 text-sm">Thank you for coming. The final schedule is below.</p>
            </Card>
          ) : (
            <>
              {open && (
                <Card className="mt-8">
                  <h2 className="text-lg font-semibold">Group directors</h2>
                  <p className="mt-1 text-sm">
                    Registration is open{deadline ? ` through ${formatDate(deadline)}` : ""}. No account needed.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/e/${slug}/register`} className={BTN}>
                      Register your group
                    </Link>
                    {directorLink}
                  </div>
                </Card>
              )}
              <FindGroup groups={found} className="mt-8" />
            </>
          )}
          <section className="mt-10" aria-labelledby="schedule-heading">
            <h2 id="schedule-heading" className="text-xl font-semibold">
              {phase === "after" ? "Final schedule" : "Schedule"}
            </h2>
            <p className="mt-1 mb-4 text-sm text-muted">Room by room. All times are {zoneName(tz)}</p>
            <RoomSchedule rooms={rooms} slots={slots} timezone={tz} columns={1} />
            {alsoAt}
          </section>
          {phase !== "after" && !open && <div className="mt-6">{directorLink}</div>}
        </>
      )}

      {phase === "after" && !posted && (
        <Card className="mt-8">
          <h2 className="text-lg font-semibold">This festival has ended</h2>
          <p className="mt-1 text-sm">Thank you for coming.</p>
        </Card>
      )}
    </>
  );

  function onTheDay() {
    const todays = slots.filter((s) => dayOf(s.starts_at) === today);
    const name = new Map(slots.map((s) => [s.band_id, s.band_name]));
    const daySlots = todaysSlots;
    const main = mainRoom(path);
    const others = path.filter((r) => r !== main);
    const list = (room: ScheduleRoom) => {
      const { now: cur } = roomNowNext(room.id, daySlots, marks);
      const here = todays.filter((s) => s.room_id === room.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const done = (b: string) => marks.some((m) => m.band_id === b && m.room_id === room.id && m.kind === "done");
      return here.length === 0 ? (
        <p className="mt-2 text-sm">No groups have a time here today.</p>
      ) : (
        <ol className="mt-2 divide-y divide-border">
          {here.map((s) => {
            const isNow = cur?.slot.band_id === s.band_id;
            return (
              <li key={s.band_id} className={`flex items-baseline gap-3 py-2 text-sm ${isNow ? "-mx-2 rounded-md bg-brand-soft px-2" : ""}`}>
                <span className="w-[4.75rem] shrink-0 tabular-nums">{time(s.starts_at)}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{s.band_name}</span>
                  <span className="block text-muted">{s.school_name}</span>
                </span>
                {isNow ? <Badge tone="brand">Now</Badge> : done(s.band_id) ? <span className="shrink-0 text-xs">Done</span> : null}
              </li>
            );
          })}
        </ol>
      );
    };

    return (
      <>
        <Card id="happening-now" className="mt-8 scroll-mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold">Happening now</h2>
            <p className="text-sm text-muted">As the festival team marks it · {time(now.toISOString())}</p>
          </div>
          <ul className="mt-3 space-y-3">
            {path.map((r) => {
              // A group is "Up next" only in the room it goes to next.
              const { now: cur, next, later } = roomNowNext(r.id, daySlots, marks, { headingOnly: true });
              return (
                <li key={r.id} className="rounded-md border border-border p-3">
                  <p className="text-sm font-semibold">{r.name}</p>
                  {r.note && <p className="text-xs text-muted">{r.note}</p>}
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-muted">Now</p>
                      <p className="text-base font-semibold">{cur ? name.get(cur.slot.band_id) : "Between groups"}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted">Up next</p>
                      <p className="text-base font-semibold">{next ? name.get(next.band_id) : later ? "No group on the way yet" : "No one else today"}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {alsoAt}
        </Card>

        <FindGroup groups={found} className="mt-4" />

        {main && (
          <Card className="mt-4">
            <h2 className="text-lg font-semibold">
              {main.name} {multiDay ? `· ${longDay(today)}` : "today"}
            </h2>
            {main.note && <p className="text-sm text-muted">{main.note}</p>}
            {list(main)}
            {others.length > 0 && (
              <div className="mt-4 divide-y divide-border border-y border-border">
                {others.map((r) => (
                  <details key={r.id} className="group">
                    {/* A full-width row: the chevron turns down when it's open. */}
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm font-semibold hover:text-brand [&::-webkit-details-marker]:hidden">
                      <span>
                        {r.name} {multiDay ? `· ${longDay(today)}` : "today"}
                      </span>
                      <span className="flex items-center gap-2 text-xs font-medium text-muted">
                        <span className="group-open:hidden">Show</span>
                        <span className="hidden group-open:inline">Hide</span>
                        <svg aria-hidden viewBox="0 0 20 20" className="size-5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M7.5 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </summary>
                    <div className="pb-3">
                      {r.note && <p className="text-sm text-muted">{r.note}</p>}
                      {list(r)}
                    </div>
                  </details>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-muted">All times are {zoneName(tz)}</p>
            <div className="mt-3">
              <Link href="/dashboard" className={OUT}>
                Group directors: see your group&apos;s page
              </Link>
            </div>
          </Card>
        )}
        {liveEnd}
      </>
    );
  }
}

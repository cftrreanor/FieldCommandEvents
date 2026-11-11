import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card } from "@/components/ui";
import { getEventAccess } from "@/lib/data";
import { hasRooms } from "@/lib/event-types";
import { groupDay, groupDaySummary, type GroupCheckin, type GroupDay, type GroupSlot, type RoomState } from "@/lib/group-day";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { formatTime, utcToZonedDate, zoneName } from "@/lib/time";
import { weekday } from "@/lib/rooms";
import { DoneButton, TapButton } from "../contest-day/controls";
import { PushBackButton } from "../rooms/push-back-form";
import { tapGroup } from "./actions";
import { EventBannerSlot } from "@/components/event-banner-slot";
import { folderTab, folderTabNote, folderTabRow } from "@/components/folder-tabs";

export const metadata: Metadata = { title: "Event day" };
// Pushing the schedule back can email directors from the page's own request: give it time to finish.
export const maxDuration = 300;

type Room = { id: string; name: string; note: string | null; path_order: number };
type Group = { id: string; band_name: string; school_name: string };

const STATE: Record<RoomState, { label: string; className: string }> = {
  done: { label: "Done", className: "border-success text-success" },
  behind: { label: "Running over", className: "border-danger text-danger" },
  now: { label: "On now", className: "border-brand text-brand" },
  upcoming: { label: "Later", className: "border-border text-muted" },
};

/**
 * Group events on the day: the team taps each group in ("Arrived", then
 * "Done" in each room). One tab for every group, one per room.
 */
export default async function EventDayPage({ params, searchParams }: PageProps<"/dashboard/events/[eventId]/event-day">) {
  const { eventId } = await params;
  const { room: roomParam } = await searchParams;
  const supabase = await createClient();
  const [{ data: event }, access, { data: onTeam }] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, event_type, timezone, starts_on, ends_on, performance_order_published")
      .eq("id", eventId)
      .maybeSingle(),
    getEventAccess(eventId),
    supabase.rpc("is_event_staff", { ev: eventId }),
  ]);
  if (!event) missing();
  if (!hasRooms(event.event_type) || !onTeam) redirect(`/dashboard/events/${eventId}`);

  const [{ data: roomData }, { data: slotData }, { data: checkinData }, { data: bandData }, { data: orderData }] = await Promise.all([
    supabase.from("rooms").select("id, name, note, path_order").eq("event_id", eventId).not("path_order", "is", null).order("path_order"),
    supabase.from("room_slots").select("room_id, band_id, starts_at, ends_at").eq("event_id", eventId),
    supabase.from("group_checkins").select("band_id, room_id, created_at, actor_name").eq("event_id", eventId),
    // Hosts read every registration; the team gets names only.
    access.isHost
      ? supabase.from("bands").select("id, band_name, school_name").eq("event_id", eventId)
      : supabase.rpc("event_bands", { ev: eventId }),
    access.isHost
      ? supabase.from("group_order").select("band_id").eq("event_id", eventId).order("position")
      : Promise.resolve({ data: [] as { band_id: string }[] }),
  ]);
  if (!checkinData) missing();
  const rooms = (roomData ?? []) as Room[];
  const groups = new Map(((bandData ?? []) as Group[]).map((b) => [b.id, b]));
  const tz = event.timezone;
  const now = new Date();
  const today = utcToZonedDate(now.toISOString(), tz);
  const live = today >= event.starts_on && today <= event.ends_on;
  const days = groupDay((slotData ?? []) as GroupSlot[], checkinData as GroupCheckin[], now, live).filter((d) => groups.has(d.bandId));
  const summary = groupDaySummary(days);
  const time = (iso: string) => formatTime(iso, tz);
  const room = rooms.find((r) => r.id === roomParam);
  const base = `/dashboard/events/${eventId}/event-day`;
  const tabClass = folderTab;

  // "Push the schedule back" (hosts): the saved order, each with its first time;
  // the default is the first group that hasn't started yet.
  const firstStart = new Map(days.map((d) => [d.bandId, d.rooms[0].slot.starts_at]));
  const pushGroups = (orderData ?? []).flatMap((o, i) => {
    const g = groups.get(o.band_id);
    const start = firstStart.get(o.band_id);
    const day = start ? utcToZonedDate(start, tz) : "";
    return g && start
      ? [{ id: o.band_id, label: `${i + 1}. ${g.band_name} · ${time(start)}`, name: g.band_name, day, dayLabel: weekday(day), startsAt: start, startLabel: time(start) }]
      : [];
  });
  const pushDefault = (pushGroups.find((g) => g.startsAt > now.toISOString()) ?? pushGroups.at(-1))?.id ?? "";

  return (
    <div>
      <Link href={`/dashboard/events/${eventId}`} className="text-sm text-muted hover:text-foreground">
        ← Back to {event.name}
      </Link>
      <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Event day</h1>
      <p className="mt-1 text-sm text-muted">
        Tap a button once; it saves right away. All times {zoneName(tz)}.
      </p>
      <AutoRefresh seconds={10} status className="mt-1" />
      <EventBannerSlot eventId={eventId} audience="section_leads" tz={event.timezone} className="mt-4" />
      {access.canManage && (
        <p className="mt-2 text-sm">
          <Link href={`/dashboard/events/${eventId}/announcements`} className="font-medium text-brand underline-offset-4 hover:underline">
            Broadcast message
          </Link>{" "}
          <span className="text-muted">(a room change, a delay, an emergency)</span>
        </p>
      )}

      {days.length === 0 ? (
        <Card className="mt-6">
          <p className="text-muted">
            {access.isHost ? (
              <>
                No groups are scheduled yet. Set up the rooms and the order on{" "}
                <Link href={`/dashboard/events/${eventId}/rooms`} className="font-medium text-brand underline-offset-4 hover:underline">
                  Rooms and schedule
                </Link>
                .
              </>
            ) : (
              "No groups are scheduled yet. Check back once the host has made the schedule."
            )}
          </p>
        </Card>
      ) : (
        <>
          <Card className="mt-6 p-4">
            <StatusLine summary={summary} groups={groups} rooms={rooms} time={time} />
          </Card>

          {/* Running late is when this is needed, so it sits right under the summary. */}
          {access.isHost && pushGroups.length > 0 && (
            <Card id="push-back" className="mt-3 scroll-mt-6 p-4">
              <details open={summary.behind.length > 0 || summary.late.length > 0}>
                <summary className="cursor-pointer font-semibold">Running behind? Push the schedule back</summary>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Moves every room time for the group you pick and every group after them. Groups before them stay as they
                  are. The minutes are added to that group&apos;s break on{" "}
                  <Link href={`/dashboard/events/${eventId}/rooms`} className="font-medium text-brand underline-offset-4 hover:underline">
                    Rooms and schedule
                  </Link>
                  , so you can undo it there.
                </p>
                <div className="mt-3">
                  <PushBackButton
                    eventId={eventId}
                    groups={pushGroups}
                    defaultGroup={pushDefault}
                    posted={event.performance_order_published}
                    version={null}
                    multiDay={event.starts_on !== event.ends_on}
                  />
                </div>
              </details>
            </Card>
          )}

          <nav aria-label="Rooms" className="relative -mx-4 mt-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <ul className={folderTabRow}>
              <li>
                <Link href={base} scroll={false} aria-current={!room ? "page" : undefined} className={tabClass(!room)}>
                  <span className="whitespace-nowrap">All groups</span>
                  <span className={folderTabNote()}>Who&apos;s here?</span>
                </Link>
              </li>
              {rooms.map((r) => (
                <li key={r.id}>
                  <Link href={`${base}?room=${r.id}`} scroll={false} aria-current={room?.id === r.id ? "page" : undefined} className={tabClass(room?.id === r.id)}>
                    <span className="whitespace-nowrap">
                      {r.path_order}. {r.name}
                    </span>
                    <span className={folderTabNote()}>{r.note || "Room"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {room ? (
            <RoomTab room={room} days={days} groups={groups} eventId={eventId} time={time} live={live} now={now} />
          ) : (
            <ol className="mt-5 space-y-3">
              {days.map((d) => {
                const g = groups.get(d.bandId)!;
                return (
                  <li key={d.bandId}>
                    <Card className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold">{g.band_name}</p>
                          <p className="text-sm text-muted">{g.school_name}</p>
                          <ArrivalNote day={d} time={time} />
                        </div>
                        <ArrivedButton day={d} eventId={eventId} time={time} />
                      </div>
                      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {d.rooms.map((r) => {
                          const rm = rooms.find((x) => x.id === r.slot.room_id);
                          return (
                            <li key={r.slot.room_id} className={`rounded-md border px-3 py-2 ${STATE[r.state].className}`}>
                              <div className="flex items-baseline justify-between gap-2 text-sm">
                                <span className="font-medium text-foreground">{rm?.name ?? "Room"}</span>
                                <span className="text-xs font-semibold">{STATE[r.state].label}</span>
                              </div>
                              <p className="text-xs tabular-nums text-muted">
                                {time(r.slot.starts_at)}–{time(r.slot.ends_at)}
                              </p>
                              <div className="mt-2">
                                <RoomDoneButton bandId={d.bandId} room={r} eventId={eventId} time={time} />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </Card>
                  </li>
                );
              })}
            </ol>
          )}

        </>
      )}
    </div>
  );
}

function StatusLine({
  summary,
  groups,
  rooms,
  time,
}: {
  summary: ReturnType<typeof groupDaySummary>;
  groups: Map<string, Group>;
  rooms: Room[];
  time: (iso: string) => string;
}) {
  const name = (id: string) => groups.get(id)?.band_name ?? "A group";
  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="font-semibold">
          {summary.here} of {summary.total} groups here
        </span>
        {summary.finished > 0 && <span className="text-muted"> · {summary.finished} finished every room</span>}
      </p>
      {summary.late.length > 0 && (
        <p className="text-danger">
          <span className="font-semibold">Not here yet:</span>{" "}
          {summary.late.map((d) => `${name(d.bandId)} (due ${time(d.rooms[0].slot.starts_at)})`).join(", ")}
        </p>
      )}
      {summary.behind.length > 0 && (
        <p className="text-danger">
          <span className="font-semibold">Running over:</span>{" "}
          {summary.behind
            .map((b) => `${name(b.bandId)} in ${rooms.find((r) => r.id === b.slot.room_id)?.name ?? "a room"} (until ${time(b.slot.ends_at)})`)
            .join(", ")}
        </p>
      )}
      {summary.late.length === 0 && summary.behind.length === 0 && <p className="text-success">✓ Everyone&apos;s on track.</p>}
    </div>
  );
}

function ArrivalNote({ day, time }: { day: GroupDay; time: (iso: string) => string }) {
  const first = time(day.rooms[0].slot.starts_at);
  if (day.arrival === "late") return <p className="mt-1 text-sm font-medium text-danger">! Not here yet · first room at {first}</p>;
  if (day.arrival === "soon") return <p className="mt-1 text-sm font-medium text-warning">Due soon · first room at {first}</p>;
  if (day.arrival === "waiting") return <p className="mt-1 text-sm text-muted">First room at {first}</p>;
  return null;
}

function ArrivedButton({ day, eventId, time }: { day: GroupDay; eventId: string; time: (iso: string) => string }) {
  if (day.arrivedAt) {
    const by = day.arrivedAt.actor_name ? ` · ${day.arrivedAt.actor_name}` : "";
    return (
      <DoneButton action={tapGroup.bind(null, eventId, day.bandId, null, false)} detail={`${time(day.arrivedAt.created_at)}${by}`} className="w-44">
        Arrived
      </DoneButton>
    );
  }
  return (
    <TapButton action={tapGroup.bind(null, eventId, day.bandId, null, true)} className="w-44">
      Arrived
    </TapButton>
  );
}

function RoomDoneButton({
  bandId,
  room,
  eventId,
  time,
}: {
  bandId: string;
  room: GroupDay["rooms"][number];
  eventId: string;
  time: (iso: string) => string;
}) {
  if (room.doneAt) {
    const by = room.doneAt.actor_name ? ` · ${room.doneAt.actor_name}` : "";
    return (
      <DoneButton action={tapGroup.bind(null, eventId, bandId, room.slot.room_id, false)} detail={`${time(room.doneAt.created_at)}${by}`}>
        Done
      </DoneButton>
    );
  }
  return (
    <TapButton
      action={tapGroup.bind(null, eventId, bandId, room.slot.room_id, true)}
      // Red stays on the status label and outline; the button is the usual main one.
      variant={room.state === "behind" || room.state === "now" ? "primary" : "secondary"}
      confirmMessage={
        room.state === "upcoming" ? `This group isn't due here until ${time(room.slot.starts_at)}. Mark it done anyway?` : undefined
      }
      className="[&_button]:min-h-10"
    >
      Done
    </TapButton>
  );
}

/** One room: who's in now, who's next, and every group's time here with a Done button. */
function RoomTab({
  room,
  days,
  groups,
  eventId,
  time,
  live,
  now,
}: {
  room: Room;
  days: GroupDay[];
  groups: Map<string, Group>;
  eventId: string;
  time: (iso: string) => string;
  live: boolean;
  now: Date;
}) {
  const here = days
    .flatMap((d) => d.rooms.filter((r) => r.slot.room_id === room.id).map((r) => ({ day: d, r })))
    .sort((a, b) => a.r.slot.starts_at.localeCompare(b.r.slot.starts_at));
  // In the room: the first group not done whose time has started (it may be running over).
  // Up next: the group after them that isn't done yet.
  const waiting = here.filter((x) => x.r.state !== "done");
  const current = waiting.find((x) => new Date(x.r.slot.starts_at) <= now);
  const next = waiting.find((x) => x !== current && (!current || x.r.slot.starts_at > current.r.slot.starts_at));
  return (
    <div className="mt-5 space-y-4">
      {live && (current || next) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {current && (
            <div className={`rounded-lg px-4 py-3 ${current.r.state === "behind" ? "bg-danger/10" : "bg-brand-soft"}`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {current.r.state === "behind" ? `Running over · was until ${time(current.r.slot.ends_at)}` : `Now · until ${time(current.r.slot.ends_at)}`}
              </p>
              <p className="text-lg font-semibold">{groups.get(current.day.bandId)?.band_name}</p>
              <p className="text-sm text-muted">{groups.get(current.day.bandId)?.school_name}</p>
            </div>
          )}
          {next && (
            <div className="rounded-lg bg-background px-4 py-3 ring-1 ring-border">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Up next · {time(next.r.slot.starts_at)}</p>
              <p className="text-lg font-semibold">{groups.get(next.day.bandId)?.band_name}</p>
              <p className={`text-sm ${next.day.arrival === "here" ? "text-success" : next.day.arrival === "late" ? "text-danger" : "text-muted"}`}>
                {next.day.arrival === "here" ? "✓ Arrived" : next.day.arrival === "late" ? "! Not here yet" : "Not here yet"}
              </p>
            </div>
          )}
        </div>
      )}
      {room.note && <p className="text-sm text-muted">Where: {room.note}</p>}
      <ol className="space-y-2">
        {here.map(({ day, r }) => {
          const g = groups.get(day.bandId)!;
          return (
            <li key={day.bandId}>
              <Card className={`flex flex-wrap items-center justify-between gap-3 p-3 ${r.state === "done" ? "opacity-70" : ""}`}>
                <div className="flex min-w-0 items-baseline gap-3">
                  <span className="w-36 shrink-0 text-sm tabular-nums">
                    {time(r.slot.starts_at)}–{time(r.slot.ends_at)}
                  </span>
                  <span className="min-w-0">
                    <span className="font-semibold">{g.band_name}</span>
                    <span className="text-sm text-muted"> · {g.school_name}</span>
                    <span
                      className={`block text-xs ${day.arrival === "here" ? "text-success" : day.arrival === "late" ? "text-danger" : "text-muted"}`}
                    >
                      {day.arrival === "here" ? "✓ Arrived" : day.arrival === "late" ? "! Not here yet" : "Not here yet"}
                      {r.state === "behind" && <span className="font-semibold text-danger"> · running over</span>}
                    </span>
                  </span>
                </div>
                <div className="w-40">
                  <RoomDoneButton bandId={day.bandId} room={r} eventId={eventId} time={time} />
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
      {here.length === 0 && (
        <Card>
          <p className="text-muted">No groups are scheduled in this room.</p>
        </Card>
      )}
    </div>
  );
}

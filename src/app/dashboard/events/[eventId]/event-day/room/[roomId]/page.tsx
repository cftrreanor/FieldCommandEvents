import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { AutoRefresh } from "@/components/auto-refresh";
import { FestivalRoomView, type RoomRow } from "@/components/festival-room-view";
import { getOrigin } from "@/lib/data";
import { hasRooms } from "@/lib/event-types";
import { roomNowNext, roomRowState } from "@/lib/festival-day";
import { longDay } from "@/lib/rooms";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { formatTime } from "@/lib/time";
import { handOff, markGroups } from "../../actions";
import { loadFestivalDay } from "../../load";
import { DoorLink } from "./door-link";

export const metadata: Metadata = { title: "Room" };

/** One room on the day, for the team (board 14), and its door link for hosts and co-hosts. */
export default async function RoomDayPage({ params, searchParams }: PageProps<"/dashboard/events/[eventId]/event-day/room/[roomId]">) {
  const { eventId, roomId } = await params;
  const { day: dayParam } = await searchParams;
  const d = await loadFestivalDay(eventId, dayParam);
  if (!d.event) missing();
  const { event, access } = d;
  if (!hasRooms(event.event_type) || !d.onTeam) redirect(`/dashboard/events/${eventId}`);
  const room = d.rooms.find((r) => r.id === roomId);
  if (!room) missing();

  const tz = event.timezone;
  const time = (iso: string) => formatTime(iso, tz);
  const groupOf = new Map(d.groups.map((g) => [g.id, g]));
  const name = (id: string) => groupOf.get(id)?.band_name || groupOf.get(id)?.school_name || "A group";
  const { now, next, list } = roomNowNext(room.id, d.daySlots, d.marks);
  const arrived = (id: string) => d.marks.some((m) => m.band_id === id && m.room_id == null && m.kind === "done");
  const rows: RoomRow[] = list.map((s) => {
    const state = roomRowState(s.band_id, room.id, d.marks);
    return {
      bandId: s.band_id,
      name: name(s.band_id),
      school: groupOf.get(s.band_id)?.school_name,
      time: time(s.starts_at),
      state,
      marked: state.text === "Done" || state.text === "In now",
    };
  });
  const dayQuery = d.days.length > 1 ? `?day=${d.day}` : "";

  // The door link (hosts and co-hosts read it).
  let door: { url: string; qr: string; on: boolean } | null = null;
  if (access.isHost) {
    const supabase = await createClient();
    const { data: link } = await supabase.from("room_door_links").select("token, turned_off_at").eq("room_id", room.id).maybeSingle();
    if (link) {
      const url = `${await getOrigin()}/door/${link.token}`;
      door = { url, on: !link.turned_off_at, qr: link.turned_off_at ? "" : await QRCode.toString(url, { type: "svg", margin: 1, width: 160 }) };
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/dashboard/events/${eventId}/event-day${dayQuery}`} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground">
        ← Event day
      </Link>
      <h1 className="text-3xl font-medium tracking-tight">{room.name}</h1>
      <p className="mt-1 text-sm text-muted">{[room.note, longDay(d.day)].filter(Boolean).join(" · ")}</p>
      <AutoRefresh seconds={20} />
      <div className="mt-4">
        <FestivalRoomView
          roomName={room.name}
          now={now ? { bandId: now.slot.band_id, name: name(now.slot.band_id), since: time(now.since) } : null}
          next={next ? { bandId: next.band_id, name: name(next.band_id), arrived: arrived(next.band_id) } : null}
          rows={rows}
          mark={async (bandId, kind, on) => {
            "use server";
            return markGroups(eventId, [{ band: bandId, room: roomId, kind, on }]);
          }}
          handOff={async (doneBand, nextBand) => {
            "use server";
            return handOff(eventId, roomId, doneBand, nextBand);
          }}
        />
      </div>
      {access.isHost && (
        <DoorLink eventId={eventId} roomId={room.id} roomName={room.name} door={door} posted={event.performance_order_published && event.status === "published"} />
      )}
    </div>
  );
}

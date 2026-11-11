import type { Metadata } from "next";
import { AutoRefresh } from "@/components/auto-refresh";
import { FestivalRoomView, type RoomRow } from "@/components/festival-room-view";
import { Card } from "@/components/ui";
import { roomNowNext, roomRowState, type Mark, type Slot } from "@/lib/festival-day";
import { longDay } from "@/lib/rooms";
import { createClient } from "@/lib/supabase/server";
import { formatTime, utcToZonedDate } from "@/lib/time";
import { doorHandOff, doorMark } from "./actions";

export const metadata: Metadata = { title: "Room door", robots: { index: false, follow: false }, referrer: "no-referrer" };

type DoorGroup = {
  band_id: string;
  band_name: string;
  school_name: string;
  starts_at: string;
  ends_at: string;
  arrived: boolean;
  no_show: boolean;
  in_at: string | null;
  done_at: string | null;
};
type Door = {
  room: { id: string; name: string; note: string | null };
  event: { name: string; timezone: string; slug: string };
  groups: DoorGroup[];
};

/**
 * A room's door (no sign-in): the same one-room view as the team's, from the door link. Only this room's list, no
 * one's contact details, and it refreshes every 20 seconds. Once the link is off (or the schedule isn't posted), it
 * says so.
 */
export default async function DoorPage({ params }: PageProps<"/door/[token]">) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("room_door", { p_token: token });
  const door = data as Door | null;

  if (!door) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-12">
        <Card>
          <h1 className="text-xl font-semibold">This door link isn&apos;t working</h1>
          <p className="mt-2 leading-7">Ask the organizer for a new one.</p>
        </Card>
      </main>
    );
  }

  const tz = door.event.timezone;
  const time = (iso: string) => formatTime(iso, tz);
  const today = utcToZonedDate(new Date().toISOString(), tz);
  const dayOf = (iso: string) => utcToZonedDate(iso, tz);
  // Today's list; before the festival, its first day with a group here; after, its last.
  const days = [...new Set(door.groups.map((g) => dayOf(g.starts_at)))].sort();
  const day = days.includes(today) ? today : (days.find((x) => x > today) ?? days.at(-1) ?? today);
  const groups = door.groups.filter((g) => dayOf(g.starts_at) === day);

  // The door's marks, in the same shape as the team's, for the shared rules.
  const marks: Mark[] = groups.flatMap((g) => [
    ...(g.arrived ? [{ band_id: g.band_id, room_id: null, kind: "done", created_at: g.starts_at }] : []),
    ...(g.no_show ? [{ band_id: g.band_id, room_id: null, kind: "no_show", created_at: g.starts_at }] : []),
    ...(g.in_at ? [{ band_id: g.band_id, room_id: door.room.id, kind: "in", created_at: g.in_at }] : []),
    ...(g.done_at ? [{ band_id: g.band_id, room_id: door.room.id, kind: "done", created_at: g.done_at }] : []),
  ]);
  const slots: Slot[] = groups.map((g) => ({ room_id: door.room.id, band_id: g.band_id, starts_at: g.starts_at, ends_at: g.ends_at }));
  const name = new Map(groups.map((g) => [g.band_id, g.band_name || g.school_name || "A group"]));
  const { now, next, list } = roomNowNext(door.room.id, slots, marks);
  const rows: RoomRow[] = list.map((s) => {
    const state = roomRowState(s.band_id, door.room.id, marks);
    return { bandId: s.band_id, name: name.get(s.band_id)!, time: time(s.starts_at), state, marked: state.text === "Done" || state.text === "In now" };
  });

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-10">
      <p className="text-sm text-muted">{door.event.name}</p>
      <h1 className="mt-1 text-3xl font-medium tracking-tight">{door.room.name}</h1>
      <p className="mt-1 text-sm text-muted">{[door.room.note, longDay(day)].filter(Boolean).join(" · ")}</p>
      <AutoRefresh seconds={20} status className="mt-1" />
      <div className="mt-4">
        <FestivalRoomView
          roomName={door.room.name}
          now={now ? { bandId: now.slot.band_id, name: name.get(now.slot.band_id)!, since: time(now.since) } : null}
          next={next ? { bandId: next.band_id, name: name.get(next.band_id)!, arrived: groups.find((g) => g.band_id === next.band_id)!.arrived } : null}
          rows={rows}
          mark={doorMark.bind(null, token)}
          handOff={doorHandOff.bind(null, token)}
          footer={<p className="text-sm text-muted">This link marks groups in {door.room.name} only. The festival&apos;s team sees each mark right away.</p>}
        />
      </div>
    </main>
  );
}

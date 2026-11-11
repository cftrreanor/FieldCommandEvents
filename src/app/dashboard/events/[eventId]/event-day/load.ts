import "server-only";
import { getEventAccess } from "@/lib/data";
import { groupDayOf, type DayRoom, type Mark, type Slot } from "@/lib/festival-day";
import { createClient } from "@/lib/supabase/server";
import { eachDate, utcToZonedDate } from "@/lib/time";

export type DayGroup = { id: string; band_name: string; school_name: string; scratched_at: string | null };

/**
 * Everything Event day and a room's page need for a festival: the rooms on the path, every group (hosts read the
 * registrations; the rest of the team gets names only), the posted times, the team's marks (every kind), each
 * group's day, and which day to show (`?day=`, else today, else the nearest festival day).
 */
export async function loadFestivalDay(eventId: string, dayParam: string | string[] | undefined) {
  const supabase = await createClient();
  const [{ data: event }, access, { data: onTeam }] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, slug, event_type, timezone, starts_on, ends_on, status, performance_order_published, room_schedule_version")
      .eq("id", eventId)
      .maybeSingle(),
    getEventAccess(eventId),
    supabase.rpc("is_event_staff", { ev: eventId }),
  ]);
  if (!event) return { event: null } as const;

  const [{ data: roomData }, { data: slotData }, { data: markData }, { data: bandData }, { data: orderData }] = await Promise.all([
    supabase.from("rooms").select("id, name, note, path_order").eq("event_id", eventId).not("path_order", "is", null).order("path_order"),
    supabase.from("room_slots").select("room_id, band_id, starts_at, ends_at").eq("event_id", eventId),
    supabase.from("group_checkins").select("band_id, room_id, kind, created_at, actor_name").eq("event_id", eventId),
    access.isHost
      ? supabase.from("bands").select("id, band_name, school_name, scratched_at").eq("event_id", eventId).order("created_at")
      : supabase.rpc("event_bands", { ev: eventId }),
    supabase.from("group_order").select("band_id, day, position").eq("event_id", eventId).order("position"),
  ]);

  const tz = event.timezone;
  const now = new Date();
  const today = utcToZonedDate(now.toISOString(), tz);
  const days = eachDate(event.starts_on, event.ends_on);
  const asked = typeof dayParam === "string" && days.includes(dayParam) ? dayParam : null;
  const day = asked ?? (days.includes(today) ? today : today < days[0] ? days[0] : days.at(-1)!);
  const groups = ((bandData ?? []) as DayGroup[]).filter((g) => !g.scratched_at);
  const slots = (slotData ?? []) as Slot[];
  const savedDay = new Map(((orderData ?? []) as { band_id: string; day: string | null }[]).map((o) => [o.band_id, o.day]));
  const dayOfGroup = new Map(groups.map((g) => [g.id, groupDayOf(g.id, slots, savedDay.get(g.id), days[0], (iso) => utcToZonedDate(iso, tz))]));
  const live = day === today;

  return {
    event,
    access,
    onTeam: onTeam === true,
    rooms: (roomData ?? []) as DayRoom[],
    slots,
    marks: (markData ?? []) as Mark[],
    groups,
    order: ((orderData ?? []) as { band_id: string; day: string | null }[]).map((o) => o.band_id),
    dayOfGroup,
    days,
    day,
    today,
    live,
    now,
    /** This day's times only, so "Up next" never crosses into another day. */
    daySlots: slots.filter((s) => dayOfGroup.get(s.band_id) === day && groups.some((g) => g.id === s.band_id)),
  } as const;
}

"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import type { MarkOp } from "@/lib/festival-day";
import { createClient } from "@/lib/supabase/server";

const KINDS = new Set(["in", "done", "no_show"]);

/** Group events: mark a group arrived (roomId null) or done in a room, or take the tap back. (The earlier call.) */
export async function tapGroup(eventId: string, bandId: string, roomId: string | null, done: boolean): Promise<ActionState> {
  return markGroups(eventId, [{ band: bandId, room: roomId, kind: "done", on: done }]);
}

/**
 * Festivals on the day: one tap's marks (or Undo's), in order, through group_mark (the database checks that the
 * caller is on the event's team). Stops at the first one that fails.
 */
export async function markGroups(eventId: string, ops: MarkOp[]): Promise<ActionState> {
  await requireUser();
  if (!ops.length || ops.length > 4 || ops.some((o) => !KINDS.has(o.kind))) return { error: "That isn't a mark." };
  const supabase = await createClient();
  for (const o of ops) {
    const { error } = await supabase.rpc("group_mark", { p_band: o.band, p_room: o.room, p_kind: o.kind, p_on: o.on });
    if (error) return { error: friendlyDbError(error) };
  }
  done(eventId, ops.map((o) => o.band));
  return { ok: true };
}

/** "Done, [next group] is in" (or "Done, next group isn't here yet" with no next group): both marks or neither. */
export async function handOff(eventId: string, roomId: string, doneBand: string | null, nextBand: string | null): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("group_room_handoff", { p_room: roomId, p_done_band: doneBand, p_next_band: nextBand });
  if (error) return { error: friendlyDbError(error) };
  done(eventId, [doneBand, nextBand].filter((b): b is string => Boolean(b)));
  return { ok: true };
}

/** A room's door link: a new one (the old one stops working), for hosts and co-hosts. */
export async function newDoorLink(eventId: string, roomId: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("room_door_link_new", { p_room: roomId });
  if (error) return { error: error.code === "42501" ? "Only the festival's hosts and co-hosts can make a door link." : friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}/event-day/room/${roomId}`);
  return { ok: true };
}

/** Turn a room's door link off: it stops working right away. */
export async function doorLinkOff(eventId: string, roomId: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("room_door_link_off", { p_room: roomId });
  if (error) return { error: error.code === "42501" ? "Only the festival's hosts and co-hosts can turn off a door link." : friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}/event-day/room/${roomId}`);
  return { ok: true };
}

function done(eventId: string, bands: string[]) {
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  for (const b of new Set(bands)) revalidatePath(`/dashboard/bands/${b}`);
}

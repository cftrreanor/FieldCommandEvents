"use server";

import type { ActionState } from "@/lib/action-state";
import { friendlyDbError } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";

const NOT_WORKING = "This door link isn't working. Ask the organizer for a new one.";

// A room's door link (no sign-in): marks groups in that one room only. The database takes the room from the link
// and checks it's still on (room_door_mark, room_door_handoff).

export async function doorMark(token: string, bandId: string, kind: "in" | "done", on: boolean): Promise<ActionState> {
  if (kind !== "in" && kind !== "done") return { error: "That isn't a mark." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("room_door_mark", { p_token: token, p_band: bandId, p_kind: kind, p_on: on });
  if (error) return { error: error.code === "42501" ? NOT_WORKING : friendlyDbError(error) };
  return { ok: true };
}

export async function doorHandOff(token: string, doneBand: string | null, nextBand: string | null): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("room_door_handoff", { p_token: token, p_done_band: doneBand, p_next_band: nextBand });
  if (error) return { error: error.code === "42501" ? NOT_WORKING : friendlyDbError(error) };
  return { ok: true };
}

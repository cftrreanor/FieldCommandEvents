"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { MAX_OTHERS } from "@/lib/group-signup";
import { createClient } from "@/lib/supabase/server";

export async function setCheckedIn(eventId: string, assignmentId: string, checkedIn: boolean): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("check_in_volunteer", { p_assignment_id: assignmentId, p_checked_in: checkedIn });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true };
}

/** Someone showed up to help (maybe with others): add them to a shift, checked in. Only a name is needed. */
export async function addWalkUp(
  eventId: string,
  shiftId: string,
  overCapacity: boolean,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const name = String(formData.get("fullName") ?? "").trim();
  if (name.length < 1) return { error: "Please enter their name." };
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) return { error: "That phone number doesn't look right. Use 10 digits, or leave it blank." };
  let companions: { name: string; minor: boolean }[] = [];
  try {
    companions = JSON.parse(String(formData.get("companions") ?? "[]"));
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
  if (!Array.isArray(companions) || companions.length > MAX_OTHERS) return { error: `You can add up to ${MAX_OTHERS} other people.` };
  if (companions.some((c) => !String(c?.name ?? "").trim())) return { error: "Please enter a name for everyone you're adding." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_walk_up", {
    p_shift_id: shiftId,
    p_full_name: name,
    p_phone: phone,
    p_over_capacity: overCapacity,
    p_minor: formData.get("minor") === "on",
    p_companions: companions.map((c) => ({ name: String(c.name).trim(), minor: Boolean(c.minor) })),
  });
  if (error) {
    if (error.code === "P0004") return { error: "This shift just filled up. Tap Add again to add them anyway." };
    return { error: friendlyDbError(error) };
  }
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  const n = 1 + companions.length;
  return { ok: true, message: n > 1 ? `${n} people added and checked in.` : `${name} is added and checked in.` };
}

/** A no-show: take them off the shift so a walk-up can have the spot. */
export async function releaseSpot(eventId: string, assignmentId: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_assignment", { p_assignment_id: assignmentId });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import { eventForShare, shareLink } from "@/lib/share";
import { createClient } from "@/lib/supabase/server";
import { zonedToUtc } from "@/lib/time";

/** At the door, after looking at one adult's photo ID (or undo). Refused for someone sent to the front office. */
export async function setParentCheckedIn(eventId: string, adultId: string, checkedIn: boolean): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_parent_adult_checked_in", { p_adult: adultId, p_in: checkedIn });
  if (error) return { error: error.code === "P0001" ? error.message : friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true };
}

/**
 * Hosts and Co-hosts: "Stop Ben at the door" (on) or "Let Ben check in" (off). The door shows "Please ask Ben to go
 * to the front office." instead of Check in. Marking someone already checked in clears their check-in. No reason is
 * saved.
 */
export async function setParentFrontOffice(eventId: string, adultId: string, on: boolean): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_parent_adult_front_office", { p_adult: adultId, p_on: on });
  if (error) return { error: error.code === "P0001" ? error.message : friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true };
}

/** Hosts and Co-hosts: "Save name" (a fixed First and Last) or "It's right" (the same name, confirmed). */
export async function saveParentAdultName(eventId: string, adultId: string, first: string, last: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_parent_adult_name", { p_adult: adultId, p_first: first, p_last: last });
  if (error) return { error: error.code === "P0001" ? error.message : friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}/parents`);
  return { ok: true };
}

/** The report's Print button: notes "printed or downloaded by" (the download itself is noted by the download route). */
export async function noteParentReportPrinted(eventId: string, rows: number): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_parent_download", { p_event: eventId, p_kind: "report_print", p_rows: rows });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}/parents`);
  return { ok: true };
}

/** Hosts open or close parent registration. */
export async function setParentRegistrationOpen(eventId: string, open: boolean): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("events").update({ parent_registration_open: open }).eq("id", eventId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "Only the event's host can open or close registration." };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  const event = open ? await eventForShare(eventId) : null;
  if (!event) return { ok: true };
  return {
    ok: true,
    share: await shareLink(
      "Parent registration is open",
      `/e/${event.slug}/parents`,
      "Send this link to families, or put the QR code in your newsletter. Parents register each child who's coming.",
    ),
  };
}

/**
 * Registration settings, saved together: when registration closes on its own
 * (blank for never; in the event's time zone) and whether parents who didn't
 * register can still come.
 */
export async function saveParentSettings(eventId: string, timezone: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const date = String(formData.get("date") ?? "").trim();
  const time = String(formData.get("time") ?? "").trim();
  const walkIns = formData.get("walkIns") === "yes";
  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("parent_registration_closes_at").eq("id", eventId).maybeSingle();
  if (!event) return { error: "Only the event's host can change this." };
  let closesAt: string | null = null;
  if (date || time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return { error: "Pick a date and a time, or leave both blank." };
    const at = zonedToUtc(date, time, timezone);
    if (Number.isNaN(at.getTime())) return { error: "Pick a date and a time." };
    closesAt = at.toISOString();
    // A closing time that's already passed can stay as it is, but not be newly picked.
    const unchanged = event.parent_registration_closes_at && new Date(event.parent_registration_closes_at).getTime() === at.getTime();
    if (!unchanged && at <= new Date()) return { error: "Pick a closing time that hasn't passed yet." };
  }
  const { data, error } = await supabase
    .from("events")
    .update({ parent_registration_closes_at: closesAt, parent_walk_ins_allowed: walkIns })
    .eq("id", eventId)
    .select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "Only the event's host can change this." };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true, message: "Registration settings saved." };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import { slugify } from "@/lib/slug";
import { createClient } from "@/lib/supabase/server";
import { utcToZonedDate, utcToZonedTime, zonedToUtc } from "@/lib/time";

/** A YYYY-MM-DD day moved by a number of days. */
function addDays(day: string, days: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * "Copy last year's festival" (owner decisions, 2026-11-11): a new draft festival with a new name and first day,
 * then its rooms, registration settings, information for directors, and volunteer jobs and shifts copied over by
 * the database (copy_group_event_setup, which also checks it's the same account and that this person hosts both).
 * The last day, the deadline, and the shifts move by the same number of days. Not the team, groups, times, or
 * marks. Lands on the new festival's Publish step, its event page.
 */
export async function copyFestival(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const fromId = String(formData.get("fromEventId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const startsOn = String(formData.get("startsOn") ?? "");
  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "Fill this in";
  else if (name.length > 120) fieldErrors.name = "Keep the name under 120 characters";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) fieldErrors.startsOn = "Pick the first day";
  if (!/^[0-9a-f-]{36}$/.test(fromId)) return { error: "Pick a festival to copy." };

  const supabase = await createClient();
  const { data: src } = await supabase
    .from("events")
    .select("id, organization_id, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_name, venue_address, venue_place_id, venue_lat, venue_lng")
    .eq("id", fromId)
    .maybeSingle();
  if (!src || src.event_type !== "group_event") return { error: "That festival can't be copied. Pick another, or start from scratch." };
  if (!fieldErrors.startsOn && startsOn < utcToZonedDate(new Date().toISOString(), src.timezone)) fieldErrors.startsOn = "Pick today or a later date";
  if (Object.keys(fieldErrors).length) return { error: Object.values(fieldErrors)[0], fieldErrors };

  // As long as last year's: a two-day festival stays two days.
  const length = Math.round((Date.parse(src.ends_on) - Date.parse(src.starts_on)) / 864e5);
  const endsOn = addDays(startsOn, length);
  const { data: made, error } = await supabase
    .from("events")
    .insert({
      event_type: "group_event",
      classifications: [],
      organization_id: src.organization_id,
      name,
      slug: slugify(name),
      timezone: src.timezone,
      starts_on: startsOn,
      ends_on: endsOn,
      // The same hours, on the new days.
      window_start: zonedToUtc(startsOn, utcToZonedTime(src.window_start, src.timezone).slice(0, 5), src.timezone).toISOString(),
      window_end: zonedToUtc(endsOn, utcToZonedTime(src.window_end, src.timezone).slice(0, 5), src.timezone).toISOString(),
      venue_name: src.venue_name,
      venue_address: src.venue_address ?? "",
      venue_place_id: src.venue_place_id,
      venue_lat: src.venue_lat,
      venue_lng: src.venue_lng,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { error: friendlyDbError(error) };

  const { error: copyError } = await supabase.rpc("copy_group_event_setup", { p_from: src.id, p_to: made.id });
  if (copyError) {
    console.error("Copying a festival failed", copyError.code, copyError.message);
    // Nothing half-made: take the empty draft back off (only the Account Host can; otherwise it stays, and we say so).
    const { data: gone } = await supabase.from("events").delete().eq("id", made.id).select("id");
    const why = copyError.code === "P0001" || copyError.code === "42501" ? copyError.message : "The copy didn't go through. Try again in a moment.";
    return { error: gone?.length ? why : `${why} An empty draft called ${name} was made: delete it from its Event settings, or set it up yourself.` };
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard/events/${made.id}?copied=1`);
}

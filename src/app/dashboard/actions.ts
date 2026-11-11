"use server";

import { ensureDirectorContact } from "./band-registration-actions";
import { revalidatePath } from "next/cache";
import { brand } from "@/lib/brand";
import { eventTypeLabel, hasConferences, isEventType } from "@/lib/event-types";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { eventForShare, shareLink } from "@/lib/share";
import { requireUser } from "@/lib/auth";
import { emailMovedMeetings } from "@/app/e/[slug]/book/data";
import { getOrigin } from "@/lib/data";
import { normalizePhone } from "@/lib/phone";
import { slugify } from "@/lib/slug";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { asksChildName } from "@/lib/conference-settings";
import { FILES_BUCKET } from "@/lib/event-files";
import { formatDate, eachDate, isValidTimezone, utcToZonedTime, zonedToUtc } from "@/lib/time";
import { planShifts, toMinutes } from "@/lib/shift-plan";
import { loadCalendarEntries, sendShiftUpdates } from "@/lib/volunteer-emails";

// Every action re-checks who is signed in; the database's Row Level Security
// then decides what they're allowed to change.

const text = (max: number) => z.string().trim().min(1, "Required").max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const time = z.string().regex(/^\d{2}:\d{2}$/, "Pick a time");
const timezone = z.string().refine(isValidTimezone, "Pick a time zone");
/** An optional latitude/longitude; blank or invalid becomes undefined. */
const coordinate = (limit: number) =>
  z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number().min(-limit).max(limit).optional().catch(undefined),
  );

function firstIssue(error: z.ZodError) {
  const issue = error.issues[0];
  const field = issue.path.join(".");
  return field ? `${labelFor(field)}: ${issue.message}` : issue.message;
}

function labelFor(field: string) {
  const labels: Record<string, string> = {
    fullName: "Your name",
    orgName: "Organization name",
    name: "Name",
    startsOn: "Start date",
    endsOn: "End date",
    startTime: "Start time",
    endTime: "End time",
    venueAddress: "Venue",
    capacity: "Volunteers needed",
    blockHours: "Shift length",
    title: "Title",
  };
  return labels[field] ?? field;
}

/**
 * After a schedule change, email each affected volunteer an updated calendar
 * invite. Runs after the response is sent, so the host isn't kept waiting.
 */
async function notifyVolunteersOfChanges(shiftIds: string[]) {
  if (shiftIds.length === 0) return;
  const supabase = await createClient();
  const { data } = await supabase.from("volunteer_assignments").select("id").in("shift_id", shiftIds);
  const ids = (data ?? []).map((a) => a.id);
  if (ids.length === 0) return;
  const origin = await getOrigin();
  after(async () => {
    const entries = await loadCalendarEntries(ids, true);
    await sendShiftUpdates(entries, entries[0]?.timezone ?? "America/Chicago", origin);
  });
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------
const orgSchema = z.object({
  fullName: text(120),
  phone: z.string().trim(),
  // Blank for someone on their own: their events go under their name.
  orgName: z.string().trim().max(120, "Keep the name under 120 characters."),
  timezone,
});

export async function createOrganization(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = orgSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { fullName, phone, timezone: tz } = parsed.data;
  const orgName = parsed.data.orgName || fullName;

  const e164 = phone ? normalizePhone(phone) : null;
  if (phone && !e164) return { error: "Mobile phone: please enter a 10-digit US number." };

  const supabase = await createClient();
  const profile = await supabase.from("profiles").update({ full_name: fullName, phone: e164 }).eq("id", user.id);
  if (profile.error) return { error: friendlyDbError(profile.error) };

  const { error } = await supabase.rpc("create_organization", {
    org_name: orgName,
    org_slug: slugify(orgName),
    tz,
  });
  // No host invitation: the database says how to get one.
  if (error?.code === "42501") return { error: error.message };
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
const eventSchema = z
  .object({
    organizationId: z.string().uuid(),
    name: text(120),
    startsOn: date,
    endsOn: date,
    startTime: time,
    endTime: time,
    timezone,
    eventType: z.string().optional(),
    // Conferences ask for the school later, in Conference Setup (step 2), so
    // their form sends no venue fields at all.
    venueName: optionalText(120).optional(),
    venueAddress: optionalText(300).optional(),
    venuePlaceId: optionalText(300).optional(),
    venueLat: coordinate(90),
    venueLng: coordinate(180),
    // Conferences: "on" when families are asked for their child's name (the field is there when askChildNameField is).
    askChildName: z.string().optional(),
    askChildNameField: z.string().optional(),
  })
  .refine((v) => hasConferences(v.eventType) || Boolean(v.venueAddress), { message: "Required", path: ["venueAddress"] })
  .refine((v) => v.endsOn >= v.startsOn, { message: "End date can't be before the start date", path: ["endsOn"] })
  .refine((v) => v.endsOn > v.startsOn || v.endTime > v.startTime, {
    message: "End time must be after the start time",
    path: ["endTime"],
  });

export async function createEvent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = eventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const eventType = formData.get("eventType");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .insert({
      event_type: isEventType(eventType) ? eventType : "band_contest",
      // A band contest starts with no classifications: the host picks them in step 2 (Registration).
      ...(eventType === "band_contest" ? { classifications: [] } : {}),
      organization_id: v.organizationId,
      name: v.name,
      slug: slugify(v.name),
      timezone: v.timezone,
      starts_on: v.startsOn,
      ends_on: v.endsOn,
      window_start: zonedToUtc(v.startsOn, v.startTime, v.timezone).toISOString(),
      window_end: zonedToUtc(v.endsOn, v.endTime, v.timezone).toISOString(),
      venue_name: v.venueName ?? null,
      venue_address: v.venueAddress ?? "",
      venue_place_id: v.venuePlaceId ?? null,
      venue_lat: v.venuePlaceId ? (v.venueLat ?? null) : null,
      venue_lng: v.venuePlaceId ? (v.venueLng ?? null) : null,
      created_by: user.id,
      // Only when off, so new conferences still save before the 20261219000000 update.
      ...(v.askChildNameField && v.askChildName !== "on" ? { ask_child_name: false } : {}),
    })
    .select("id")
    .single();
  if (error) return { error: friendlyDbError(error) };

  // Started from a previous contest: its setup comes over (the database checks it's the same account and
  // that this person hosts both). The new contest is made either way; if copying fails, it starts empty.
  const from = String(formData.get("fromEventId") ?? "");
  let copied = "";
  if (eventType === "band_contest" && /^[0-9a-f-]{36}$/.test(from)) {
    const { error: copyError } = await supabase.rpc("copy_band_contest_setup", { p_from: from, p_to: data.id });
    if (copyError) console.error("Copying a previous band contest failed", copyError.code, copyError.message);
    copied = `?copied=${from}${copyError ? "&copy=failed" : ""}`;
  }

  revalidatePath("/dashboard");
  // Conferences and meetings go straight to their setup, where the day or weekly hours are set. A
  // volunteer event's step 2 is its jobs, and a band contest's is registration (team, emails, and maps
  // wait in Event settings). Other events go on to the rest of their guided setup (Event settings, a
  // step at a time).
  // Straight to the step itself, not Meeting setup (which would only redirect there, flashing the
  // older setup bar on the way: QA issue 350).
  redirect(
    hasConferences(eventType as string)
      ? `/dashboard/events/${data.id}/conferences/times`
      : eventType === "volunteer"
        ? `/dashboard/events/${data.id}/volunteering`
        : eventType === "band_contest"
          ? `/dashboard/events/${data.id}/bands${copied}`
          : `/dashboard/events/${data.id}/edit?setup=1&section=team`,
  );
}

export async function updateEvent(eventId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = eventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("events")
    .select("timezone, starts_on, window_start, venue_name, venue_address, name, event_type, status, band_registration_deadline")
    .eq("id", eventId)
    .maybeSingle();
  // Saving by itself is for drafts: a live event's changes can email volunteers, so they wait for Save.
  if (formData.get("autosave") === "1" && before?.status === "published")
    return { error: "This event is live now. Reload the page to edit it." };
  // A band contest's deadline falls before contest day (the database checks too): say so before saving anything.
  if (before?.event_type === "band_contest" && before.band_registration_deadline && before.band_registration_deadline >= v.startsOn)
    return { error: `The registration deadline is ${formatDate(before.band_registration_deadline)}. Move it before the new date in Registration first.` };
  // A conference's school is set in Conference Setup, not here.
  const conference = hasConferences(before?.event_type);
  if (!conference && !v.venueAddress) return { error: "Venue: Required" };
  const details = await supabase
    .from("events")
    .update({
      name: v.name,
      ...(conference
        ? // Only when it changed, so details still save before the 20261219000000 update.
          v.askChildNameField && (v.askChildName === "on") !== (await asksChildName(supabase, eventId))
          ? { ask_child_name: v.askChildName === "on" }
          : {}
        : {
            venue_name: v.venueName ?? null,
            venue_address: v.venueAddress,
            venue_place_id: v.venuePlaceId ?? null,
            venue_lat: v.venuePlaceId ? (v.venueLat ?? null) : null,
            venue_lng: v.venuePlaceId ? (v.venueLng ?? null) : null,
          }),
    })
    .eq("id", eventId)
    .select("id");
  if (details.error) return { error: friendlyDbError(details.error) };
  if (!details.data?.length) return { error: "Only the event's host can change its details." };

  // Dates, hours and time zone go through one database call that also moves
  // existing shifts so they keep their times on the new day.
  const { error } = await supabase.rpc("reschedule_event", {
    p_event_id: eventId,
    p_starts_on: v.startsOn,
    p_ends_on: v.endsOn,
    p_window_start: zonedToUtc(v.startsOn, v.startTime, v.timezone).toISOString(),
    p_window_end: zonedToUtc(v.endsOn, v.endTime, v.timezone).toISOString(),
    p_timezone: v.timezone,
  });
  if (error) return { error: friendlyDbError(error) };

  // Volunteers' calendars need updating if the day, time zone, venue or name changed.
  const changed =
    before &&
    (before.starts_on !== v.startsOn ||
      before.timezone !== v.timezone ||
      (!conference && before.venue_address !== v.venueAddress) ||
      (!conference && (before.venue_name ?? null) !== (v.venueName ?? null)) ||
      before.name !== v.name);
  // A conference's booked meetings moved with the day: email each family.
  if (conference && (before.starts_on !== v.startsOn || before.timezone !== v.timezone)) await emailMovedMeetings(eventId);
  if (changed) {
    const { data: shiftRows } = await supabase.from("shifts").select("id").eq("event_id", eventId);
    await notifyVolunteersOfChanges((shiftRows ?? []).map((r) => r.id));
  }

  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  // Saved by itself as the host types (a draft's Details): stay on the page.
  if (formData.get("autosave") === "1") return { ok: true };
  // In the guided setup, on to the next step.
  const next = String(formData.get("next") ?? "");
  redirect(next.startsWith(`/dashboard/events/${eventId}/edit?`) ? next : `/dashboard/events/${eventId}`);
}

/**
 * A band contest whose copy from a previous contest failed: try it again. The database still refuses
 * if the new contest has been set up since (jobs or bands added) or isn't a draft.
 */
export async function retryContestCopy(eventId: string, fromEventId: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("copy_band_contest_setup", { p_from: fromEventId, p_to: eventId });
  if (error) {
    console.error("Copying a previous band contest failed again", error.code, error.message);
    return { error: error.code === "P0001" ? error.message : "The setup still didn't come over. Set up registration below, or try again later." };
  }
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  redirect(`/dashboard/events/${eventId}/bands?copied=${fromEventId}`);
}

/**
 * Picked the wrong contest to start from: deletes this new contest (a draft with no bands yet) and goes
 * back to the first step, keeping its date, to pick another.
 */
export async function startContestOver(eventId: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data: ev } = await supabase.from("events").select("status, event_type, starts_on").eq("id", eventId).maybeSingle();
  const { count: bands } = await supabase.from("bands").select("id", { count: "exact", head: true }).eq("event_id", eventId);
  if (!ev || ev.status !== "draft" || ev.event_type !== "band_contest" || (bands ?? 0) > 0) {
    return { error: "This contest can't start over: it's published or has bands registered." };
  }
  const { data, error } = await supabase.from("events").delete().eq("id", eventId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "Only the Account Host can start a contest over: ask them, or keep editing this one." };
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/events/new?type=band_contest&on=${ev.starts_on}`);
}

/**
 * Deletes an event for good, with everything attached to it (the database
 * removes sign-ups, shifts, volunteers, registrations, schedules and the
 * team along with it), then its uploaded files from storage. Hosts only.
 */
export async function deleteEvent(eventId: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data: files } = await supabase.from("event_files").select("path").eq("event_id", eventId);
  const { data, error } = await supabase.from("events").delete().eq("id", eventId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "Only the Account Host can delete events." };
  const paths = (files ?? []).map((f) => f.path);
  if (paths.length) {
    const { error: removeError } = await createAdminClient().storage.from(FILES_BUCKET).remove(paths);
    if (removeError) console.error("Removing a deleted event's files from storage failed", removeError);
  }
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard?deleted=1");
}

export async function setEventPublished(eventId: string, publish: boolean): Promise<ActionState> {
  return changePublished(eventId, publish);
}

async function changePublished(eventId: string, publish: boolean, signupOpen?: boolean): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    // Publishing can set volunteer sign-up open or closed in the same step, so it never goes live half done.
    .update(publish ? { status: "published", ...(signupOpen === undefined ? {} : { volunteer_signup_open: signupOpen }) } : { status: "draft", volunteer_signup_open: false })
    .eq("id", eventId)
    .select("id, event_type");
  if (error) {
    // Plan limits say what's included and how to get more (friendlyDbError passes them through).
    if (error.code === "42501" && !error.message.startsWith("Your ")) {
      return { error: `Publishing needs an active ${brand.name} plan for your organization. Write to us at ${brand.supportEmail}.` };
    }
    return { error: friendlyDbError(error) };
  }
  if (!data?.length) return { error: "Only the event's host can publish it." };
  // Directors always have someone to call: the host's details, if no contact was saved.
  if (publish && data[0].event_type === "band_contest") await ensureDirectorContact(eventId);
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true };
}

/** Publish from a setup page, then go to the event's page (with its public link) to share it. */
export async function publishAndOpen(eventId: string): Promise<ActionState> {
  const result = await setEventPublished(eventId, true);
  if (result.error) return result;
  redirect(`/dashboard/events/${eventId}?published=1`);
}

/** Volunteer Setup's one button: publish the event, open volunteer sign-ups, then go to the event's page. */
export async function publishAndOpenSignups(eventId: string): Promise<ActionState> {
  const result = await changePublished(eventId, true, true);
  if (result.error) return result;
  redirect(`/dashboard/events/${eventId}?published=1`);
}

/** A volunteer event published with sign-up closed: people see the event, and sign-up opens when the host opens it. */
export async function publishSignupLater(eventId: string): Promise<ActionState> {
  const result = await changePublished(eventId, true, false);
  if (result.error) return result;
  redirect(`/dashboard/events/${eventId}?published=1`);
}

export async function setVolunteerSignupOpen(eventId: string, open: boolean): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .update({ volunteer_signup_open: open })
    .eq("id", eventId)
    .select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "Only the event's host can open or close sign-ups." };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  const event = open ? await eventForShare(eventId) : null;
  if (!event) return { ok: true };
  return {
    ok: true,
    share: await shareLink(
      "Volunteer sign-up is open",
      `/e/${event.slug}/volunteer`,
      "Send this link to your volunteers, or put the QR code on a flyer. They pick a shift and sign up.",
    ),
  };
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------
const stationSchema = z.object({
  name: text(80),
  location: optionalText(200),
  instructions: optionalText(2000),
});
/** A check-in sign-up's kind (blank for a regular station). */
function checkpointKind(formData: FormData) {
  const kind = z.enum(["parking", "stop", "warm_up", "gate"]).safeParse(formData.get("checkpointKind"));
  return kind.success ? kind.data : null;
}

/** Parking and check-in points: minutes before warm-up a band is due (blank: no deadline). */
function dueMinutes(formData: FormData, kind: string | null) {
  if (kind !== "parking" && kind !== "stop") return null;
  const raw = String(formData.get("dueMinutes") ?? "").trim();
  return /^\d{1,3}$/.test(raw) ? Math.min(Number(raw), 600) : null;
}

/** Spots held for adults on each shift, only when the form has the field (blank, or with Adults only on: none). */
function minAdultsOf(formData: FormData) {
  if (!formData.has("minAdults")) return {};
  const raw = String(formData.get("minAdults") ?? "").trim();
  const n = /^\d{1,2}$/.test(raw) ? Number(raw) : 0;
  const value = n > 0 && formData.get("adultsOnly") !== "on" ? Math.min(n, 50) : null;
  // Left blank and never set: don't touch it (so saving works before the 20270110000000 update too).
  if (value === null && !formData.has("minAdultsWas")) return {};
  return { min_adults: value };
}

/** School fairs: the sign-up's zone, only when the form has the Zone field. */
function zoneOf(formData: FormData) {
  if (!formData.has("zone")) return {};
  const zone = String(formData.get("zone") ?? "").trim().slice(0, 60);
  return { zone: zone || null };
}

/** The next place in the event's check-in order. */
async function nextCheckpointOrder(supabase: Awaited<ReturnType<typeof createClient>>, eventId: string) {
  const { data } = await supabase
    .from("stations")
    .select("checkpoint_order")
    .eq("event_id", eventId)
    .not("checkpoint_order", "is", null)
    .order("checkpoint_order", { ascending: false })
    .limit(1);
  return (data?.[0]?.checkpoint_order ?? 0) + 1;
}

/**
 * Step 1 of Stations & shifts: a new station, with its name and leads. Its
 * other details are filled in later, in "1. Sign-up details".
 */
export async function createStation(eventId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  // Step 1 asks only for the name and leads: the rest starts blank.
  const parsed = stationSchema.safeParse({ location: "", instructions: "", ...Object.fromEntries(formData) });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const kind = checkpointKind(formData);
  const leadIds = z.array(z.string().uuid()).max(20).safeParse(formData.getAll("leadIds"));
  if (!leadIds.success) return { error: "Something went wrong with the Coordinators. Please try again." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stations")
    .insert({
      event_id: eventId,
      name: v.name,
      station_type: kind ? "active_checkpoint" : "passive",
      checkpoint_kind: kind,
      checkpoint_order: kind ? await nextCheckpointOrder(supabase, eventId) : null,
      due_minutes_before_warm_up: dueMinutes(formData, kind),
      location: v.location,
      instructions: v.instructions,
      adults_only: formData.get("adultsOnly") === "on",
      ...minAdultsOf(formData),
      ...zoneOf(formData),
      // Items to bring (a potluck's desserts) instead of time slots. Only plain sign-ups can be.
      ...(formData.get("signupKind") === "items" && !kind ? { signup_kind: "items" } : {}),
    })
    .select("id")
    .single();
  if (error) return { error: friendlyDbError(error) };
  for (const userId of leadIds.data) {
    const { error: addError } = await supabase.from("station_leads").insert({ station_id: data.id, user_id: userId, event_id: eventId });
    if (addError) return { error: friendlyDbError(addError) };
  }

  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return {
    ok: true,
    message: `Added “${v.name}”.`,
    // Volunteer Setup's "+ Add sign-up" tab: straight on to the new sign-up's own tab, without jumping to the top.
    ...(formData.get("openTab") ? { goTo: `/dashboard/events/${eventId}/volunteering?station=${data.id}` } : {}),
  };
}

export async function updateStation(
  eventId: string,
  stationId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = stationSchema.safeParse({ location: "", ...Object.fromEntries(formData) });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const leadIds = z.array(z.string().uuid()).max(20).safeParse(formData.getAll("leadIds"));
  if (!leadIds.success) return { error: "Something went wrong with the Coordinators. Please try again." };

  const supabase = await createClient();
  // Spots held for adults can't be more than a shift has.
  const held = minAdultsOf(formData).min_adults;
  if (held) {
    const { data: sizes } = await supabase.from("shifts").select("max_capacity").eq("station_id", stationId);
    const most = Math.max(0, ...(sizes ?? []).map((x) => x.max_capacity));
    if (most && held > most) return { error: `Adults needed can't be more than ${most}, the most spots on one shift.` };
  }
  // A station that becomes a check-in station goes to the end of the order; one that stops being one leaves it.
  // Only a form with the check-in stop field changes it (a band contest's); any other form keeps what's saved.
  const kind = checkpointKind(formData);
  const stopField = formData.has("checkpointKind");
  const { data: current } = await supabase.from("stations").select("checkpoint_order").eq("id", stationId).maybeSingle();
  const order = kind ? (current?.checkpoint_order ?? (await nextCheckpointOrder(supabase, eventId))) : null;
  const { data: updated, error } = await supabase
    .from("stations")
    .update({
      name: v.name,
      ...(stopField
        ? {
            station_type: kind ? "active_checkpoint" : "passive",
            checkpoint_kind: kind,
            checkpoint_order: order,
            due_minutes_before_warm_up: dueMinutes(formData, kind),
          }
        : {}),
      // A volunteer event's job has no check-in place of its own (the event's address covers it): keep what's saved.
      ...(formData.has("location") ? { location: v.location } : {}),
      instructions: v.instructions,
      adults_only: formData.get("adultsOnly") === "on",
      ...minAdultsOf(formData),
      ...zoneOf(formData),
      // Time slots or items to bring; the database only lets it change while the sign-up is empty.
      ...(formData.get("signupKind") === "shifts" || formData.get("signupKind") === "items" ? { signup_kind: String(formData.get("signupKind")) } : {}),
      // Save sign-up marks it finished; Save for later keeps it a draft.
      ...(formData.get("intent") === "later" ? {} : { details_saved_at: new Date().toISOString() }),
    })
    .eq("id", stationId)
    .select("id");
  if (error) return { error: friendlyDbError(error) };
  // Nothing changed: the job was deleted, or this person can't edit it. Don't say it saved.
  if (!updated?.length) return { error: "This couldn't be saved. Reload the page and try again." };

  if (formData.has("leadsField")) {
    const leadError = await syncStationLeads(supabase, eventId, stationId, leadIds.data);
    if (leadError) return { error: leadError };
  }

  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  // A volunteer event's job saves itself as people type: its form says "Saved", no message needed.
  if (formData.get("noun") === "job") return { ok: true };
  return { ok: true, message: formData.get("intent") === "later" ? "Saved. Finish the rest when you're ready." : "Sign-up saved." };
}

/** A sign-up's leads become exactly these: the newly ticked are added (in the order shown), the unticked removed. */
async function syncStationLeads(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  stationId: string,
  leadIds: string[],
): Promise<string | null> {
  const { data: current } = await supabase.from("station_leads").select("user_id").eq("station_id", stationId);
  const had = new Set((current ?? []).map((r) => r.user_id));
  const want = new Set(leadIds);
  const removed = [...had].filter((id) => !want.has(id));
  if (removed.length) {
    const { error } = await supabase.from("station_leads").delete().eq("station_id", stationId).in("user_id", removed);
    if (error) return friendlyDbError(error);
  }
  for (const userId of leadIds.filter((id) => !had.has(id))) {
    const { error } = await supabase.from("station_leads").insert({ station_id: stationId, user_id: userId, event_id: eventId });
    if (error) return friendlyDbError(error);
  }
  return null;
}

/** Moves a check-in station one place earlier or later in the band's path. */
export async function moveCheckpoint(eventId: string, stationId: string, direction: "up" | "down"): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("stations")
    .select("id, checkpoint_order")
    .eq("event_id", eventId)
    .not("checkpoint_order", "is", null)
    .order("checkpoint_order");
  const list = data ?? [];
  const i = list.findIndex((s) => s.id === stationId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return { ok: true };
  // Renumber 1…n with the two swapped, so the order stays tidy.
  [list[i], list[j]] = [list[j], list[i]];
  for (const [n, s] of list.entries()) {
    if (s.checkpoint_order === n + 1) continue;
    const { error } = await supabase.from("stations").update({ checkpoint_order: n + 1 }).eq("id", s.id);
    if (error) return { error: friendlyDbError(error) };
  }
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true };
}

export async function deleteStation(eventId: string, stationId: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { count } = await supabase
    .from("shifts")
    .select("id", { count: "exact", head: true })
    .eq("station_id", stationId)
    .gt("registered_count", 0);
  if (count) return { error: "Volunteers have signed up for its shifts, so it can't be deleted. Move or remove them first." };
  const { count: claimed } = await supabase
    .from("station_items")
    .select("id", { count: "exact", head: true })
    .eq("station_id", stationId)
    .gt("claimed_count", 0);
  if (claimed) return { error: "People have signed up to bring things for it, so it can't be deleted." };

  const { error } = await supabase.from("stations").delete().eq("id", stationId);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true };
}

/** A job's Shifts / Things to bring switch: only while it has neither (the database refuses otherwise). */
export async function setSignupKind(eventId: string, stationId: string, kind: "shifts" | "items"): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("stations").update({ signup_kind: kind }).eq("id", stationId).eq("event_id", eventId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You don't have permission to do that." };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Items to bring (a station whose sign-ups are things, not times)
// ---------------------------------------------------------------------------
const itemSchema = z.object({
  name: z.string().trim().min(1, "Name the item, like Desserts").max(100, "Keep the name under 100 characters"),
  needed: z.coerce.number().int("Enter a whole number").min(1, "At least 1").max(500, "500 at most"),
});

export async function createItem(eventId: string, stationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = itemSchema.safeParse({ name: formData.get("name"), needed: formData.get("needed") });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const supabase = await createClient();
  const { count } = await supabase.from("station_items").select("id", { count: "exact", head: true }).eq("station_id", stationId);
  const { error } = await supabase
    .from("station_items")
    .insert({ station_id: stationId, event_id: eventId, name: parsed.data.name, needed: parsed.data.needed, sort_order: count ?? 0 });
  if (error) return { error: error.code === "P0001" ? error.message : friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true, message: `Added “${parsed.data.name}”.` };
}

export async function updateItem(eventId: string, itemId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = itemSchema.safeParse({ name: formData.get("name"), needed: formData.get("needed") });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("station_items")
    .update({ name: parsed.data.name, needed: parsed.data.needed })
    .eq("id", itemId)
    .select("id");
  if (error) return { error: error.code === "P0001" ? error.message : friendlyDbError(error) };
  if (!data?.length) return { error: "Only the event's hosts and Volunteer Leads can change this." };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  // Saved as they type (a volunteer event's things to bring): the row says so, no message needed.
  return formData.get("auto") ? { ok: true } : { ok: true, message: "Saved." };
}

export async function deleteItem(eventId: string, itemId: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data: item } = await supabase.from("station_items").select("claimed_count").eq("id", itemId).maybeSingle();
  if (item?.claimed_count) return { error: "People have signed up to bring this, so it can't be deleted. Lower how many are needed instead." };
  const { error } = await supabase.from("station_items").delete().eq("id", itemId);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true };
}

/** Take someone off an item (they can't make it, or signed up by mistake). */
export async function removeItemSignup(eventId: string, signupId: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("item_signups").delete().eq("id", signupId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "Only the event's hosts and Volunteer Leads can change this." };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true, message: "Removed. That spot is open again." };
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------
type EventTiming = { timezone: string; starts_on: string; ends_on: string; window_start: string; window_end: string };

async function loadEventTiming(eventId: string): Promise<EventTiming | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("timezone, starts_on, ends_on, window_start, window_end")
    .eq("id", eventId)
    .maybeSingle();
  return data;
}

const shiftSchema = z
  .object({
    // Optional when creating: a new shift is named from its start time ("Morning shift").
    title: optionalText(120),
    day: date,
    startTime: time,
    endTime: time,
    capacity: z.coerce.number().int().min(1, "At least 1").max(500),
    description: optionalText(2000),
    // Who can take it (20270102000000_group_signup.sql): adults only, or under-18s from an age.
    adultsOnly: z.preprocess((v) => v === "on", z.boolean()),
    hadAgeRules: z.preprocess((v) => v === "1", z.boolean()),
    minAge: z.preprocess(
      (v) => (v === "" || v == null ? null : Number(v)),
      z.number().int().min(5, "Minimum age: 5 to 17, or leave it blank").max(17, "Minimum age: 5 to 17, or leave it blank").nullable(),
    ),
  })
  .refine((v) => v.endTime > v.startTime, { message: "End time must be after the start time", path: ["endTime"] });

export async function createShift(
  eventId: string,
  stationId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  // Title and duties are optional (the create form leaves them out).
  const parsed = shiftSchema.safeParse({ title: "", description: "", ...Object.fromEntries(formData) });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;

  const event = await loadEventTiming(eventId);
  if (!event) return { error: "Event not found." };

  const supabase = await createClient();
  const startsAt = zonedToUtc(v.day, v.startTime, event.timezone);
  const title = v.title ?? shiftTitle(startsAt, event.timezone);
  const { error } = await supabase.from("shifts").insert({
    station_id: stationId,
    title,
    description: v.description,
    starts_at: zonedToUtc(v.day, v.startTime, event.timezone).toISOString(),
    ends_at: zonedToUtc(v.day, v.endTime, event.timezone).toISOString(),
    max_capacity: v.capacity,
    ...ageRules(v),
  });
  if (error) return { error: friendlyDbError(error) };

  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true, message: `Added “${title}”.` };
}

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time.");
const generateSchema = z.object({
  // Half-hour steps, 30 minutes to 12 hours.
  blockHours: z.coerce.number().min(0.5).max(12).refine((h) => Number.isInteger(h * 2), "Pick a shift length in half hours."),
  capacity: z.coerce.number().int().min(1, "At least 1").max(500),
  // The stretch to fill (the event's hours unless changed), and how early each later shift starts.
  fromTime: clock.optional(),
  toTime: clock.optional(),
  overlap: z.coerce.number().int().min(0).max(30).default(0),
});

/**
 * PRD §4.1: split the event's daily window (e.g. 7 AM–10 PM) into equal blocks
 * (e.g. 3 hours) for one sign-up, replacing its shifts (only while nobody has
 * signed up for any of them).
 */
export async function generateShifts(
  eventId: string,
  stationId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = generateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { blockHours, capacity, overlap } = parsed.data;

  const event = await loadEventTiming(eventId);
  if (!event) return { error: "Event not found." };

  const supabase = await createClient();
  // Auto create replaces the sign-up's shifts, as long as nobody has signed up for any of them yet.
  const { data: existing } = await supabase.from("shifts").select("id, registered_count").eq("station_id", stationId);
  if ((existing ?? []).some((s) => s.registered_count > 0)) {
    return {
      error: "Volunteers have signed up for this sign-up's time slots, so filling the day can't replace them. Edit them one at a time, or add one shift.",
    };
  }

  const from = parsed.data.fromTime ?? utcToZonedTime(event.window_start, event.timezone).slice(0, 5);
  const to = parsed.data.toTime ?? utcToZonedTime(event.window_end, event.timezone).slice(0, 5);
  const days = eachDate(event.starts_on, event.ends_on);
  if (from === to) return { error: "To has to be later than From." };
  const plan = planShifts(toMinutes(from), toMinutes(to), blockHours * 60, overlap);

  const rows: { station_id: string; title: string; starts_at: string; ends_at: string; max_capacity: number }[] = [];
  for (const day of days) {
    // Each shift from the day's midnight in the event's time zone (a To before From runs past midnight).
    const midnight = zonedToUtc(day, "00:00", event.timezone).getTime();
    for (const p of plan) {
      const starts = new Date(midnight + p.start * 60_000);
      rows.push({
        station_id: stationId,
        title: shiftTitle(starts, event.timezone),
        starts_at: starts.toISOString(),
        ends_at: new Date(midnight + p.end * 60_000).toISOString(),
        max_capacity: capacity,
      });
    }
  }

  if (rows.length === 0) return { error: "Those times leave no room for shifts. Check From and To." };
  const replaced = existing?.length ?? 0;
  // The new shifts go in first, then the old empty ones come out, so a live event's
  // only job is never left with nothing to sign up for (the database refuses that).
  const { data: old } = replaced
    ? await supabase.from("shifts").select("id").eq("station_id", stationId).eq("registered_count", 0)
    : { data: [] };
  const { error } = await supabase.from("shifts").insert(rows);
  if (error) return { error: friendlyDbError(error) };
  if (old?.length) {
    const { error: deleteError } = await supabase.from("shifts").delete().in("id", old.map((s) => s.id)).eq("registered_count", 0);
    if (deleteError) return { error: friendlyDbError(deleteError) };
  }

  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  const made = `${rows.length} shift${rows.length === 1 ? "" : "s"}`;
  return { ok: true, message: replaced ? `Replaced this sign-up's shifts with ${made}.` : `Added ${made}.` };
}

/**
 * A time slot's age rules. Sent only when there are rules to save or clear,
 * so time slots still save before the 20270102000000 database update.
 */
function ageRules(v: { adultsOnly: boolean; minAge: number | null; hadAgeRules?: boolean }) {
  if (!v.adultsOnly && v.minAge == null && !v.hadAgeRules) return {};
  return { adults_only: v.adultsOnly, min_age: v.adultsOnly ? null : v.minAge };
}

function shiftTitle(start: Date, tz: string) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(start));
  return hour < 12 ? "Morning shift" : hour < 17 ? "Afternoon shift" : "Evening shift";
}

export async function updateShift(
  eventId: string,
  shiftId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  // Title and duties are optional (the create form leaves them out).
  const parsed = shiftSchema.safeParse({ title: "", description: "", ...Object.fromEntries(formData) });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;

  const event = await loadEventTiming(eventId);
  if (!event) return { error: "Event not found." };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("shifts")
    .select("title, starts_at, ends_at")
    .eq("id", shiftId)
    .maybeSingle();
  const startsAt = zonedToUtc(v.day, v.startTime, event.timezone).toISOString();
  const endsAt = zonedToUtc(v.day, v.endTime, event.timezone).toISOString();
  const { error } = await supabase
    .from("shifts")
    .update({
      ...(v.title ? { title: v.title } : {}),
      description: v.description,
      starts_at: startsAt,
      ends_at: endsAt,
      max_capacity: v.capacity,
      ...ageRules(v),
    })
    .eq("id", shiftId);
  if (error) return { error: friendlyDbError(error) };

  const moved =
    before &&
    (new Date(before.starts_at).getTime() !== new Date(startsAt).getTime() ||
      new Date(before.ends_at).getTime() !== new Date(endsAt).getTime() ||
      (v.title !== null && before.title !== v.title));
  if (moved) await notifyVolunteersOfChanges([shiftId]);

  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true, message: "Shift saved." };
}

export async function deleteShift(eventId: string, shiftId: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data: shift } = await supabase.from("shifts").select("registered_count").eq("id", shiftId).maybeSingle();
  if (shift && shift.registered_count > 0) {
    return { error: "Volunteers have signed up for this shift, so it can't be deleted." };
  }
  const { error } = await supabase.from("shifts").delete().eq("id", shiftId);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true };
}

/** Change the kind of event (the database checks no bands, or parents, have registered). */
/** Shows or hides the account's logo and color on this event's public pages (and its badges). */
export async function setEventShowBrand(eventId: string, show: boolean): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("events").update({ show_brand: show }).eq("id", eventId).select("slug");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "Only the event's host can change this." };
  revalidatePath(`/e/${data[0].slug}`, "layout");
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true, message: show ? "Your logo and color are back on this event." : "Your logo and color are off for this event." };
}

export async function setEventType(eventId: string, type: string): Promise<ActionState> {
  await requireUser();
  if (!isEventType(type)) return { error: "Pick a kind of event." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("events").update({ event_type: type }).eq("id", eventId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "Only the event's host can change this." };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  revalidatePath("/dashboard");
  return { ok: true, message: `Done: this is now a ${eventTypeLabel(type).toLowerCase()}.` };
}

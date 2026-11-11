"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import { BAND_COLUMNS, bandColumns, parseBand, readyAt, registrationIsOpen, warmUpEndAt, type BandRow } from "@/lib/bands";
import { getEventAccess, getOrigin } from "@/lib/data";
import { normalizePhone } from "@/lib/phone";
import { groupWords, hasRooms } from "@/lib/event-types";
import { notificationEmails } from "@/lib/notify-recipients";
import { eventForShare, shareLink } from "@/lib/share";
import { emailLayout, pause, sendEmail } from "@/lib/email";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { customWords, loadSystemEmail } from "@/lib/system-email-overrides";
import { createRegistration } from "@/lib/band-registration";
import { parseFestival } from "@/lib/festival-registration";
import { sendBandInvites } from "./band-invite-actions";
import { setEventPublished } from "./actions";
import { formatDate, formatTime, utcToZonedDate, zoneAbbreviation, zonedToUtc } from "@/lib/time";

// ---------------------------------------------------------------------------
// Band directors
// ---------------------------------------------------------------------------

export async function registerBand(eventId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = parseBand(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return createRegistration(eventId, user, bandColumns(parsed.data));
}

/**
 * One-tap registration with a band's details from an earlier contest
 * (everything but that contest's scheduling conflicts).
 */
export async function registerAgain(eventId: string, sourceBandId: string): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const [{ data: source }, { data: event }] = await Promise.all([
    supabase.from("bands").select(BAND_COLUMNS).eq("id", sourceBandId).eq("director_user_id", user.id).maybeSingle(),
    supabase.from("events").select("classifications, chaperone_limit").eq("id", eventId).maybeSingle(),
  ]);
  if (!source || !event) return { error: "We couldn't find that registration. Please fill in the form instead." };
  const b = source as BandRow;
  if (!event.classifications.includes(b.classification)) {
    return { error: `This contest doesn't have a ${b.classification} classification. Tap “Review & edit” to pick one.` };
  }
  if (b.chaperone_count > event.chaperone_limit) {
    return { error: `This event allows ${event.chaperone_limit} chaperones per group. Tap “Review & edit” to change the number.` };
  }
  return createRegistration(eventId, user, {
    school_name: b.school_name,
    band_name: b.band_name,
    classification: b.classification,
    school_address: b.school_address,
    contact_email: b.contact_email,
    head_director_name: b.head_director_name,
    head_director_email: b.head_director_email,
    head_director_phone: b.head_director_phone,
    assistant_directors: b.assistant_directors,
    student_count: b.student_count,
    chaperone_count: b.chaperone_count,
    bus_count: b.bus_count,
    box_truck_count: b.box_truck_count,
    truck_trailer_count: b.truck_trailer_count,
    semi_truck_count: b.semi_truck_count,
    // Conflicts belong to the earlier contest's day.
    contest_day_conflicts: null,
    special_needs: b.special_needs,
  });
}

export async function updateBand(bandId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseBand(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("bands").update(bandColumns(parsed.data)).eq("id", bandId).select("id, event_id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "Registration is closed, so changes have to go through the organizer." };
  revalidatePath(`/dashboard/bands/${bandId}`);
  revalidatePath(`/dashboard/events/${data[0].event_id}/bands`);
  redirect(`/dashboard/bands/${bandId}?saved=1`);
}

/** A director changes their festival group's answers (the short form), while registration is open. */
export async function updateFestivalGroup(bandId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: band } = await supabase.from("bands").select("event_id, head_director_email").eq("id", bandId).maybeSingle();
  if (!band) return { error: "We couldn't find this group." };
  const { data: event } = await supabase
    .from("events")
    .select("classifications, ask_chaperones, ask_buses, ask_availability, chaperone_limit, starts_on, ends_on")
    .eq("id", band.event_id)
    .single();
  if (!event) return { error: "We couldn't find this festival." };
  const parsed = parseFestival(formData, event, band.head_director_email ?? user.email);
  if ("error" in parsed) return { error: parsed.error };
  // The email stays the one they registered with.
  const columns: Record<string, unknown> = { ...parsed.columns };
  delete columns.contact_email;
  delete columns.head_director_email;
  const { data, error } = await supabase.from("bands").update(columns).eq("id", bandId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "Registration is closed, so changes have to go through the organizer." };
  revalidatePath(`/dashboard/bands/${bandId}`);
  revalidatePath(`/dashboard/events/${band.event_id}/bands`);
  redirect(`/dashboard/bands/${bandId}?saved=1`);
}

/**
 * A director withdraws their band. While registration is open and times
 * aren't posted, the registration is removed. After that, the band stays on
 * the schedule marked withdrawn, so the posted order isn't left with a gap.
 * Either way, the organizer gets an email.
 */
export async function withdrawBand(bandId: string): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: band } = await supabase
    .from("bands")
    .select("id, event_id, band_name, school_name, director_user_id, scratched_at")
    .eq("id", bandId)
    .maybeSingle();
  if (!band || band.director_user_id !== user.id) return { error: "Only the band's director can withdraw it." };
  const { data: event } = await supabase
    .from("events")
    .select("name, status, event_type, timezone, band_registration_open, band_registration_deadline, band_registration_opens_on, performance_order_published")
    .eq("id", band.event_id)
    .maybeSingle();
  if (!event) return { error: "We couldn't find this event." };

  const remove = registrationIsOpen(event) && !event.performance_order_published;
  if (remove) {
    const { data, error } = await supabase.from("bands").delete().eq("id", bandId).select("id");
    if (error) return { error: friendlyDbError(error) };
    if (!data?.length) return { error: "We couldn't withdraw the band. Please try again." };
  } else if (!band.scratched_at) {
    const { error } = await supabase.rpc("withdraw_my_band", { p_band: bandId });
    if (error)
      return {
        error:
          error.code === "PGRST202" || error.code === "42883"
            ? "Withdrawing is being set up. Please contact the organizer for now."
            : friendlyDbError(error),
      };
  }

  const origin = await getOrigin();
  const one = hasRooms(event.event_type) ? "group" : "band";
  after(async () => {
    const to = await organizerEmails(band.event_id);
    if (!to.length) return;
    const custom = customWords("band_withdrew", await loadSystemEmail("band_withdrew"), {
      band_name: band.band_name,
      school: band.school_name,
      event_name: event.name,
    });
    const { html, text } = emailLayout({
      heading: custom?.heading || `${band.band_name} withdrew`,
      paragraphs: [
        ...(custom?.paragraphs ?? [`${band.band_name} (${band.school_name}) withdrew from ${event.name}.`]),
        remove
          ? `Their registration was removed.`
          : one === "group"
            ? `They're marked withdrawn on your group list. Their room times stay on the schedule until you change it. If this looks like a mistake, contact the director.`
            : `They're marked withdrawn on your schedule and band list, so you can adjust the schedule if you need to. If this looks like a mistake, contact the director.`,
      ],
      button: { label: custom?.button || `See your ${one}s`, url: `${origin}/dashboard/events/${band.event_id}/bands` },
    });
    for (const address of to) {
      await sendEmail({ to: address, subject: custom?.subject || `${band.band_name} withdrew from ${event.name}`, html, text });
      await pause();
    }
  });

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/events/${band.event_id}/bands`);
  if (remove) redirect("/dashboard?withdrawn=1");
  revalidatePath(`/dashboard/bands/${bandId}`);
  redirect(`/dashboard/bands/${bandId}?withdrawn=1`);
}

/**
 * Who hears about a withdrawal: the people the hosts picked to get
 * notifications, or else the organizer's contact for directors, or else the
 * account's hosts.
 */
async function organizerEmails(eventId: string): Promise<string[]> {
  return notificationEmails(eventId, "band_withdrew", () => contactOrHosts(eventId));
}

async function contactOrHosts(eventId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data: contact } = await admin.from("event_director_contacts").select("email").eq("event_id", eventId).maybeSingle();
  if (contact?.email) return [contact.email];
  const { data: event } = await admin.from("events").select("organization_id").eq("id", eventId).maybeSingle();
  if (!event) return [];
  const { data: members } = await admin
    .from("organization_members")
    .select("profiles(email)")
    .eq("organization_id", event.organization_id);
  return ((members ?? []) as unknown as { profiles: { email: string | null } | null }[])
    .map((m) => m.profiles?.email)
    .filter((e): e is string => Boolean(e));
}

// ---------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------

async function updateEventRow(eventId: string, values: Record<string, unknown>): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("events").update(values).eq("id", eventId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "Only the event's host can change this." };
  revalidatePath(`/dashboard/events/${eventId}/bands`);
  revalidatePath(`/dashboard/events/${eventId}/schedule`);
  revalidatePath(`/dashboard/events/${eventId}`);
  return { ok: true };
}

export async function setBandRegistrationOpen(eventId: string, open: boolean) {
  const result = await updateEventRow(eventId, { band_registration_open: open });
  return result.error || !open ? result : registrationShare(eventId);
}

/**
 * Band Registration's one button before the event is live: publish it and open
 * registration, then the link to send directors, on the Registered bands tab.
 */
export async function publishAndOpenBandRegistration(eventId: string): Promise<ActionState> {
  // Opening with a deadline that's already passed would close registration straight away.
  const supabase = await createClient();
  const { data: ev } = await supabase.from("events").select("timezone, band_registration_deadline").eq("id", eventId).maybeSingle();
  if (ev?.band_registration_deadline && ev.band_registration_deadline < utcToZonedDate(new Date().toISOString(), ev.timezone))
    return { error: "The registration deadline has passed. Pick a new one in Registration first." };
  const published = await setEventPublished(eventId, true);
  if (published.error) return published;
  const opened = await updateEventRow(eventId, { band_registration_open: true });
  // On to the event page, which leads with how to get the word out.
  return opened.error ? opened : { ok: true, goTo: `/dashboard/events/${eventId}?published=1` };
}

/** Registration set to open on a later day: open it today instead. */
export async function openBandRegistrationNow(eventId: string): Promise<ActionState> {
  const result = await updateEventRow(eventId, { band_registration_opens_on: null, band_registration_open: true });
  if (result.error) return result;
  // Invitations that were waiting for the opening day go out now.
  const supabase = await createClient();
  const { data: waiting } = await supabase.from("band_invitations").select("email").eq("event_id", eventId).is("sent_at", null).not("scheduled_for", "is", null);
  if (waiting?.length) await sendBandInvites(eventId, waiting.map((w) => w.email));
  return registrationShare(eventId);
}

/** Registration just opened: the link to send directors. */
async function registrationShare(eventId: string): Promise<ActionState> {
  const event = await eventForShare(eventId);
  if (!event) return { ok: true };
  const w = groupWords(event.event_type);
  return {
    ok: true,
    share: await shareLink(
      `${w.One} registration is open`,
      `/e/${event.slug}/${hasRooms(event.event_type) ? "register" : "bands"}`,
      `Send this link to ${w.one} directors. Directors you invite by email start from their invitation, with their details filled in.`,
    ),
  };
}

/**
 * Reopen registration after its deadline passed (closed too early, or
 * directors asked for more time): a new deadline, or none.
 */
export async function reopenBandRegistration(eventId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const deadline = String(formData.get("deadline") ?? "");
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return { error: "Pick a valid deadline date." };
  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("timezone, event_type").eq("id", eventId).maybeSingle();
  // A band contest always has a deadline (the database checks too).
  if (!deadline && event?.event_type === "band_contest") return { error: "Pick a new deadline to reopen registration." };
  if (deadline && event && deadline < utcToZonedDate(new Date().toISOString(), event.timezone))
    return { error: "Pick today or a later date for the new deadline." };
  const result = await updateEventRow(eventId, { band_registration_open: true, band_registration_deadline: deadline || null });
  return result.error ? result : registrationShare(eventId);
}

export async function updateBandSettings(eventId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      chaperoneLimit: z.coerce.number().int().min(0).max(500),
      classifications: z
        .string()
        .transform((v) => [...new Set(v.split(",").map((s) => s.trim()).filter(Boolean))])
        .refine((v) => v.length > 0, "Add at least one classification"),
      deadline: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid deadline date")]),
      directorInfo: z.string().trim().max(3000, "Information for directors is too long (3,000 characters max)"),
      contactName: z.string().trim().max(150),
      contactPhone: z
        .string()
        .trim()
        .transform((v, ctx) => {
          if (!v) return "";
          const p = normalizePhone(v);
          if (!p) ctx.addIssue({ code: "custom", message: "Contact phone: enter a 10-digit number" });
          return p ?? "";
        }),
      contactEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email("Contact email isn't valid")]),
    })
    .safeParse({
      deadline: "",
      directorInfo: "",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      ...Object.fromEntries(formData),
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const result = await updateEventRow(eventId, {
    chaperone_limit: v.chaperoneLimit,
    classifications: v.classifications,
    band_registration_deadline: v.deadline || null,
    director_info: v.directorInfo || null,
  });
  if (result.error) return result;
  const supabase = await createClient();
  const { error } = await supabase.from("event_director_contacts").upsert({
    event_id: eventId,
    name: v.contactName,
    phone: v.contactPhone,
    email: v.contactEmail,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: friendlyDbError(error) };
  return { ok: true, message: "Settings saved." };
}

const timesSchema = z.object({
  band_id: z.union([z.string().uuid(), z.literal("")]),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  warmUp: z.string().regex(/^(\d{2}:\d{2})?$/),
  warmUpMinutes: z.number().int().min(0).max(240).refine((m) => m % 15 === 0, "Warm-up length must be in 15-minute steps"),
  perform: z.string().regex(/^(\d{2}:\d{2})?$/),
  location: z.string().trim().max(120),
});

const readyMinutes = (label: string) =>
  z
    .string()
    .regex(/^\d{1,2}$/, `${label} ready position: enter a number of minutes from 0 to 60.`)
    .transform(Number)
    .pipe(z.number().max(60, `${label} ready position: enter a number of minutes from 0 to 60.`));

const scheduleSchema = z.object({
  readyMinutes: readyMinutes("Preliminaries"),
  finalsReadyMinutes: readyMinutes("Finals"),
  slots: z.array(timesSchema.extend({ band_id: z.string().uuid() })),
  breaks: z
    .array(
      z.object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        start: z.string().regex(/^\d{2}:\d{2}$/, "Each break needs a start time."),
        minutes: z.string().regex(/^\d{1,3}$/, "Each break needs a length in minutes.").transform(Number)
          .pipe(z.number().min(5, "Breaks must be at least 5 minutes.").max(480, "Breaks can be at most 8 hours.")),
        label: z.string().trim().max(80).transform((v) => v || "Break"),
      }),
    )
    .max(30),
  finals: z.array(timesSchema).max(30),
});

/** Bands whose published times a save changed, so the host can tell their directors. */
export type ChangedBands = { order: string[]; finals: string[] };
export type ScheduleSaveState = ActionState & { changed?: ChangedBands };

type SlotTimes = {
  band_id: string | null;
  warm_up_at: string | null;
  warm_up_minutes: number | null;
  perform_at: string | null;
  warm_up_location: string | null;
};
const sameInstant = (a: string | null, b: string | null) => (a && b ? new Date(a).getTime() === new Date(b).getTime() : a === b);
const sameTimes = (a: SlotTimes, b: SlotTimes) =>
  sameInstant(a.warm_up_at, b.warm_up_at) &&
  sameInstant(a.perform_at, b.perform_at) &&
  (a.warm_up_minutes ?? null) === (b.warm_up_minutes ?? null) &&
  (a.warm_up_location ?? null) === (b.warm_up_location ?? null);

/** Save the whole schedule. Times arrive as the event's local wall-clock times. */
export async function saveSchedule(eventId: string, scheduleJson: string): Promise<ScheduleSaveState> {
  await requireUser();
  let raw: unknown;
  try {
    raw = JSON.parse(scheduleJson);
  } catch {
    raw = null;
  }
  const parsed = scheduleSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues.find((i) => !i.message.startsWith("Invalid"));
    return { error: issue?.message ?? "Something about the schedule wasn't valid. Please try again." };
  }

  const supabase = await createClient();
  // The schedule as it was, to tell which published bands' times change.
  const [{ data: event }, { data: oldSlots }, { data: oldFinals }] = await Promise.all([
    supabase.from("events").select("timezone, ready_minutes_before, finals_ready_minutes_before, performance_order_published, finalists_revealed").eq("id", eventId).single(),
    supabase.from("performance_slots").select("band_id, performance_order, warm_up_at, warm_up_minutes, perform_at, warm_up_location").eq("event_id", eventId),
    supabase.from("finals_slots").select("slot_number, band_id, warm_up_at, warm_up_minutes, perform_at, warm_up_location").eq("event_id", eventId),
  ]);
  if (!event) return { error: "Event not found." };
  const toUtc = (day: string, time: string) => (time ? zonedToUtc(day, time, event.timezone).toISOString() : null);
  const times = (s: z.infer<typeof timesSchema>) => ({
    band_id: s.band_id || null,
    warm_up_at: toUtc(s.day, s.warmUp),
    warm_up_minutes: s.warmUpMinutes || null,
    perform_at: toUtc(s.day, s.perform),
    warm_up_location: s.location || null,
  });
  const newSlots = parsed.data.slots.map(times);
  const newFinals = parsed.data.finals.map(times);
  const { error } = await supabase.rpc("save_schedule", {
    p_event_id: eventId,
    p_ready_minutes: parsed.data.readyMinutes,
    p_finals_ready_minutes: parsed.data.finalsReadyMinutes,
    p_slots: newSlots,
    p_breaks: parsed.data.breaks.map((b) => ({ starts_at: toUtc(b.day, b.start), minutes: b.minutes, label: b.label })),
    p_finals: newFinals,
  });
  if (error) {
    if (error.code === "23505") return { error: "The same band is picked for two finals slots." };
    return { error: friendlyDbError(error) };
  }
  revalidatePath(`/dashboard/events/${eventId}/schedule`);

  // A new ready position changes every band's ready time in that round.
  const readyChanged = parsed.data.readyMinutes !== event.ready_minutes_before;
  const finalsReadyChanged = parsed.data.finalsReadyMinutes !== event.finals_ready_minutes_before;
  const changed: ChangedBands = { order: [], finals: [] };
  if (event.performance_order_published) {
    const before = new Map((oldSlots ?? []).map((o) => [o.band_id, o]));
    newSlots.forEach((n, i) => {
      const o = before.get(n.band_id!);
      if (readyChanged || !o || o.performance_order !== i + 1 || !sameTimes(o, n)) changed.order.push(n.band_id!);
    });
  }
  // Finalists only hear about their finals times once they're revealed.
  if (event.finalists_revealed) {
    const before = new Map((oldFinals ?? []).filter((o) => o.band_id).map((o) => [o.band_id, o]));
    newFinals.forEach((n, i) => {
      if (!n.band_id) return;
      const o = before.get(n.band_id);
      if (finalsReadyChanged || !o || o.slot_number !== i + 1 || !sameTimes(o, n)) changed.finals.push(n.band_id);
    });
  }
  return { ok: true, message: "Schedule saved.", ...(changed.order.length || changed.finals.length ? { changed } : {}) };
}

type EmailEvent = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  venue_name: string | null;
  venue_address: string;
  ready_minutes_before: number;
  finals_ready_minutes_before: number;
  finals_published: boolean;
};
type EmailSlot = {
  label: string;
  warm_up_at: string | null;
  warm_up_minutes: number | null;
  perform_at: string | null;
  warm_up_location: string | null;
  bands: { band_name: string; school_name: string; contact_email: string; head_director_email: string } | null;
};

const EMAIL_EVENT_COLUMNS = "id, name, slug, timezone, venue_name, venue_address, ready_minutes_before, finals_ready_minutes_before, finals_published";
const EMAIL_BAND_COLUMNS = "bands(band_name, school_name, contact_email, head_director_email)";

/** Email each band's director their times. Runs after the response is sent. */
function emailTimes(event: EmailEvent, slots: EmailSlot[], origin: string, round: "order" | "finals", kind: "posted" | "changed" = "posted") {
  const readyMin = round === "finals" ? event.finals_ready_minutes_before : event.ready_minutes_before;
  // Name the round once there are finals, so a finalist can tell the two sets of times apart.
  const roundWord = round === "finals" ? "finals " : event.finals_published ? "preliminary " : "";
  after(async () => {
    // An admin's wording (/admin/emails), if they saved one.
    const key = kind === "changed" ? "director_times_changed" : round === "finals" ? "director_finals_posted" : "director_times_posted";
    const saved = await loadSystemEmail(key);
    const tz = event.timezone;
    const at = (iso: string | null) =>
      iso ? `${formatDate(utcToZonedDate(iso, tz))}, ${formatTime(iso, tz)} ${zoneAbbreviation(iso, tz)}` : "To be announced";
    for (const s of slots) {
      if (!s.bands) continue;
      const warmEnd = warmUpEndAt(s.warm_up_at, s.warm_up_minutes);
      const custom = customWords(key, saved, {
        band_name: s.bands.band_name,
        school: s.bands.school_name,
        event_name: event.name,
        round: kind === "changed" ? roundWord.trim() : event.finals_published ? "preliminary" : "performance",
      });
      const { html, text } = emailLayout({
        heading:
          custom?.heading ||
          (kind === "changed"
            ? `Updated ${roundWord}times for ${s.bands.band_name}`
            : round === "finals"
              ? `You're in the finals at ${event.name}`
              : `Your ${roundWord || "performance "}time at ${event.name}`),
        paragraphs: custom?.paragraphs ?? [
          kind === "changed"
            ? `The organizer updated the ${roundWord}schedule for ${event.name}. Here are your current ${roundWord}times; please use these from now on.`
            : round === "finals"
              ? `Congratulations. ${s.bands.band_name} is performing in finals. Here are your finals times.`
              : `The performance order for ${event.name} is posted. Here are the times for ${s.bands.band_name}.`,
        ],
        rows: [
          { title: round === "finals" ? "Finals order" : event.finals_published ? "Preliminary order" : "Performance order", detail: s.label },
          {
            title: "Warm-up",
            detail: [at(s.warm_up_at), warmEnd ? `until ${formatTime(warmEnd, tz)} (${s.warm_up_minutes} min)` : null, s.warm_up_location]
              .filter(Boolean)
              .join(" · "),
          },
          {
            title: "Ready position",
            detail: `${at(readyAt(s.perform_at, readyMin))} (${readyMin} min before performing)`,
          },
          { title: "Performance", detail: at(s.perform_at), strong: true },
          { title: "Venue", detail: [event.venue_name, event.venue_address].filter(Boolean).join(", ") },
        ],
        button: { label: custom?.button || "See the full schedule", url: `${origin}/e/${event.slug}` },
      });
      const subject =
        custom?.subject ||
        (kind === "changed"
          ? `${round === "finals" ? "Finals time" : event.finals_published ? "Preliminary time" : "Time"} change: ${s.bands.band_name} at ${event.name}`
          : round === "finals"
            ? `Finals time: ${s.bands.band_name} at ${event.name}`
            : `${event.finals_published ? "Preliminary" : "Performance"} time: ${s.bands.band_name} at ${event.name}`);
      for (const to of new Set([s.bands.head_director_email, s.bands.contact_email])) {
        await sendEmail({ to, subject, html, text, eventId: event.id });
        await pause();
      }
    }
  });
}

/** Publish (or hide) the running order. Publishing emails every director their times. */
export async function publishRunningOrder(eventId: string, publish: boolean): Promise<ActionState> {
  const result = await updateEventRow(eventId, { performance_order_published: publish });
  if (result.error || !publish) return result;

  const supabase = await createClient();
  const [{ data: event }, { data: slots }] = await Promise.all([
    supabase.from("events").select(EMAIL_EVENT_COLUMNS).eq("id", eventId).single(),
    supabase
      .from("performance_slots")
      .select(`performance_order, warm_up_at, warm_up_minutes, perform_at, warm_up_location, ${EMAIL_BAND_COLUMNS}`)
      .eq("event_id", eventId)
      .order("performance_order"),
  ]);
  if (event) {
    const rows = ((slots ?? []) as unknown as (Omit<EmailSlot, "label"> & { performance_order: number })[]).map((s) => ({
      ...s,
      label: `#${s.performance_order}`,
    }));
    emailTimes(event, rows, await getOrigin(), "order");
  }
  return scheduleShare(eventId, "Your schedule is published", "Directors are being emailed their times. Everyone else can see the schedule on your public page.");
}

/** A schedule just went public: the public page, where it shows. */
async function scheduleShare(eventId: string, title: string, note: string): Promise<ActionState> {
  const event = await eventForShare(eventId);
  return event ? { ok: true, share: await shareLink(title, `/e/${event.slug}`, note) } : { ok: true, message: title };
}

/** Publish (or hide) the finals. Finalists are emailed separately, once they're picked. */
export async function publishFinals(eventId: string, publish: boolean): Promise<ActionState> {
  const result = await updateEventRow(eventId, publish ? { finals_published: true } : { finals_published: false, finalists_revealed: false });
  if (result.error) return result;
  return publish
    ? scheduleShare(eventId, "Finals published", "The finals times are on your public page. Finalist names stay hidden until you reveal them.")
    : { ok: true, message: "Finals hidden." };
}

/**
 * Show (or hide again) the finalist names on the public schedule and the
 * finalists' director pages. Revealing also publishes the finals times.
 */
export async function revealFinalists(eventId: string, reveal: boolean): Promise<ActionState> {
  const result = await updateEventRow(eventId, reveal ? { finals_published: true, finalists_revealed: true } : { finalists_revealed: false });
  if (result.error) return result;
  return reveal
    ? scheduleShare(eventId, "Finalists revealed", "The finalist names are on your public page now.")
    : { ok: true, message: "Finalist names hidden again." };
}

/** Email each picked finalist their finals times. */
export async function emailFinalists(eventId: string): Promise<ActionState> {
  await requireUser();
  if (!(await getEventAccess(eventId)).isHost) return { error: "Only the event's host can do this." };
  const supabase = await createClient();
  const [{ data: event }, { data: slots }] = await Promise.all([
    supabase.from("events").select(`${EMAIL_EVENT_COLUMNS}, finalists_revealed`).eq("id", eventId).single(),
    supabase
      .from("finals_slots")
      .select(`slot_number, warm_up_at, warm_up_minutes, perform_at, warm_up_location, ${EMAIL_BAND_COLUMNS}`)
      .eq("event_id", eventId)
      .not("band_id", "is", null)
      .order("slot_number"),
  ]);
  if (!event) return { error: "Event not found." };
  if (!event.finalists_revealed) return { error: "Reveal the finalists first." };
  if (!slots?.length) return { error: "Pick the finalists and save the schedule first." };
  const rows = (slots as unknown as (Omit<EmailSlot, "label"> & { slot_number: number })[]).map((s) => ({
    ...s,
    label: `Finalist #${s.slot_number}`,
  }));
  emailTimes(event, rows, await getOrigin(), "finals");
  return { ok: true, message: `Emailing ${rows.length} finalist${rows.length === 1 ? "" : "s"} their times.` };
}

/** After a save changed published times: email just those bands' directors their current times. */
export async function emailTimeChanges(eventId: string, bands: ChangedBands): Promise<ActionState> {
  await requireUser();
  if (!(await getEventAccess(eventId)).isHost) return { error: "Only the event's host can do this." };
  const ids = z.object({ order: z.array(z.string().uuid()).max(500), finals: z.array(z.string().uuid()).max(50) }).safeParse(bands);
  if (!ids.success) return { error: "Something went wrong. Please try again." };
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select(`${EMAIL_EVENT_COLUMNS}, performance_order_published, finalists_revealed`)
    .eq("id", eventId)
    .single();
  if (!event) return { error: "Event not found." };
  const columns = `warm_up_at, warm_up_minutes, perform_at, warm_up_location, ${EMAIL_BAND_COLUMNS}`;
  const [{ data: order }, { data: finals }] = await Promise.all([
    event.performance_order_published && ids.data.order.length
      ? supabase.from("performance_slots").select(`performance_order, ${columns}`).eq("event_id", eventId).in("band_id", ids.data.order)
      : Promise.resolve({ data: [] }),
    event.finalists_revealed && ids.data.finals.length
      ? supabase.from("finals_slots").select(`slot_number, ${columns}`).eq("event_id", eventId).in("band_id", ids.data.finals)
      : Promise.resolve({ data: [] }),
  ]);
  const origin = await getOrigin();
  const orderRows = ((order ?? []) as unknown as (Omit<EmailSlot, "label"> & { performance_order: number })[]).map((r) => ({
    ...r,
    label: `#${r.performance_order}`,
  }));
  const finalsRows = ((finals ?? []) as unknown as (Omit<EmailSlot, "label"> & { slot_number: number })[]).map((r) => ({
    ...r,
    label: `Finalist #${r.slot_number}`,
  }));
  if (orderRows.length) emailTimes(event, orderRows, origin, "order", "changed");
  if (finalsRows.length) emailTimes(event, finalsRows, origin, "finals", "changed");
  const n = new Set([...ids.data.order, ...ids.data.finals]).size;
  return { ok: true, message: `Emailing ${n} band director${n === 1 ? "" : "s"} their updated times.` };
}

const pushBackSchema = z.object({
  fromOrder: z.string().regex(/^\d{1,3}$/, "Pick the first band to move.").transform(Number),
  minutes: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, "Enter how many minutes.")
    .transform(Number)
    .pipe(z.number().min(1, "Enter at least 1 minute.").max(240, "Push back at most 240 minutes (4 hours).")),
});

/** Contest day, running behind: move every band from #N onward later, and tell their directors. */
export async function pushScheduleBack(eventId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = pushBackSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { fromOrder, minutes } = parsed.data;
  const includeFinals = formData.get("includeFinals") === "on";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("push_schedule_back", {
    p_event_id: eventId,
    p_from_order: fromOrder,
    p_minutes: minutes,
    p_include_finals: includeFinals,
  });
  if (error) return { error: friendlyDbError(error) };
  const rows = (data ?? []) as { round: "prelims" | "finals"; band_id: string | null }[];
  revalidatePath(`/dashboard/events/${eventId}`, "layout");

  const count = rows.filter((r) => r.round === "prelims").length;
  const moved = `Moved ${count} band${count === 1 ? "" : "s"} ${minutes} minutes later${includeFinals ? ", and the finals" : ""}.`;
  if (formData.get("email") !== "on") return { ok: true, message: moved };
  // Only directors who can already see their times (published order, revealed finalists) hear about it.
  const emailed = await emailTimeChanges(eventId, {
    order: rows.filter((r) => r.round === "prelims" && r.band_id).map((r) => r.band_id!),
    finals: rows.filter((r) => r.round === "finals" && r.band_id).map((r) => r.band_id!),
  });
  return emailed.error ? { ok: true, message: `${moved} The emails couldn't be sent: ${emailed.error}` } : { ok: true, message: `${moved} ${emailed.message}` };
}

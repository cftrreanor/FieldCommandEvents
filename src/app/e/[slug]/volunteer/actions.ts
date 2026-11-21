"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { BOT_CHECK_FAILED, botCheckConfigured, passesBotCheck } from "@/lib/bot-check";
import { confirmAgeProblem } from "@/lib/confirm-age";
import { eventPhase } from "@/lib/contest-day";
import { getOrigin } from "@/lib/data";
import { hasBooths } from "@/lib/event-types";
import { confirmSource, helpLinkSource, type HelpLinkSource } from "@/lib/help-link-source";
import { GUARDIAN_CONSENT, MAX_OTHERS, PHONE_ON_FILE } from "@/lib/group-signup";
import { googleCalendarUrl } from "@/lib/ics";
import { normalizePhone } from "@/lib/phone";
import { isSchemaError } from "@/lib/schema-check";
import { createAdminClient } from "@/lib/supabase/server";
import { formatDate, formatTime, formatTimeRange, utcToZonedDate } from "@/lib/time";
import {
  icsDownloadUrl,
  loadCalendarEntries,
  sendAddedToGroup,
  sendSignupConfirmation,
  toIcsEvent,
  type CalendarEntry,
  type GroupLine,
  type ItemLine,
  jobAndShift,
} from "@/lib/volunteer-emails";
import { addToPass, forgetPass, readPass } from "@/lib/volunteer-pass";
import { passContact } from "./remembered";

/** One added person's line on the confirmation screen. */
export type GroupConfirmation = { name: string; shifts: string[]; emailed: string | null };

export type SignupState = ActionState & {
  confirmed?: {
    email: string;
    emailSent: boolean;
    shifts: { title: string; detail: string; googleUrl: string; icsUrl: string }[];
    alreadySignedUp: number;
    /** What they're bringing. */
    items: ItemLine[];
    /** Everyone they added, each with their own shifts. */
    people: GroupConfirmation[];
    /** When the shifts just booked run, so "More from [Org]" leaves out anything at the same time. */
    booked: { startsAt: string; endsAt: string }[];
    /** An adult booked: their details carry over to another sign-up from this device. */
    carriesOver: boolean;
  };
};

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);
const age = z.number().int().min(5, "Please enter an age from 5 to 17 for anyone under 18.").max(17, "Please enter an age from 5 to 17 for anyone under 18.");

const payloadSchema = z.object({
  booker: z.object({
    name: z.string().trim().min(2, "Please enter your first and last name.").max(200),
    email: z.string().trim().toLowerCase().email("Please enter a valid email address."),
    phone: z.string().trim().min(1, "Please enter your mobile phone number."),
    minor: z.boolean(),
    age: age.nullable(),
  }),
  shiftIds: z.array(uuid).max(12, "Please pick 12 shifts or fewer."),
  // As many items as someone likes; this only stops a script sending thousands.
  items: z.array(z.object({ item: uuid, note: z.string().trim().max(200) })).max(200),
  people: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Please enter a name for everyone you're adding.").max(200),
        minor: z.boolean(),
        age: age.nullable(),
        email: z.string().trim().toLowerCase().email("Please check the email for everyone you're adding, or leave it blank.").or(z.literal("")),
        phone: z.string().trim(),
        shiftIds: z.array(uuid).min(1, "Pick at least one shift for everyone you're adding.").max(12, "Please pick 12 shifts or fewer."),
      }),
    )
    .max(MAX_OTHERS, `You can sign up yourself and up to ${MAX_OTHERS} other people.`),
  consent: z.boolean(),
});
export type SignupPayload = z.infer<typeof payloadSchema>;

/** Spots left on each shift right now, for the review screen. */
export async function currentSpots(eventId: string): Promise<Record<string, number>> {
  const { data } = await createAdminClient()
    .from("shifts")
    // stations(*): showing arrives with the 20270105000000 update. Hidden jobs aren't listed.
    .select("id, max_capacity, registered_count, stations(*)")
    .eq("event_id", eventId)
    .gt("ends_at", new Date().toISOString());
  type Row = { id: string; max_capacity: number; registered_count: number; stations: { showing?: boolean } | null };
  return Object.fromEntries(
    ((data ?? []) as unknown as Row[]).filter((s) => s.stations?.showing !== false).map((s) => [s.id, s.max_capacity - s.registered_count]),
  );
}

/**
 * Public volunteer sign-up: the booker's shifts and items, and everyone they
 * add, each on their own shifts. Runs with the server's privileged key because
 * the visitor isn't signed in; sign_up_group() checks ages and spots and
 * saves everyone together, or no one.
 */
export async function signUpVolunteer(eventId: string, _prev: SignupState, formData: FormData): Promise<SignupState> {
  // Simple bot traps: a hidden field people never fill in, and a minimum time on the page.
  const startedAt = Number(formData.get("startedAt"));
  if (String(formData.get("website") ?? "") || !startedAt || Date.now() - startedAt < 2500) {
    return { error: "Something went wrong. Please try again." };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { booker, shiftIds, items, people, consent } = parsed.data;
  // "Phone ending 0142" carried over from this device's sign-up: the number is read again here, never from the page,
  // and only for the same adult (same email) the device remembers for this account.
  const onFile = booker.phone === PHONE_ON_FILE && !booker.minor ? await passContact(await readPass(), eventId) : null;
  const carried = onFile && !onFile.minor && onFile.phone && onFile.email.toLowerCase() === booker.email.trim().toLowerCase() ? onFile.phone : null;
  if (booker.phone === PHONE_ON_FILE && !carried) return { error: "Please enter your mobile phone number." };
  const phone = normalizePhone(carried ?? booker.phone);
  if (!phone) return { error: "Please enter a 10-digit mobile phone number." };
  if (booker.minor && booker.age == null) return { error: "Please enter your age." };
  const others = [];
  for (const p of people) {
    if (p.minor && p.age == null) return { error: `Please enter ${p.name}'s age.` };
    const theirPhone = p.phone ? normalizePhone(p.phone) : null;
    if (p.phone && !theirPhone) return { error: `Please enter a 10-digit cell phone for ${p.name}, or leave it blank.` };
    others.push({ name: p.name, minor: p.minor, age: p.minor ? p.age : null, email: p.email, phone: theirPhone ?? "", shift_ids: p.shiftIds });
  }
  if (shiftIds.length === 0 && items.length === 0) return { error: "Pick at least one shift or item above." };
  const anyMinor = booker.minor || people.some((p) => p.minor);
  if (anyMinor && !consent) return { error: "Please tick the box to confirm you can sign up everyone under 18." };
  if (!(await passesBotCheck(formData))) return { error: BOT_CHECK_FAILED };

  const result = await saveSignup(
    eventId,
    { booker: { name: booker.name, email: booker.email, phone, minor: booker.minor, age: booker.minor ? booker.age : null }, shiftIds, items, people, others, consent: anyMinor },
    helpLinkSource(formData.get("via")),
  );
  delete result.code;
  return result;
}

type Other = { name: string; minor: boolean; age: number | null; email: string; phone: string; shift_ids: string[] };

/**
 * Saves a checked sign-up (sign_up_group), then remembers this device, sends the confirmation emails, and counts
 * where it came from. Shared by the sign-up form and the confirm step. `code` is the database's refusal code
 * (P0002: the shift just filled up).
 */
async function saveSignup(
  eventId: string,
  {
    booker,
    shiftIds,
    items,
    people,
    others,
    consent: anyMinor,
  }: {
    booker: { name: string; email: string; phone: string; minor: boolean; age: number | null };
    shiftIds: string[];
    items: SignupPayload["items"];
    people: SignupPayload["people"];
    others: Other[];
    consent: boolean;
  },
  source: HelpLinkSource,
): Promise<SignupState & { code?: string }> {
  const phone = booker.phone;
  const admin = createAdminClient();

  // Fairs close online sign-up on the day itself: helpers who show up go to the volunteer desk.
  const { data: ev } = await admin.from("events").select("event_type, timezone, starts_on, ends_on").eq("id", eventId).maybeSingle();
  if (ev && hasBooths(ev.event_type) && eventPhase(ev, new Date()) === "day") {
    return { error: "Online sign-up is closed on fair day. Find the volunteer desk at the fair to help today." };
  }

  // Shifts this email already had: the confirmation screen must not hand this
  // browser control over signups someone else may have made.
  const { data: before } = await admin
    .from("volunteers")
    .select("volunteer_assignments(shift_id), item_signups(item_id)")
    .eq("event_id", eventId)
    .eq("email", booker.email)
    .maybeSingle();
  const alreadyHad = new Set(((before?.volunteer_assignments ?? []) as { shift_id: string }[]).map((a) => a.shift_id));
  const itemsHad = new Set(((before as { item_signups?: { item_id: string }[] } | null)?.item_signups ?? []).map((i) => i.item_id));

  const { data: result, error } = await admin.rpc("sign_up_group", {
    p_event_id: eventId,
    p_full_name: booker.name,
    p_email: booker.email,
    p_phone: phone,
    p_shift_ids: shiftIds,
    p_minor: booker.minor,
    p_age: booker.minor ? booker.age : null,
    p_items: items,
    p_people: others,
    p_consent: anyMinor ? GUARDIAN_CONSENT : null,
  });
  if (error) {
    if (["P0001", "P0002", "P0003", "P0005", "P0006"].includes(error.code ?? "")) return { error: error.message, code: error.code };
    if (isSchemaError(error)) {
      return { error: "Sign-up isn't available right now while the organizers finish an update. Please try again later." };
    }
    console.error("sign_up_group failed", error);
    return { error: "We couldn't save your sign-up. Please try again." };
  }
  const volunteerId = (result as { booker: string }).booker;
  const addedIds = ((result as { people: string[] }).people ?? []).filter(Boolean);

  const [{ data: event }, { data: assignments }, { data: itemRows }, { data: person }, { data: addedRows }] = await Promise.all([
    admin.from("events").select("slug, name, venue_name, timezone, starts_on, ends_on").eq("id", eventId).single(),
    admin.from("volunteer_assignments").select("id, shift_id, manage_token").eq("volunteer_id", volunteerId).in("shift_id", shiftIds),
    items.length
      ? admin
          .from("item_signups")
          .select("item_id, note, manage_token, station_items(name, stations(name))")
          .eq("volunteer_id", volunteerId)
          .in("item_id", items.map((p) => p.item))
      : Promise.resolve({ data: [] }),
    admin.from("volunteers").select("full_name, email, access_token").eq("id", volunteerId).single(),
    addedIds.length
      ? admin.from("volunteers").select("id, full_name, email, volunteer_assignments(id, shift_id)").in("id", addedIds)
      : Promise.resolve({ data: [] }),
  ]);
  const brought = (itemRows ?? []) as unknown as {
    item_id: string;
    note: string | null;
    manage_token: string;
    station_items: { name: string; stations: { name: string } | null } | null;
  }[];
  const freshItems = brought.filter((b) => !itemsHad.has(b.item_id));
  const itemLines: ItemLine[] = freshItems.map((b) => ({
    name: b.station_items?.name ?? "An item",
    station: b.station_items?.stations?.name ?? "",
    note: b.note,
  }));
  const booked = (assignments ?? []) as { id: string; shift_id: string; manage_token: string }[];
  const fresh = booked.filter((a) => !alreadyHad.has(a.shift_id));

  // Remember this device: it may see and cancel the booker's own shifts. Everyone added gets their own link by email.
  await addToPass({ a: [...fresh.map((a) => a.manage_token), ...freshItems.map((b) => b.manage_token)], e: event?.slug ? [event.slug] : [] });

  const origin = await getOrigin();
  const tz = event?.timezone ?? "America/Chicago";
  const multiDay = Boolean(event && event.starts_on !== event.ends_on);
  const when = (e: { starts_at: string; ends_at: string }) =>
    [multiDay ? formatDate(utcToZonedDate(e.starts_at, tz), { year: undefined }) : null, formatTimeRange(e.starts_at, e.ends_at, tz)]
      .filter(Boolean)
      .join(" · ");

  // Everyone added, with only the shifts this sign-up gave them (someone already on the list keeps their others).
  type Added = { id: string; full_name: string; email: string | null; volunteer_assignments: { id: string; shift_id: string }[] };
  const added = ((addedRows ?? []) as Added[]).sort((a, b) => addedIds.indexOf(a.id) - addedIds.indexOf(b.id));
  const theirEntries = new Map<string, CalendarEntry[]>();
  const theirLines: GroupConfirmation[] = [];
  const addedEntries = await loadCalendarEntriesAll(
    added.flatMap((p) => {
      const wanted = new Set(people[addedIds.indexOf(p.id)]?.shiftIds ?? []);
      return p.volunteer_assignments.filter((a) => wanted.has(a.shift_id)).map((a) => a.id);
    }),
  );
  for (const p of added) {
    const wanted = new Set(people[addedIds.indexOf(p.id)]?.shiftIds ?? []);
    const mine = addedEntries.filter((e) => p.volunteer_assignments.some((a) => a.id === e.assignment_id && wanted.has(a.shift_id)));
    theirEntries.set(p.id, mine);
    theirLines.push({
      name: p.full_name,
      shifts: mine.map((e) => `${e.station_name}: ${when(e)}`),
      emailed: p.email,
    });
  }
  const groupLines: GroupLine[] = theirLines.map((l) => ({ name: l.name, shifts: l.shifts }));

  const entries = await loadCalendarEntries(booked.map((a) => a.id));
  // The email goes to the inbox owner, so it covers every selected shift. Only
  // when something new was booked: sending the same form again (or a script
  // doing it) mustn't fill someone's inbox with copies.
  const emailSent =
    fresh.length + freshItems.length + added.length > 0 &&
    (await sendSignupConfirmation(
      fresh.length ? entries : [],
      tz,
      origin,
      multiDay,
      [],
      itemLines,
      person && event
        ? {
            name: person.full_name,
            email: person.email,
            accessToken: person.access_token,
            eventId,
            eventName: event.name,
            venueName: event.venue_name,
          }
        : undefined,
      groupLines,
    ));

  // The names-free count of sign-ups by where they came from (a "More ways to help" link, the organization page,
  // or direct): one per sign-up that booked something new. Only the source and the day are kept.
  if (fresh.length + freshItems.length + added.length > 0) {
    after(async () => {
      const { error: countError } = await admin.rpc("bump_help_link_signup", { p_event: eventId, p_source: source });
      if (countError && !isSchemaError(countError)) console.error("Counting the sign-up failed", countError.message);
    });
  }

  // Each added person with an email hears from us, with their own private link.
  const bookerFirst = booker.name.split(/\s+/)[0];
  after(async () => {
    for (const p of added) {
      const mine = theirEntries.get(p.id) ?? [];
      if (p.email && mine.length) await sendAddedToGroup(mine, bookerFirst, tz, origin);
    }
  });

  const freshIds = new Set(fresh.map((a) => a.id));
  const rows = entries
    .filter((e) => freshIds.has(e.assignment_id))
    .map((e) => {
      const ics = toIcsEvent(e, origin);
      return {
        title: jobAndShift(e.station_name, e.shift_title),
        detail: [when(e), e.station_location].filter(Boolean).join(" · "),
        googleUrl: googleCalendarUrl(ics),
        icsUrl: icsDownloadUrl(origin, e.manage_token),
      };
    });

  return {
    ok: true,
    confirmed: {
      email: booker.email,
      emailSent,
      shifts: rows,
      alreadySignedUp: booked.length - fresh.length,
      items: itemLines,
      people: theirLines,
      booked: entries.filter((e) => freshIds.has(e.assignment_id)).map((e) => ({ startsAt: e.starts_at, endsAt: e.ends_at })),
      carriesOver: !booker.minor,
    },
  };
}

/** Calendar details for every shift, emails or not (added minors may have none). */
async function loadCalendarEntriesAll(assignmentIds: string[]): Promise<CalendarEntry[]> {
  if (!assignmentIds.length) return [];
  const { data, error } = await createAdminClient().rpc("calendar_entries", { p_assignment_ids: assignmentIds, p_bump: false });
  if (error) {
    console.error("calendar_entries failed", error);
    return [];
  }
  return (data ?? []) as CalendarEntry[];
}

// ---------------------------------------------------------------------------------------------------------------
// The confirm step: arriving from "More ways to help" or the organization page with ?shift=, details carried over
// from the sign-up this device remembers. Its own action (owner decision, 2026-11-20): no 2.5-second timer (a
// remembered parent can confirm at once), an invisible bot check, and limits per device, per network address, and
// per shift.
// ---------------------------------------------------------------------------------------------------------------

export type ConfirmState = SignupState & {
  /** The shift filled up before they confirmed: nothing was saved. */
  filled?: { job: string; at: string };
};

const CONFIRM_WINDOW_MS = 10 * 60 * 1000;
/** Confirms per device (or per network address, with no pass yet) in ten minutes. */
const CONFIRM_LIMIT = 6;
/** Confirms from one network address in ten minutes, whatever the device (a looser line for shared wifi). */
const CONFIRM_IP_LIMIT = 30;
/** Sign-ups on one shift in ten minutes before the confirm step sends people to the full form instead. */
const CONFIRM_SHIFT_LIMIT = 10;
const recentConfirms = new Map<string, number[]>();

/** Under the limit for this key: counts this try. Over it: false (this server's memory, a first line). */
function underLimit(key: string, limit: number) {
  const now = Date.now();
  const times = (recentConfirms.get(key) ?? []).filter((t) => now - t < CONFIRM_WINDOW_MS);
  if (times.length >= limit) return false;
  recentConfirms.set(key, [...times, now]);
  if (recentConfirms.size > 5000) recentConfirms.delete(recentConfirms.keys().next().value!);
  return true;
}

/** The visitor's address from the header our host sets (Vercel's x-real-ip), else the first forwarded hop. */
function clientIp(h: Headers) {
  return h.get("x-real-ip")?.trim() || h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
}

/**
 * The device, kept the same across sign-ups: the oldest volunteer token in its pass (new ones are added in front,
 * so this one doesn't change when a sign-up adds another), or, with no pass yet, its network address.
 */
function deviceKey(pass: { v: string[]; a: string[] }, ip: string) {
  const anchor = pass.v.at(-1) ?? pass.a.at(-1);
  return anchor ? `pass:${createHash("sha256").update(anchor).digest("hex")}` : `ip:${ip}`;
}

/** Shifts booked under one email in the last ten minutes, everywhere (the limit that survives restarts). */
async function recentBookings(email: string) {
  const since = new Date(Date.now() - CONFIRM_WINDOW_MS).toISOString();
  const { data } = await createAdminClient()
    .from("volunteers")
    .select("volunteer_assignments!inner(id)")
    .eq("email", email)
    .gte("volunteer_assignments.created_at", since);
  return ((data ?? []) as { volunteer_assignments: unknown[] }[]).reduce((n, v) => n + (v.volunteer_assignments?.length ?? 0), 0);
}

/** Sign-ups on one shift in the last ten minutes (survives restarts too). */
async function recentOnShift(shiftId: string) {
  const since = new Date(Date.now() - CONFIRM_WINDOW_MS).toISOString();
  const { count } = await createAdminClient()
    .from("volunteer_assignments")
    .select("id", { count: "exact", head: true })
    .eq("shift_id", shiftId)
    .gte("created_at", since);
  return count ?? 0;
}

const confirmSchema = z.object({
  shift: uuid,
  fresh: z.boolean(),
  adult: z.boolean(),
  name: z.string().trim().max(200),
  email: z.string().trim().toLowerCase().max(320),
  phone: z.string().trim().max(40),
});

const TOO_MANY = "That's a lot of sign-ups in a few minutes. Please wait a little, then try again.";

/**
 * Signs the remembered person (pass_contact for this event's account, read again here: never from the page) up for
 * one shift, filling in only what the device doesn't have (name, email, phone) from the form. One adult only: the
 * remembered booker is an adult, or, with no details on this device, "I'm 18 or older" is ticked (confirmAgeProblem);
 * anyone under 18 uses the full form, which checks ages and asks for a guardian's consent. Through sign_up_group like
 * every sign-up; the new shift joins this device's pass, the usual confirmation email goes out, and the sign-up is
 * counted under the confirm step's own source.
 */
export async function confirmWithPass(eventId: string, _prev: ConfirmState, formData: FormData): Promise<ConfirmState> {
  // The bot trap field still applies; the timer doesn't.
  if (String(formData.get("website") ?? "")) return { error: "Something went wrong. Please try again." };
  const parsed = confirmSchema.safeParse({
    shift: formData.get("shift"),
    fresh: formData.get("fresh") === "1",
    adult: formData.get("adult") === "1",
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
  });
  if (!parsed.success) return { error: "Something went wrong. Please try again." };
  const { shift, fresh, adult, name, email, phone: typedPhone } = parsed.data;

  const pass = await readPass();
  const remembered = fresh ? null : await passContact(pass, eventId);
  const ageProblem = confirmAgeProblem({ remembered, adultTicked: adult });
  if (ageProblem) return { error: ageProblem };
  // The first-time path leans on the invisible bot check: without it set up on the live site, it's refused.
  if (!remembered && !botCheckConfigured() && process.env.VERCEL_ENV === "production") {
    return { error: "Signing up from this link isn't available right now. Please use the full sign-up form." };
  }
  const who = {
    name: remembered?.fullName ?? name,
    email: remembered?.email ?? email,
    phone: remembered?.phone ?? typedPhone,
  };
  if (who.name.length < 2) return { error: "Please enter your first and last name." };
  if (!z.string().email().safeParse(who.email).success) return { error: "Please enter a valid email address." };
  const phone = normalizePhone(who.phone);
  if (!phone) return { error: who.phone ? "Please enter a 10-digit mobile phone number." : "Please enter your mobile phone number." };

  const ip = clientIp(await headers());
  if (!underLimit(deviceKey(pass, ip), CONFIRM_LIMIT) || (ip && !underLimit(`net:${ip}`, CONFIRM_IP_LIMIT)) || (await recentBookings(who.email)) >= 12) {
    return { error: TOO_MANY };
  }
  if (!underLimit(`shift:${shift}`, CONFIRM_SHIFT_LIMIT) || (await recentOnShift(shift)) >= CONFIRM_SHIFT_LIMIT) {
    return { error: "Lots of people are signing up for this shift right now. Please use the full sign-up form, or try again in a few minutes." };
  }
  if (!(await passesBotCheck(formData))) return { error: BOT_CHECK_FAILED };

  const admin = createAdminClient();
  const { data: picked } = await admin.from("shifts").select("id, event_id, starts_at, stations(name)").eq("id", shift).maybeSingle();
  if (!picked || picked.event_id !== eventId) return { error: "That shift isn't part of this event. Please pick another." };
  // Never one already under way (the block and the organization page leave them out too).
  if (new Date(picked.starts_at) <= new Date()) return { error: "That shift has already started. Please pick another." };

  const result = await saveSignup(
    eventId,
    { booker: { name: who.name, email: who.email, phone, minor: false, age: null }, shiftIds: [shift], items: [], people: [], others: [], consent: false },
    confirmSource(formData.get("via")),
  );
  if (result.code === "P0002") {
    const { data: ev } = await admin.from("events").select("timezone").eq("id", eventId).maybeSingle();
    const job = (picked.stations as unknown as { name: string } | null)?.name ?? "This shift";
    return { filled: { job, at: formatTime(picked.starts_at, ev?.timezone ?? "America/Chicago") } };
  }
  delete result.code;
  return result;
}

/** "Forget this device" on the confirm step: drops this browser's pass, then shows the step again with empty fields. */
export async function forgetDevice(formData: FormData) {
  await forgetPass();
  const back = String(formData.get("back") ?? "");
  redirect(/^\/e\/[a-z0-9-]+\/volunteer(\?[\w=&%-]*)?$/.test(back) ? back : "/my");
}

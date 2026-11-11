"use server";

import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { getUser } from "@/lib/auth";
import { createRegistration } from "@/lib/band-registration";
import { bandColumns, parseBand, registrationIsOpen } from "@/lib/bands";
import { getOrigin } from "@/lib/data";
import { emailLayout, sendEmail } from "@/lib/email";
import { groupWords } from "@/lib/event-types";
import { parseFestival, type FestivalColumns } from "@/lib/festival-registration";
import { createAdminClient, createClient } from "@/lib/supabase/server";

// Register first, confirm after: directors who aren't signed in fill in the
// form, then confirm with a code we email them (or that email's button).
// Nothing is registered until they do. See 20261208000000_pending_band_registrations.sql.

type Details = ReturnType<typeof bandColumns> | FestivalColumns;
type Pending = { id: string; event_id: string; email: string; details: Details; sent_at: string };

export type GuestState = ActionState & { pending?: { id: string; email: string; bandName: string } };

const KEEP_DAYS = 7;
const RESEND_SECONDS = 60;

async function loadEvent(eventId: string) {
  const { data } = await createAdminClient()
    .from("events")
    .select(
      "id, slug, name, status, event_type, timezone, starts_on, ends_on, band_registration_open, band_registration_deadline, band_registration_opens_on, chaperone_limit, classifications, ask_chaperones, ask_buses, ask_availability",
    )
    .eq("id", eventId)
    .maybeSingle();
  return data;
}

/** Email the code (and a button that does the same) to finish the registration. */
async function sendCode(pending: Pending, event: { slug: string; name: string; event_type: string | null }) {
  const admin = createAdminClient();
  // Makes the account if this is someone new; we send the email ourselves.
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: pending.email });
  if (link.error) {
    console.error("Registration code failed", link.error);
    return false;
  }
  const { email_otp: code, hashed_token: tokenHash } = link.data.properties;
  const origin = await getOrigin();
  const one = groupWords(event.event_type).one;
  const { html, text } = emailLayout({
    heading: `Your code is ${code}`,
    paragraphs: [
      `Type this code on the registration page to finish registering ${pending.details.band_name} for ${event.name}.`,
      `Or tap the button to finish on any device. The code and the button work once and expire in 1 hour. If they've expired, you can send a new code from the registration page.`,
    ],
    button: {
      label: "Confirm registration",
      url: `${origin}/e/${event.slug}/bands/confirm?${new URLSearchParams({ r: pending.id, t: tokenHash })}`,
    },
    footer: `If you didn't register a ${one} for ${event.name}, you can ignore this email. Nothing is registered until it's confirmed.`,
  });
  return sendEmail({ to: pending.email, subject: `${code} is your code to finish registering ${pending.details.band_name}`, html, text });
}

/** The form, filled in by someone who isn't signed in: hold it, and email them a code. */
export async function startGuestRegistration(eventId: string, _prev: GuestState, formData: FormData): Promise<GuestState> {
  const user = await getUser();
  const parsed = parseBand(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const details = bandColumns(parsed.data);
  // Signed in after all (another tab): register straight away.
  if (user) return createRegistration(eventId, user, details);

  const event = await loadEvent(eventId);
  if (!event || !registrationIsOpen(event)) return { error: "Registration for this event is closed. Please contact the organizer." };
  if (!event.classifications.includes(details.classification)) return { error: "Please choose one of this event's classifications." };
  if (details.chaperone_count > event.chaperone_limit) {
    return { error: `This event allows up to ${event.chaperone_limit} chaperones per ${groupWords(event.event_type).one}.` };
  }

  return hold(event, details.head_director_email, details);
}

/** Hold the answers and email a code; nothing is registered until it's confirmed. */
async function hold(event: NonNullable<Awaited<ReturnType<typeof loadEvent>>>, address: string, details: Details): Promise<GuestState> {
  const eventId = event.id;
  const admin = createAdminClient();
  const email = address.trim().toLowerCase();
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  await admin.from("pending_band_registrations").delete().lt("created_at", cutoff);
  // Their latest try replaces an earlier one for the same band.
  await admin
    .from("pending_band_registrations")
    .delete()
    .eq("event_id", eventId)
    .eq("email", email)
    .filter("details->>band_name", "eq", details.band_name);
  const { data, error } = await admin
    .from("pending_band_registrations")
    .insert({ event_id: eventId, email, details })
    .select("id, event_id, email, details, sent_at")
    .single();
  if (error || !data) return { error: error ? friendlyDbError(error) : "We couldn't save your registration. Please try again." };

  if (!(await sendCode(data as Pending, event))) return { error: "We couldn't send the email. Please try again in a moment." };
  return { ok: true, pending: { id: data.id, email, bandName: details.band_name } };
}

/** A festival's short form (board 16): signed in, it registers; otherwise hold it and email a code. */
export async function startFestivalGuest(eventId: string, _prev: GuestState, formData: FormData): Promise<GuestState> {
  const event = await loadEvent(eventId);
  if (!event || !registrationIsOpen(event)) return { error: "Registration for this festival is closed. Please contact the organizer." };
  const user = await getUser();
  const email = user?.email ?? String(formData.get("headDirectorEmail") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Your email: enter an email address we can send the code to" };
  const parsed = parseFestival(formData, event, email);
  if ("error" in parsed) return { error: parsed.error };
  if (user) return createRegistration(eventId, user, parsed.columns);
  const { data: full } = await createAdminClient().rpc("group_event_full", { ev: eventId });
  if (full) return { error: "This festival is full. Contact the organizer to ask about a spot." };
  return hold(event, email, parsed.columns);
}

async function loadPending(id: string) {
  const { data } = await createAdminClient()
    .from("pending_band_registrations")
    .select("id, event_id, email, details, sent_at")
    .eq("id", id)
    .maybeSingle();
  return data as Pending | null;
}

/** "Send a new code". */
export async function resendGuestCode(pendingId: string): Promise<ActionState> {
  const pending = await loadPending(pendingId);
  if (!pending) return { error: "This registration has expired. Please fill in the form again." };
  const waited = (Date.now() - new Date(pending.sent_at).getTime()) / 1000;
  if (waited < RESEND_SECONDS) return { error: `Please wait ${Math.ceil(RESEND_SECONDS - waited)} seconds before sending another code.` };
  const event = await loadEvent(pending.event_id);
  if (!event) return { error: "We couldn't find this event." };
  await createAdminClient().from("pending_band_registrations").update({ sent_at: new Date().toISOString() }).eq("id", pendingId);
  if (!(await sendCode(pending, event))) return { error: "We couldn't send the email. Please try again in a moment." };
  return { ok: true, message: `We sent a new code to ${pending.email}.` };
}

/** Confirmed: sign them in (making the account if new) and register the band. */
async function finish(pending: Pending, verify: { token: string } | { token_hash: string }): Promise<ActionState> {
  const supabase = await createClient();
  const current = await getUser();
  if (current && current.email.toLowerCase() !== pending.email) await supabase.auth.signOut({ scope: "local" });
  const { data, error } =
    "token" in verify
      ? await supabase.auth.verifyOtp({ email: pending.email, token: verify.token, type: "email" })
      : await supabase.auth.verifyOtp({ token_hash: verify.token_hash, type: "email" });
  if (error || !data.user) {
    return error?.status === 429
      ? { error: "Too many tries. Please wait a minute and try again." }
      : { error: "That code didn't work. Check it and try again, or send a new code." };
  }
  await createAdminClient().from("pending_band_registrations").delete().eq("id", pending.id);
  return createRegistration(pending.event_id, { id: data.user.id, email: pending.email }, pending.details, supabase);
}

/** The code, typed on the registration page. */
export async function confirmGuestRegistration(pendingId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (code.length < 6) return { error: "Enter the code from the email." };
  const pending = await loadPending(pendingId);
  if (!pending) return { error: "This registration has expired. Please fill in the form again." };
  return finish(pending, { token: code });
}

/** The email's "Confirm registration" button, on any device. */
export async function confirmGuestByLink(pendingId: string, tokenHash: string): Promise<ActionState> {
  const pending = await loadPending(pendingId);
  if (!pending) return { error: "This registration has expired or was already confirmed." };
  const result = await finish(pending, { token_hash: tokenHash });
  return result.error?.startsWith("That code")
    ? { error: "This button has expired or was already used. Send a new code below, then type it in." }
    : result;
}

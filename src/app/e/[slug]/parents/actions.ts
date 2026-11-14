"use server";

import { BOT_CHECK_FAILED, passesBotCheck } from "@/lib/bot-check";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { getOrigin } from "@/lib/data";
import { sendEmail } from "@/lib/email";
import { GRADES } from "@/lib/grades";
import { normalizePhone } from "@/lib/phone";
import { ADULTS, otherAdultNames, parentEmail, parentLink, type Child } from "@/lib/parents";
import { createAdminClient } from "@/lib/supabase/server";

const EVENT_FIELDS = "slug, name, starts_on, ends_on, window_start, window_end, timezone, venue_name, venue_address";
/** "You're already registered" emails go out at most this often per registration. */
const LINK_EMAIL_MINUTES = 10;

export type ParentState = ActionState & {
  /** existing: that email was already registered, so nothing changed (we emailed its link). updated: edited from the link. */
  confirmed?: { email: string; emailSent: boolean; children: Child[]; existing?: boolean; updated?: boolean };
  values?: { parentName: string; email: string; phone: string; otherAdults: string[]; children: Child[] };
};

const childSchema = z.object({
  name: z.string().trim().min(2, "Please enter each child's first and last name.").max(120),
  teacher: z.string().trim().min(1, "Please enter each child's teacher's last name.").max(80),
  grade: z.enum(GRADES, { message: "Please pick each child's grade." }),
});

const schema = z.object({
  parentName: z.string().trim().min(2, "Please enter your first and last name.").max(200),
  email: z.string().trim().toLowerCase().email("Please enter a valid email address."),
  phone: z.string().trim().max(30),
  otherAdults: z
    .array(z.string().trim().min(2, "Please enter each adult's first and last name.").max(120))
    .max(5, "Up to 5 other adults can come on one registration."),
  children: z.array(childSchema).min(1, "Add at least one child.").max(8, "You can register up to 8 children."),
  idAgreed: z.literal(true, { message: "Please confirm you'll bring a government-issued photo ID." }),
});

/** The form's fields, checked. */
function readForm(formData: FormData) {
  let children: Child[] = [];
  let otherAdults: string[] = [];
  try {
    children = JSON.parse(String(formData.get("children") ?? "[]"));
    otherAdults = JSON.parse(String(formData.get("otherAdults") ?? "[]"));
  } catch {
    // Reported below.
  }
  const values = {
    parentName: String(formData.get("parentName") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    otherAdults,
    children,
  };
  const parsed = schema.safeParse({ ...values, idAgreed: formData.get("idAgreed") === "on" });
  if (!parsed.success) return { values, error: parsed.error.issues[0].message };
  const phone = parsed.data.phone ? normalizePhone(parsed.data.phone) : null;
  if (parsed.data.phone && !phone) return { values, error: "Please enter a 10-digit phone number, or leave it blank." };
  return { values, data: { ...parsed.data, phone } };
}

/**
 * Public parent registration. Runs with the server's key because the parent
 * isn't signed in; register_parents() checks the event is open. An email
 * that's already registered changes nothing: that parent is emailed their own
 * link (to see or change it) instead.
 */
export async function registerParents(eventId: string, _prev: ParentState, formData: FormData): Promise<ParentState> {
  const { values, data: v, error: invalid } = readForm(formData);
  // Bots fill the hidden field or submit instantly.
  const startedAt = Number(formData.get("startedAt"));
  if (String(formData.get("website") ?? "") || !startedAt || Date.now() - startedAt < 2500) {
    return { error: "Something went wrong. Please try again.", values };
  }
  if (!v) return { error: invalid, values };
  if (!(await passesBotCheck(formData))) return { error: BOT_CHECK_FAILED, values };

  const admin = createAdminClient();
  const { data: token, error } = await admin.rpc("register_parents", {
    p_event: eventId,
    p_name: v.parentName,
    p_email: v.email,
    p_phone: v.phone,
    p_children: v.children,
    p_other_adults: v.otherAdults,
  });
  if (error) {
    if (error.code === "P0001") return { error: error.message, values };
    console.error("register_parents failed", error);
    return { error: "Something went wrong. Please try again.", values };
  }
  const { data: event } = await admin.from("events").select(EVENT_FIELDS).eq("id", eventId).single();
  const origin = await getOrigin();

  if (!token) {
    // Already registered: email that parent their own link, not too often.
    const since = new Date(Date.now() - LINK_EMAIL_MINUTES * 60_000).toISOString();
    const { data: reg } = await admin
      .from("parent_registrations")
      .update({ link_emailed_at: new Date().toISOString() })
      .eq("event_id", eventId)
      .eq("email", v.email)
      .or(`link_emailed_at.is.null,link_emailed_at.lt.${since}`)
      .select(`id, parent_name, email, children, calendar_sequence, access_token, ${ADULTS}`)
      .maybeSingle();
    let emailSent = false;
    if (event && reg) {
      const message = await parentEmail(
        "already",
        { ...reg, children: reg.children as Child[], other_adults: otherAdultNames(reg.adults) },
        event,
        parentLink(origin, event.slug, reg.access_token),
      );
      emailSent = await sendEmail({ to: reg.email, ...message, eventId });
    }
    return { ok: true, confirmed: { email: v.email, emailSent, children: [], existing: true } };
  }

  const { data: reg } = await admin.from("parent_registrations").select("id, calendar_sequence").eq("access_token", token as string).single();
  let emailSent = false;
  if (event && reg) {
    const message = await parentEmail(
      "confirmation",
      { ...reg, parent_name: v.parentName, email: v.email, children: v.children, other_adults: v.otherAdults },
      event,
      parentLink(origin, event.slug, token as string),
    );
    emailSent = await sendEmail({ to: v.email, ...message, eventId });
  }
  return { ok: true, confirmed: { email: v.email, emailSent, children: v.children } };
}

/** From the parent's own link: change the registration (the email stays the same). Sends an updated calendar invite. */
export async function updateParents(token: string, _prev: ParentState, formData: FormData): Promise<ParentState> {
  const { values, data: v, error: invalid } = readForm(formData);
  if (!v) return { error: invalid, values };
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { error: "This link isn't valid.", values };
  const admin = createAdminClient();
  const { data: eventId, error } = await admin.rpc("update_parent_registration", {
    p_token: token,
    p_name: v.parentName,
    p_phone: v.phone,
    p_children: v.children,
    p_other_adults: v.otherAdults,
  });
  if (error || !eventId) {
    if (error?.code === "P0001") return { error: error.message, values };
    console.error("update_parent_registration failed", error);
    return { error: "Something went wrong. Please try again.", values };
  }
  const [{ data: event }, { data: reg }] = await Promise.all([
    admin.from("events").select(EVENT_FIELDS).eq("id", eventId as string).single(),
    admin.from("parent_registrations").select("id, email, calendar_sequence").eq("access_token", token).single(),
  ]);
  let emailSent = false;
  if (event && reg) {
    const message = await parentEmail(
      "confirmation",
      { ...reg, parent_name: v.parentName, children: v.children, other_adults: v.otherAdults },
      event,
      parentLink(await getOrigin(), event.slug, token),
    );
    emailSent = await sendEmail({ to: reg.email, ...message, eventId: eventId as string });
  }
  revalidatePath(`/e/${event?.slug}/parents/r/${token}`);
  return { ok: true, confirmed: { email: reg?.email ?? "", emailSent, children: v.children, updated: true } };
}

/** From the parent's own link. Also removes the calendar invite. */
export async function cancelParents(token: string): Promise<ActionState> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { error: "This link isn't valid." };
  const admin = createAdminClient();
  const { data: reg } = await admin
    .from("parent_registrations")
    .select(`id, event_id, parent_name, email, children, calendar_sequence, ${ADULTS}`)
    .eq("access_token", token)
    .maybeSingle();
  const { error } = await admin.rpc("cancel_parent_registration", { p_token: token });
  if (error) {
    // Someone on it was sent to the front office: "Please contact the school to cancel this registration."
    if (error.code === "P0001") return { error: error.message };
    console.error("cancel_parent_registration failed", error);
    return { error: "Something went wrong. Please try again." };
  }
  const { data: event } = reg ? await admin.from("events").select(EVENT_FIELDS).eq("id", reg.event_id).single() : { data: null };
  if (reg && event) {
    const message = await parentEmail("canceled", { ...reg, children: reg.children as Child[], other_adults: otherAdultNames(reg.adults) }, event, `${await getOrigin()}/e/${event.slug}/parents`);
    await sendEmail({ to: reg.email, ...message, eventId: reg.event_id });
  }
  redirect(event ? `/e/${event.slug}/parents?canceled=1` : "/");
}

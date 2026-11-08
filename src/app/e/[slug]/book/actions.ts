"use server";

import { BOT_CHECK_FAILED, passesBotCheck } from "@/lib/bot-check";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { bookingEmail, bookingLink, emailTeacher, meetingWhen, type Booking } from "@/lib/conference-bookings";
import { getOrigin } from "@/lib/data";
import { pause, sendEmail } from "@/lib/email";
import { normalizePhone } from "@/lib/phone";
import { asksChildName } from "@/lib/conference-settings";
import { createAdminClient } from "@/lib/supabase/server";
import { loadBooking, loadConference } from "./data";

export type BookingValues = {
  startsAt: string;
  child: string;
  parents: { name: string; email: string; phone: string }[];
  mode: string;
  note: string;
  /** Phone calls: the number the teacher calls. */
  callPhone: string;
};

export type BookingState = ActionState & {
  values?: BookingValues;
  /** The time was taken while they were filling in the form: pick another. */
  taken?: boolean;
  /** child is null when the teacher doesn't ask for it. */
  booked?: { when: string; child: string | null; emails: string[]; emailSent: boolean; link: string };
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readForm(formData: FormData, askChild: boolean): { values: BookingValues; error?: string } {
  let parents: BookingValues["parents"] = [];
  try {
    parents = JSON.parse(String(formData.get("parents") ?? "[]"));
  } catch {
    // Reported below.
  }
  const values: BookingValues = {
    startsAt: String(formData.get("startsAt") ?? ""),
    child: String(formData.get("child") ?? "").trim(),
    parents: Array.isArray(parents) ? parents.slice(0, 4) : [],
    mode: String(formData.get("mode") ?? ""),
    note: String(formData.get("note") ?? "").trim(),
    callPhone: String(formData.get("callPhone") ?? "").trim(),
  };
  if (!values.startsAt || Number.isNaN(Date.parse(values.startsAt))) return { values, error: "Pick a time." };
  if (askChild && values.child.length < 2) return { values, error: "Please enter your child's first and last name." };
  // Without the child's name, the people booking are just people, not parents.
  const each = askChild ? "parent" : "person";
  if (!values.parents.length) return { values, error: askChild ? "Add at least one parent or guardian." : "Please enter your name and email address." };
  for (const p of values.parents) {
    if (String(p.name ?? "").trim().length < 2) return { values, error: `Please enter each ${each}'s first and last name.` };
    if (!EMAIL.test(String(p.email ?? "").trim())) return { values, error: `Please enter a valid email address for each ${each}.` };
    if (String(p.phone ?? "").trim() && !normalizePhone(String(p.phone))) {
      return { values, error: "Please enter a 10-digit phone number, or leave it blank." };
    }
  }
  if (values.note.length > 500) return { values, error: "Please keep your note under 500 characters." };
  if (values.callPhone && !normalizePhone(values.callPhone)) {
    return { values, error: "Please enter the 10-digit phone number to call you on." };
  }
  return { values };
}

/** Emails each parent on the booking. True if every email went. */
async function emailParents(kind: Parameters<typeof bookingEmail>[0], booking: Booking, eventId: string, link: string) {
  const conf = await loadConference({ id: eventId });
  if (!conf) return false;
  let all = true;
  for (const [i, p] of booking.parents.entries()) {
    if (i) await pause();
    const message = await bookingEmail(kind, booking, conf.event, conf.settings, conf.teacher, link, p);
    all = (await sendEmail({ to: p.email, ...message, eventId: conf.event.id })) && all;
  }
  return all;
}

/**
 * A family books a meeting. Runs with the server's key (families aren't signed
 * in); book_conference() checks the time is real, open and in the future.
 */
export async function bookConference(eventId: string, _prev: BookingState, formData: FormData): Promise<BookingState> {
  const askChild = await asksChildName(createAdminClient(), eventId);
  const { values, error: invalid } = readForm(formData, askChild);
  // Bots fill the hidden field or submit instantly.
  const startedAt = Number(formData.get("startedAt"));
  if (String(formData.get("website") ?? "") || !startedAt || Date.now() - startedAt < 2500) {
    return { error: "Something went wrong. Please try again.", values };
  }
  if (invalid) return { error: invalid, values };
  if (!(await passesBotCheck(formData))) return { error: BOT_CHECK_FAILED, values };

  const admin = createAdminClient();
  const { data: token, error } = await admin.rpc("book_conference", {
    p_event: eventId,
    p_starts_at: values.startsAt,
    p_child: askChild ? values.child : null,
    // Phone calls: the number to call is also the first parent's phone.
    p_parents: values.parents.map((p, i) => ({
      name: p.name.trim(),
      email: p.email.trim(),
      phone: normalizePhone((i === 0 && !p.phone?.trim() ? values.callPhone : p.phone) ?? "") ?? null,
    })),
    p_mode: values.mode || null,
    p_note: values.note || null,
    // Only phone calls send a number, so bookings work before the weekly hours update too.
    ...(values.callPhone ? { p_call_phone: normalizePhone(values.callPhone) } : {}),
  });
  if (error || !token) {
    if (error?.code === "P0001") {
      const taken = /just taken|isn't available/.test(error.message);
      return { error: error.message, values: taken ? { ...values, startsAt: "" } : values, taken };
    }
    console.error("book_conference failed", error);
    return { error: "Something went wrong. Please try again.", values };
  }

  const booking = await loadBooking(token as string);
  const conf = await loadConference({ id: eventId });
  if (!booking || !conf) return { error: "Something went wrong. Please try again.", values };
  const origin = await getOrigin();
  const link = bookingLink(origin, conf.event.slug, token as string);
  const emailSent = await emailParents("confirmation", booking, eventId, link);
  await emailTeacher("booked", booking, conf, origin);
  revalidatePath(`/e/${conf.event.slug}/book`);
  return {
    ok: true,
    booked: {
      when: meetingWhen(booking.starts_at, conf.settings.meeting_minutes, conf.event.timezone),
      child: booking.child_name,
      emails: booking.parents.map((p) => p.email),
      emailSent,
      link,
    },
  };
}

/** From the family's link: a new time (and, when there's a choice, how they'll meet; a phone call needs the number). */
export async function changeBooking(token: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const startsAt = String(formData.get("startsAt") ?? "");
  const mode = String(formData.get("mode") ?? "");
  const callPhone = String(formData.get("callPhone") ?? "").trim();
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) return { error: "Pick a time." };
  if (callPhone && !normalizePhone(callPhone)) return { error: "Please enter the 10-digit phone number to call you on." };
  const admin = createAdminClient();
  const { data: eventId, error } = await admin.rpc("change_conference_booking", {
    p_token: token,
    p_starts_at: startsAt,
    p_mode: mode || null,
    // Only a switch to a phone call sends a number, so changes work before the 20261213000000 update too.
    ...(callPhone ? { p_call_phone: normalizePhone(callPhone) } : {}),
  });
  if (error || !eventId) {
    if (error?.code === "P0001") return { error: error.message };
    console.error("change_conference_booking failed", error);
    return { error: "Something went wrong. Please try again." };
  }
  const booking = await loadBooking(token);
  const conf = await loadConference({ id: eventId as string });
  if (booking && conf) {
    const origin = await getOrigin();
    await emailParents("changed", booking, conf.event.id, bookingLink(origin, conf.event.slug, token));
    await emailTeacher("changed", booking, conf, origin);
    revalidatePath(`/e/${conf.event.slug}/book`, "layout");
  }
  return { ok: true, message: "Saved. We emailed everyone an updated calendar invite." };
}

/** From the family's link. Also removes the calendar invite. */
export async function cancelBooking(token: string): Promise<ActionState> {
  const booking = await loadBooking(token);
  if (!booking) return { error: "This link isn't valid. Your meeting may already be canceled." };
  const conf = await loadConference({ id: booking.event_id });
  const { error } = await createAdminClient().rpc("cancel_conference_booking", { p_token: token });
  if (error) {
    console.error("cancel_conference_booking failed", error);
    return { error: "Something went wrong. Please try again." };
  }
  if (conf) {
    const origin = await getOrigin();
    await emailParents("canceled", booking, conf.event.id, `${origin}/e/${conf.event.slug}/book`);
    await emailTeacher("canceled", booking, conf, origin);
    revalidatePath(`/e/${conf.event.slug}/book`);
  }
  redirect(conf ? `/e/${conf.event.slug}/book?canceled=1` : "/");
}

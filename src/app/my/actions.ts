"use server";

import { signupIsOpen, type SignupWindow } from "@/lib/volunteer-signup";
import { BOT_CHECK_FAILED, passesBotCheck } from "@/lib/bot-check";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { getUser } from "@/lib/auth";
import { getOrigin } from "@/lib/data";
import { emailLayout, sendEmail } from "@/lib/email";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { customWords, loadSystemEmail } from "@/lib/system-email-overrides";
import { formatDate, formatDateRange, formatTimeRange, utcToZonedDate } from "@/lib/time";
import { loadCalendarEntries, sendBookerHeadsUp, sendCancellation, sendShiftSwitched } from "@/lib/volunteer-emails";
import { forgetPass, hasPass, readPass } from "@/lib/volunteer-pass";

/**
 * Cancel one of my shifts: allowed with this device's pass (no login), or for
 * a signed-in volunteer whose email matches. Sends a calendar cancellation.
 */
export async function cancelMyShift(assignmentId: string): Promise<ActionState> {
  const [entry] = await loadCalendarEntries([assignmentId]);
  const booker = await whoBookedThem(assignmentId);
  const { data: link } = await createAdminClient()
    .from("volunteer_assignments")
    .select("volunteers(events(slug, status, timezone, volunteer_signup_open, volunteer_signup_opens_on))")
    .eq("id", assignmentId)
    .maybeSingle();
  const ev = (link?.volunteers as unknown as { events: SignupWindow & { slug: string } } | null)?.events;
  // Only while sign-up is open now (not waiting for its opening day).
  const signupPath = ev && signupIsOpen(ev) ? `/e/${ev.slug}/volunteer` : null;
  const pass = await readPass();
  let cancelled = false;

  if (hasPass(pass)) {
    const { data, error } = await createAdminClient().rpc("cancel_with_pass", {
      p_assignment_id: assignmentId,
      p_volunteer_tokens: pass.v,
      p_assignment_tokens: pass.a,
    });
    if (error) return { error: friendlyDbError(error) };
    cancelled = data === true;
  }
  if (!cancelled && (await getUser())) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_assignment", { p_assignment_id: assignmentId });
    if (error) return { error: friendlyDbError(error) };
    cancelled = true;
  }
  if (!cancelled) return { error: "This device doesn't have access to that shift anymore. Use the link in your email." };

  if (entry) {
    const origin = await getOrigin();
    after(() => sendCancellation(entry, entry.timezone, origin, signupPath ? `${origin}${signupPath}` : null));
  }
  if (booker) {
    const what = await shiftLabel(booker.shiftId);
    after(() => sendBookerHeadsUp(booker.booker, booker.who, { kind: "canceled", shift: what }, booker.event));
  }
  revalidatePath("/my");
  return { ok: true };
}

/**
 * Switch one of my shifts to another time or station, with this device's
 * pass. The new shift is checked like a sign-up (spots, ages, overlaps); the
 * calendar invite moves with it.
 */
export async function swapMyShift(assignmentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const shiftId = String(formData.get("shiftId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(shiftId)) return { error: "Pick a shift to switch to." };
  const pass = await readPass();
  if (!hasPass(pass)) return { error: "To switch shifts, open the link in your email on this device." };
  const booker = await whoBookedThem(assignmentId);
  const { data, error } = await createAdminClient().rpc("swap_shift_with_pass", {
    p_assignment_id: assignmentId,
    p_new_shift_id: shiftId,
    p_volunteer_tokens: pass.v,
    p_assignment_tokens: pass.a,
  });
  if (error) return { error: friendlyDbError(error) };
  if (data !== true) return { error: "This device doesn't have access to that shift anymore. Use the link in your email." };

  const origin = await getOrigin();
  const [entry] = await loadCalendarEntries([assignmentId], true);
  if (entry) after(() => sendShiftSwitched(entry, entry.timezone, origin));
  if (booker) {
    const [from, to] = await Promise.all([shiftLabel(booker.shiftId), shiftLabel(shiftId)]);
    after(() => sendBookerHeadsUp(booker.booker, booker.who, { kind: "switched", from, to }, booker.event));
  }
  revalidatePath("/my");
  return { ok: true };
}

/** For someone another person signed up: who that was (to tell them of a change), and the shift as it is now. */
async function whoBookedThem(assignmentId: string) {
  const admin = createAdminClient();
  const { data: a } = await admin
    .from("volunteer_assignments")
    .select("shift_id, volunteers(id, full_name, contact_id, events(id, name))")
    .eq("id", assignmentId)
    .maybeSingle();
  const v = a?.volunteers as unknown as { id: string; full_name: string; contact_id: string | null; events: { id: string; name: string } | null } | null;
  if (!a || !v?.contact_id || !v.events) return null;
  const { data: booker } = await admin.from("volunteers").select("full_name, email").eq("id", v.contact_id).maybeSingle();
  if (!booker?.email) return null;
  return { shiftId: a.shift_id as string, who: v.full_name, booker: { name: booker.full_name, email: booker.email }, event: v.events };
}

/** "Concessions, 6:00 PM – 8:00 PM CDT" */
async function shiftLabel(shiftId: string) {
  const { data } = await createAdminClient()
    .from("shifts")
    .select("starts_at, ends_at, stations(name), events(timezone)")
    .eq("id", shiftId)
    .maybeSingle();
  if (!data) return "a shift";
  const tz = (data.events as unknown as { timezone: string } | null)?.timezone ?? "America/Chicago";
  const station = (data.stations as unknown as { name: string } | null)?.name ?? "Shift";
  return `${station}, ${formatDate(utcToZonedDate(data.starts_at, tz), { year: undefined })}, ${formatTimeRange(data.starts_at, data.ends_at, tz)}`;
}

/** Cancel something I signed up to bring: with this device's pass, or signed in. */
export async function cancelMyItem(signupId: string): Promise<ActionState> {
  const pass = await readPass();
  let cancelled = false;
  if (hasPass(pass)) {
    const { data, error } = await createAdminClient().rpc("cancel_item_with_pass", {
      p_signup_id: signupId,
      p_volunteer_tokens: pass.v,
      p_item_tokens: pass.a,
    });
    if (error) return { error: friendlyDbError(error) };
    cancelled = data === true;
  }
  if (!cancelled && (await getUser())) {
    const { data, error } = await (await createClient()).rpc("cancel_my_item", { p_signup_id: signupId });
    if (error) return { error: friendlyDbError(error) };
    cancelled = data === true;
  }
  if (!cancelled) return { error: "This device doesn't have access to that sign-up anymore. Use the link in your email." };
  revalidatePath("/my");
  return { ok: true };
}

export async function forgetThisDevice(): Promise<ActionState> {
  await forgetPass();
  revalidatePath("/my");
  return { ok: true };
}

/**
 * "Email me my link": sends the private View-my-shifts link(s) for an email
 * address. Always gives the same answer, so it can't be used to discover who
 * volunteered, and won't resend more than once every 10 minutes per signup.
 */
export async function emailMyLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Please enter a valid email address." };
  if (!(await passesBotCheck(formData))) return { error: BOT_CHECK_FAILED };
  const generic: ActionState = {
    ok: true,
    message: `If ${parsed.data} has upcoming sign-ups, we just emailed a link to view them. It can take a minute to arrive.`,
  };

  const admin = createAdminClient();
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data } = await admin
    .from("volunteers")
    .select("id, full_name, access_token, link_sent_at, events!inner(name, starts_on, ends_on)")
    .eq("email", parsed.data)
    .gte("events.ends_on", weekAgo)
    .or(`link_sent_at.is.null,link_sent_at.lt.${tenMinutesAgo}`);
  const records = (data ?? []) as unknown as {
    id: string;
    full_name: string;
    access_token: string;
    events: { name: string; starts_on: string; ends_on: string };
  }[];
  if (records.length === 0) return generic;

  await admin
    .from("volunteers")
    .update({ link_sent_at: new Date().toISOString() })
    .in(
      "id",
      records.map((r) => r.id),
    );

  const origin = await getOrigin();
  const custom = customWords("volunteer_link", await loadSystemEmail("volunteer_link"), { first_name: records[0].full_name.split(" ")[0] });
  const { html, text } = emailLayout({
    heading: custom?.heading || "Your volunteer shifts",
    paragraphs: custom?.paragraphs ?? [`Hi ${records[0].full_name.split(" ")[0]}, here's your link to view or cancel your shifts. It's just for you.`],
    rows: records.map((r) => ({
      title: r.events.name,
      detail: formatDateRange(r.events.starts_on, r.events.ends_on),
      links: [{ label: "View my shifts", url: `${origin}/pass/${r.access_token}` }],
    })),
    footer: "Didn't ask for this? You can ignore this email.",
  });
  await sendEmail({ to: parsed.data, subject: custom?.subject || "Your volunteer shifts", html, text });
  return generic;
}

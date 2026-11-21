import "server-only";
import { cache } from "react";
import { isSchemaError } from "@/lib/schema-check";
import { createAdminClient } from "@/lib/supabase/server";
import { readPass, type Pass } from "@/lib/volunteer-pass";

/**
 * The person this device remembers (pass_contact, server only): the most recent booker its pass proves, never
 * someone they added or a walk-up, and only from the same account as the event being signed up for (a shared device
 * never carries one group's sign-up into another's form). The full phone number never leaves the server; pages get
 * its last four digits.
 */
export type Remembered = {
  fullName: string;
  email: string;
  phone: string | null;
  minor: boolean;
  eventId: string;
  eventSlug: string;
  eventName: string | null;
};

export async function passContact(pass: Pass, eventId: string): Promise<Remembered | null> {
  if (!pass.v.length && !pass.a.length) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("pass_contact", { p_volunteer_tokens: pass.v, p_assignment_tokens: pass.a, p_event: eventId });
  if (error) {
    if (!isSchemaError(error)) console.error("pass_contact failed", error.message);
    return null;
  }
  const row = ((data ?? []) as { full_name: string; email: string; phone: string | null; minor: boolean; event_id: string; event_slug: string }[])[0];
  if (!row) return null;
  const { data: ev } = await admin.from("events").select("name").eq("id", row.event_id).maybeSingle();
  return {
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    minor: row.minor,
    eventId: row.event_id,
    eventSlug: row.event_slug,
    eventName: ev?.name ?? null,
  };
}

/** This device's remembered person for this event's account, once per request. */
export const loadRemembered = cache(async (eventId: string) => passContact(await readPass(), eventId));

/** Shifts this device holds (its pass), so "More ways to help" leaves them, and anything at the same time, out. */
export const heldShiftIds = cache(async (): Promise<string[]> => {
  const pass = await readPass();
  if (!pass.v.length && !pass.a.length) return [];
  const admin = createAdminClient();
  const [byManage, byVolunteer] = await Promise.all([
    pass.a.length ? admin.from("volunteer_assignments").select("shift_id").in("manage_token", pass.a) : Promise.resolve({ data: [] }),
    pass.v.length
      ? admin.from("volunteers").select("volunteer_assignments(shift_id)").in("access_token", pass.v)
      : Promise.resolve({ data: [] }),
  ]);
  const ids = new Set<string>();
  for (const r of (byManage.data ?? []) as { shift_id: string }[]) ids.add(r.shift_id);
  for (const v of (byVolunteer.data ?? []) as { volunteer_assignments: { shift_id: string }[] }[]) for (const a of v.volunteer_assignments ?? []) ids.add(a.shift_id);
  return [...ids];
});

/** "p•••@example.com": an email as the confirm card shows it (the full address stays on the server). */
export const maskEmail = (email: string) => {
  const [user, domain] = email.split("@");
  return domain ? `${user.slice(0, 1)}•••@${domain}` : email;
};

/** "0142": the last four digits of a phone number, the only part a page shows. */
export const phoneEnding = (phone: string | null) => (phone ? phone.replace(/\D/g, "").slice(-4) || null : null);

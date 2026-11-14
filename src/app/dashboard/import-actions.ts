"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { friendlyDbError } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import { getOrigin } from "@/lib/data";
import { pause, sendEmail } from "@/lib/email";
import { GRADES } from "@/lib/grades";
import { MAX_IMPORT_ROWS, planBands, planParents, planVolunteers, type ImportRecord, type ImportResult, type RowProblem } from "@/lib/imports";
import { parentEmail, parentLink } from "@/lib/parents";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { loadCalendarEntries, sendSignupConfirmation } from "@/lib/volunteer-emails";

// Spreadsheet imports. The browser sends the rows as the host matched them;
// everything is checked again here (and by the database) before it's saved.

const recordsSchema = z
  .array(z.object({ row: z.number().int().min(1), values: z.record(z.string(), z.string().max(2000)) }))
  .min(1, "There's nothing to import.")
  .max(MAX_IMPORT_ROWS, `Please import ${MAX_IMPORT_ROWS} rows or fewer at a time.`);

function readRecords(records: unknown): { records?: ImportRecord[]; error?: string } {
  const parsed = recordsSchema.safeParse(records);
  return parsed.success ? { records: parsed.data } : { error: parsed.error.issues[0].message };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// A "try it" event (its type isn't in the account's plan) doesn't email anyone
// outside the account. The database holds back band invitations the same way.
const TRIAL_NO_EMAIL =
  "Your plan doesn't include this kind of event, so we didn't email anyone. They won't be emailed later on their own, so let them know yourself once it's published";

async function isTrialEvent(eventId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("event_trial", { p_event: eventId });
  return data === true;
}

/**
 * Bands or groups: save each director's details for them (nobody is
 * registered). The director sees them filled in when they register.
 */
export async function importBandPrefills(eventId: string, records: unknown): Promise<ImportResult> {
  const user = await requireUser();
  const { records: rows, error } = readRecords(records);
  if (!rows) return { error };
  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("event_type, chaperone_limit, classifications").eq("id", eventId).maybeSingle();
  if (!event) return { error: "Only the event's hosts can import registrations." };

  // A classification this event doesn't offer is left for the director to pick.
  const classes = new Set<string>(event.classifications ?? []);
  for (const r of rows) if (r.values.classification && !classes.has(r.values.classification)) r.values.classification = "";
  const plan = planBands(rows, { chaperoneLimit: event.chaperone_limit });
  if (plan.items.length === 0) return { error: "None of the rows could be imported. Check the problems listed and try again." };

  // (rows: undefined leaves the spreadsheet row numbers out of what's saved.)
  const saved = plan.items.map((item) => ({ ...item, rows: undefined, event_id: eventId, created_by: user.id }));
  for (let i = 0; i < saved.length; i += 500) {
    const { error: saveError } = await supabase.from("band_prefills").upsert(saved.slice(i, i + 500), { onConflict: "event_id,email,band_name" });
    if (saveError) return { error: saveError.code === "42501" ? "Only the event's hosts can import registrations." : friendlyDbError(saveError) };
  }
  revalidatePath(`/dashboard/events/${eventId}/bands`);
  const one = event.event_type === "group_event" ? "group" : "band";
  return {
    ok: true,
    message: `Saved ${plural(plan.items.length, `${one}'s details`, `${one}s' details`)}. Next, email their directors an invitation to register.`,
    skipped: plan.problems,
  };
}

/** Volunteers onto their shifts, as if they'd signed up (a full shift grows to fit). */
export async function importVolunteers(eventId: string, records: unknown, sendEmails: boolean): Promise<ImportResult> {
  await requireUser();
  const { records: rows, error } = readRecords(records);
  if (!rows) return { error };
  const supabase = await createClient();
  const { data: shifts } = await supabase.from("shifts").select("id").eq("event_id", eventId);
  const shiftIds = new Set((shifts ?? []).map((s) => s.id));
  for (const r of rows) if (r.values.shift && !shiftIds.has(r.values.shift)) r.values.shift = "";
  const plan = planVolunteers(rows);
  if (plan.items.length === 0) return { error: "None of the rows could be imported. Check the problems listed and try again." };

  const skipped: RowProblem[] = [...plan.problems];
  const added: { id: string; shiftIds: string[]; others: string[] }[] = [];
  for (const item of plan.items) {
    const { data: id, error: importError } = await supabase.rpc("import_volunteer", {
      p_event: eventId,
      p_full_name: item.name,
      p_email: item.email,
      p_phone: item.phone,
      p_minor: item.minor,
      p_companions: item.companions,
      p_shift_ids: item.shiftIds,
    });
    if (importError?.code === "42501") return { error: "Only the event's hosts and Volunteer Leads can import volunteers." };
    if (importError) skipped.push({ rows: item.rows, message: friendlyDbError(importError) });
    else added.push({ id: id as string, shiftIds: item.shiftIds, others: item.companions.map((c) => c.name) });
  }
  if (added.length === 0) return { error: "None of the volunteers could be added.", skipped };

  const trial = sendEmails && (await isTrialEvent(eventId));
  if (sendEmails && !trial) {
    const origin = await getOrigin();
    const { data: event } = await supabase.from("events").select("timezone, starts_on, ends_on").eq("id", eventId).single();
    after(async () => {
      const admin = createAdminClient();
      for (const v of added) {
        const { data: assignments } = await admin.from("volunteer_assignments").select("id").eq("volunteer_id", v.id).in("shift_id", v.shiftIds);
        const entries = await loadCalendarEntries((assignments ?? []).map((a) => a.id));
        await sendSignupConfirmation(entries, event?.timezone ?? "America/Chicago", origin, Boolean(event && event.starts_on !== event.ends_on), v.others);
        await pause();
      }
    });
  }
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  const people = added.reduce((n, v) => n + 1 + v.others.length, 0);
  return {
    ok: true,
    message: `Added ${plural(people, "volunteer", "volunteers")} to their shifts${trial ? `. ${TRIAL_NO_EMAIL}` : sendEmails ? ", and emailing each a confirmation now" : ""}.`,
    skipped,
  };
}

/** School visit families, one registration per email. */
export async function importParents(eventId: string, records: unknown, sendEmails: boolean): Promise<ImportResult> {
  await requireUser();
  const { records: rows, error } = readRecords(records);
  if (!rows) return { error };
  const grades = new Set<string>(GRADES);
  for (const r of rows) if (r.values.grade && !grades.has(r.values.grade)) r.values.grade = "";
  const plan = planParents(rows);
  if (plan.items.length === 0) return { error: "None of the rows could be imported. Check the problems listed and try again." };

  const supabase = await createClient();
  const skipped: RowProblem[] = [...plan.problems];
  const added: { token: string; item: (typeof plan.items)[number] }[] = [];
  for (const item of plan.items) {
    const { data: token, error: importError } = await supabase.rpc("import_parent_registration", {
      p_event: eventId,
      p_name: item.parentName,
      p_email: item.email,
      p_phone: item.phone,
      p_children: item.children,
      p_other_adults: item.otherAdults,
      p_first: item.firstName,
      p_last: item.lastName,
    });
    if (importError?.code === "42501") return { error: "Only the event's hosts can import parent registrations." };
    if (importError) skipped.push({ rows: item.rows, message: friendlyDbError(importError) });
    else if (!token) skipped.push({ rows: item.rows, message: `${item.email} is already registered, so it was left as it is.` });
    else added.push({ token: token as string, item });
  }
  if (added.length === 0) return { error: "None of the families could be added.", skipped };

  const trial = sendEmails && (await isTrialEvent(eventId));
  if (sendEmails && !trial) {
    const origin = await getOrigin();
    const { data: event } = await supabase
      .from("events")
      .select("slug, name, starts_on, ends_on, window_start, window_end, timezone, venue_name, venue_address")
      .eq("id", eventId)
      .single();
    after(async () => {
      if (!event) return;
      const admin = createAdminClient();
      for (const { token, item } of added) {
        const { data: reg } = await admin.from("parent_registrations").select("id, calendar_sequence").eq("access_token", token).single();
        if (!reg) continue;
        const message = await parentEmail(
          "confirmation",
          { ...reg, parent_name: item.parentName, email: item.email, children: item.children, other_adults: item.otherAdults },
          event,
          parentLink(origin, event.slug, token),
        );
        await sendEmail({ to: item.email, ...message, eventId });
        await pause();
      }
    });
  }
  revalidatePath(`/dashboard/events/${eventId}/parents`);
  return {
    ok: true,
    message: `Added ${plural(added.length, "family", "families")}${trial ? `. ${TRIAL_NO_EMAIL}` : sendEmails ? ", and emailing each a confirmation now" : ""}.`,
    skipped,
  };
}

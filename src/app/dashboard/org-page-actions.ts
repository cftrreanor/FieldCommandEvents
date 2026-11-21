"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import {
  addDays,
  cleanHelpLink,
  HELP_LAST_DAY_AFTER,
  HELP_NOTE_MAX,
  HELP_TITLE_MAX,
  type EventOrgPageStatus,
} from "@/lib/org-page-words";
import { createClient } from "@/lib/supabase/server";
import { utcToZonedDate } from "@/lib/time";

// The organizer's organization page actions: thin wrappers over the database functions in
// supabase/migrations/20270210000000_org_page.sql, which check is_org_admin (the Account Host and Co-hosts of every
// event), the account's kind, and the event's kind. Each returns { error } in words for the organizer, with the
// field it's about when there is one, so the screen shows one error next to its box (lesson L29).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const EMAIL = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/i;

export type OrgField = "name" | "contact" | "events";
type Fail = { error?: string; field?: OrgField };

/** Which box a refusal from set_org_page (or the name trigger) is about. */
function fieldOf(message: string): OrgField | undefined {
  if (/group's name|person's name/i.test(message)) return "name";
  if (/contact email/i.test(message)) return "contact";
  if (/volunteer events and fairs/i.test(message)) return "events";
  return undefined;
}

/** Every page that shows the page's state, fresh after a change (the public page too). */
async function refresh(slug?: string | null) {
  revalidatePath("/dashboard", "layout");
  if (slug) revalidatePath(`/o/${slug}`);
}

function checkName(name: string): Fail | null {
  if (!name.trim()) return { error: "Add your group's name.", field: "name" };
  if (name.trim().length > 120) return { error: "Keep your group's name under 120 characters.", field: "name" };
  return null;
}

function checkContact(contact: string, required: boolean): Fail | null {
  const c = contact.trim();
  if (!c) return required ? { error: "Add a contact email to turn on your page.", field: "contact" } : null;
  if (c.length > 254 || !EMAIL.test(c)) return { error: "Check the contact email. It should look like name@example.com.", field: "contact" };
  return null;
}

/** Turn the page on: the group's name, the contact email, and exactly which events show (none is fine). */
export async function turnOnOrgPage(orgId: string, input: { name: string; contact: string; eventIds: string[] }): Promise<Fail & { slug?: string }> {
  await requireUser();
  if (!isId(orgId)) return { error: "Reload the page and try again." };
  const problem = checkName(String(input.name ?? "")) ?? checkContact(String(input.contact ?? ""), true);
  if (problem) return problem;
  const ids = (Array.isArray(input.eventIds) ? input.eventIds : []).filter(isId).slice(0, 500);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_org_page", {
    p_org: orgId,
    p_on: true,
    p_name: input.name.trim(),
    p_contact_email: input.contact.trim(),
    p_event_ids: ids,
  });
  if (error) {
    const message = friendlyDbError(error);
    return { error: message, field: fieldOf(message) };
  }
  const slug = (data as { slug?: string | null } | null)?.slug ?? null;
  await refresh(slug);
  return { slug: slug ?? undefined };
}

/** Turn the page off. Everything chosen is kept for turning it on again. */
export async function turnOffOrgPage(orgId: string): Promise<Fail> {
  await requireUser();
  if (!isId(orgId)) return { error: "Reload the page and try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_org_page", { p_org: orgId, p_on: false });
  if (error) return { error: friendlyDbError(error) };
  await refresh((data as { slug?: string | null } | null)?.slug);
  return {};
}

/** While it's on: the group's name or the contact email, one at a time (saves as you go). */
export async function saveOrgPageDetail(orgId: string, field: "name" | "contact", value: string): Promise<Fail> {
  await requireUser();
  if (!isId(orgId)) return { error: "Reload the page and try again." };
  const v = String(value ?? "");
  const problem = field === "name" ? checkName(v) : checkContact(v, true);
  if (problem) return problem;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_org_page", {
    p_org: orgId,
    p_on: null,
    ...(field === "name" ? { p_name: v.trim() } : { p_contact_email: v.trim() }),
  });
  if (error) {
    const message = friendlyDbError(error);
    return { error: message, field: fieldOf(message) ?? field };
  }
  await refresh((data as { slug?: string | null } | null)?.slug);
  return {};
}

/**
 * One event's switch. Always answers with the event's true status (read again after a refusal), so the screen
 * snaps back to what's really saved and says so.
 */
export async function setEventOnOrgPage(eventId: string, on: boolean): Promise<{ status?: EventOrgPageStatus; error?: string }> {
  await requireUser();
  if (!isId(eventId)) return { error: "Reload the page and try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_event_on_org_page", { p_event: eventId, p_on: Boolean(on) });
  if (error) {
    const truth = await supabase.rpc("event_org_page_status", { p_event: eventId });
    return { error: friendlyDbError(error), status: (truth.data as EventOrgPageStatus | null) ?? undefined };
  }
  revalidatePath("/dashboard", "layout");
  const { data: org } = await supabase.from("events").select("organizations(slug, org_page_slug_set_at)").eq("id", eventId).maybeSingle();
  const o = (org as { organizations?: { slug: string; org_page_slug_set_at: string | null } | null } | null)?.organizations;
  if (o?.org_page_slug_set_at) revalidatePath(`/o/${o.slug}`);
  return { status: data as EventOrgPageStatus };
}

// ---------------------------------------------------------------------------------------------
// Help anytime
// ---------------------------------------------------------------------------------------------

export type HelpItem = { id: string; title: string; note: string | null; link: string | null; ends_on: string };
type HelpFail = { error?: string; fieldErrors?: Partial<Record<"title" | "note" | "link" | "endsOn", string>> };

/** The account's today, in its own time zone (what the database checks end dates against). */
async function orgToday(orgId: string) {
  const { data } = await (await createClient()).from("organizations").select("default_timezone, slug, org_page_slug_set_at").eq("id", orgId).maybeSingle();
  const tz = (data?.default_timezone as string | undefined) || "America/Chicago";
  return { today: utcToZonedDate(new Date().toISOString(), tz), slug: data?.org_page_slug_set_at ? (data.slug as string) : null };
}

/** Add a way to help, or save changes to one. The link is cleaned first (https, no tracking parts). */
export async function saveHelpItem(
  orgId: string,
  input: { id?: string | null; title: string; note: string; link: string; endsOn: string },
): Promise<HelpFail & { item?: HelpItem; linkChanged?: boolean }> {
  await requireUser();
  if (!isId(orgId) || (input.id && !isId(input.id))) return { error: "Reload the page and try again." };
  const title = String(input.title ?? "").trim();
  const note = String(input.note ?? "").trim();
  const link = cleanHelpLink(String(input.link ?? ""));
  const endsOn = String(input.endsOn ?? "");
  const { today, slug } = await orgToday(orgId);
  const fieldErrors: HelpFail["fieldErrors"] = {};
  if (!title) fieldErrors.title = "Add a title";
  else if (title.length > HELP_TITLE_MAX) fieldErrors.title = `Keep the title to ${HELP_TITLE_MAX} characters`;
  if (note.length > HELP_NOTE_MAX) fieldErrors.note = `Keep the note to ${HELP_NOTE_MAX} characters`;
  if (link.error) fieldErrors.link = link.error;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) fieldErrors.endsOn = "Pick an end date";
  else if (endsOn < today || endsOn > addDays(today, HELP_LAST_DAY_AFTER)) fieldErrors.endsOn = "Pick an end date from today to a year from now";
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  const row = { title, note: note || null, link: link.url, ends_on: endsOn };
  const supabase = await createClient();
  const query = input.id
    ? supabase.from("org_help_items").update(row).eq("id", input.id).eq("organization_id", orgId)
    : supabase.from("org_help_items").insert({ ...row, organization_id: orgId });
  const { data, error } = await query.select("id, title, note, link, ends_on").maybeSingle();
  if (error) return { error: friendlyDbError(error) };
  if (!data) return { error: "That way to help was removed. Reload the page to see the current list." };
  await refresh(slug);
  // Said only when it did more than add "https://" to a bare address.
  return { item: data as HelpItem, linkChanged: link.changed && link.url !== `https://${String(input.link ?? "").trim()}` };
}

/** "End today": it stays on the page through today, then leaves. */
export async function endHelpToday(orgId: string, id: string): Promise<HelpFail & { item?: HelpItem }> {
  await requireUser();
  if (!isId(orgId) || !isId(id)) return { error: "Reload the page and try again." };
  const { today, slug } = await orgToday(orgId);
  const { data, error } = await (await createClient())
    .from("org_help_items")
    .update({ ends_on: today })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id, title, note, link, ends_on")
    .maybeSingle();
  if (error) return { error: friendlyDbError(error) };
  if (!data) return { error: "That way to help was removed. Reload the page to see the current list." };
  await refresh(slug);
  return { item: data as HelpItem };
}

/** Remove for good (the screen waits a few seconds first, so Undo can stop it). */
export async function removeHelpItem(orgId: string, id: string): Promise<HelpFail> {
  await requireUser();
  if (!isId(orgId) || !isId(id)) return { error: "Reload the page and try again." };
  const { slug } = await orgToday(orgId);
  const { error } = await (await createClient()).from("org_help_items").delete().eq("id", id).eq("organization_id", orgId);
  if (error) return { error: friendlyDbError(error) };
  await refresh(slug);
  return {};
}

"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import { copyLogoFiles, LogoError, notImageMessage, processUpload, SPONSOR_LOGO_BUCKET, tooBigMessage, uploadFolder } from "@/lib/sponsor-logos";
import { brand } from "@/lib/brand";
import { LOGO, LEVEL_NAME_MAX, normalizeSponsorLink, organizerSponsorLogoUrl, SPONSOR_NAME_MAX, sponsorNameKey, type Sponsor, type SponsorLevel } from "@/lib/sponsors";
import { loadEventSponsors, loadReuseCandidates } from "@/lib/sponsors-data";
import { createAdminClient, createClient } from "@/lib/supabase/server";

// The organizer's sponsor actions: thin wrappers over the database functions in 20270201000000_sponsors.sql,
// which check the person hosts the event, the add-on is on, and the event's kind. Each returns { error } with
// words for the organizer when it didn't go through (failed saves are shown in the sponsor's row): sentences
// that end with periods and say how to fix it.

type Fail = { error?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const NOT_HOST = "Only the event's hosts can change its sponsors. Ask a host to make this change.";
const GONE = "That sponsor was removed or isn't on this event. Reload the page to see the current list.";
/** The sponsor's name for "Ask … for", or "the sponsor". */
const whoOf = (name: unknown) => (typeof name === "string" && name.trim() ? name.trim().slice(0, SPONSOR_NAME_MAX) : "the sponsor");

/** The event, if the person signed in can read it (hosts). */
async function eventFor(eventId: string) {
  if (!isId(eventId)) return null;
  const { data } = await (await createClient()).from("events").select("id, slug, organization_id, event_type").eq("id", eventId).maybeSingle();
  return data as { id: string; slug: string; organization_id: string; event_type: string } | null;
}

/** Fresh organizer pages and the main public page after a change. */
async function refresh(eventId: string) {
  const event = await eventFor(eventId);
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  if (event?.slug) revalidatePath(`/e/${event.slug}`);
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await (await createClient()).rpc(fn, args);
  if (error) return { error: friendlyDbError(error) };
  return { data: data as T };
}

// ---------------------------------------------------------------------------------------------
// Logos
// ---------------------------------------------------------------------------------------------

/**
 * Step 1 of a logo: a one-time upload link (send the file with uploadToSignedUrl from src/lib/signed-upload.ts).
 * Checks the type and size the browser reports; the server checks the real file in step 2. `sponsor`: the name
 * typed so far, for "Ask … for a PNG or JPG".
 */
export async function prepareSponsorLogoUpload(
  eventId: string,
  file: { contentType: string; size: number; sponsor?: string },
): Promise<Fail & { path?: string; url?: string }> {
  await requireUser();
  const who = whoOf(file.sponsor);
  if (!(LOGO.types as readonly string[]).includes(file.contentType)) return { error: notImageMessage(who) };
  if (file.size < 1) return { error: "This file is empty. Save the logo again as a PNG or JPG, then upload it again." };
  if (file.size > LOGO.maxBytes) return { error: tooBigMessage(file.size, who) };
  const event = await eventFor(eventId);
  const supabase = await createClient();
  const [{ data: isHost }, { data: enabled }] = event
    ? await Promise.all([supabase.rpc("is_event_admin", { ev: eventId }), supabase.rpc("sponsors_enabled", { p_org: event.organization_id })])
    : [{ data: false }, { data: false }];
  if (!event || !isHost) return { error: NOT_HOST };
  if (!enabled) return { error: `Sponsors are off for this account, so they can't be changed. Email ${brand.supportEmail} to turn them back on.` };
  const path = `${uploadFolder(eventId)}${crypto.randomUUID()}.${file.contentType === "image/png" ? "png" : "jpg"}`;
  const { data, error } = await createAdminClient().storage.from(SPONSOR_LOGO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("createSignedUploadUrl failed", error);
    return { error: "We couldn't start the upload. Check your connection, then upload the logo again." };
  }
  return { path, url: data.signedUrl };
}

export type UploadedLogo = {
  /** Pass to saveSponsor as logo.path (with width and height). */
  path: string;
  version: string;
  width: number;
  height: number;
  /** Under 600 wide (may look blurry), taller than wide (shows small). */
  warnings: { small: boolean; tall: boolean };
  /** The tile copies, for "How it shows" before saving. */
  previews: { t0: string; t1: string; t2: string };
};

/** Step 2: check and resize the upload on our server (refused under 200 px wide, too many pixels, not PNG or JPG). */
export async function processSponsorLogo(eventId: string, uploadPath: string, sponsor?: string): Promise<Fail & { logo?: UploadedLogo }> {
  await requireUser();
  const event = await eventFor(eventId);
  const { data: isHost } = event ? await (await createClient()).rpc("is_event_admin", { ev: eventId }) : { data: false };
  if (!event || !isHost) return { error: NOT_HOST };
  try {
    const out = await processUpload(createAdminClient(), event.organization_id, eventId, String(uploadPath), whoOf(sponsor));
    const url = (f: "t0" | "t1" | "t2") => organizerSponsorLogoUrl(eventId, out.version, f)!;
    return { logo: { ...out, previews: { t0: url("t0"), t1: url("t1"), t2: url("t2") } } };
  } catch (e) {
    if (e instanceof LogoError) return { error: e.message };
    console.error("Processing a sponsor logo failed", e);
    return { error: "We couldn't use this image. Save it again as a PNG or JPG, then upload it again." };
  }
}

// ---------------------------------------------------------------------------------------------
// Sponsors
// ---------------------------------------------------------------------------------------------

export type SponsorInput = {
  /** Omit to add a new sponsor. */
  sponsorId?: string | null;
  name: string;
  /** One of the event's levels (required once the event has levels). */
  levelId?: string | null;
  /** "New level…": made at the end and used (the first level also takes everyone who had none). */
  newLevelName?: string | null;
  website?: string | null;
  /** undefined keeps the logo; null removes it; an uploaded logo (from processSponsorLogo) replaces it. */
  logo?: { path: string; width: number; height: number } | null;
  show: boolean;
  presentedBy: boolean;
};

/**
 * Add or edit a sponsor. The website is made safe (https, tracking parts removed); `website` in the result is
 * what was saved, and `websiteChanged` says it differs from what was typed.
 */
export async function saveSponsor(
  eventId: string,
  input: SponsorInput,
): Promise<Fail & { fieldErrors?: Record<string, string>; id?: string; website?: string | null; websiteChanged?: boolean }> {
  await requireUser();
  const fieldErrors: Record<string, string> = {};
  const name = String(input.name ?? "").trim();
  if (!name) fieldErrors.name = "Enter the sponsor's name";
  else if (name.length > SPONSOR_NAME_MAX) fieldErrors.name = `Shorten the name to ${SPONSOR_NAME_MAX} characters or fewer.`;
  const newLevel = String(input.newLevelName ?? "").trim();
  if (newLevel.length > LEVEL_NAME_MAX) fieldErrors.newLevelName = `Shorten the level's name to ${LEVEL_NAME_MAX} characters or fewer.`;
  const link = normalizeSponsorLink(input.website);
  if (link.error) fieldErrors.website = link.error;
  if (input.sponsorId && !isId(input.sponsorId)) return { error: GONE };
  if (input.levelId && !isId(input.levelId)) fieldErrors.levelId = "Pick a level";
  if (Object.keys(fieldErrors).length) return { error: Object.values(fieldErrors)[0], fieldErrors };

  const logo = input.logo;
  const { data, error } = await call<string>("save_sponsor", {
    p_event: eventId,
    p_sponsor: input.sponsorId ?? null,
    p_name: name,
    p_level: input.levelId || null,
    p_new_level_name: newLevel || null,
    p_website: link.url,
    p_logo_path: logo ? logo.path : null,
    p_logo_width: logo ? Math.round(logo.width) : null,
    p_logo_height: logo ? Math.round(logo.height) : null,
    p_clear_logo: logo === null,
    p_show: Boolean(input.show),
    p_presented_by: Boolean(input.presentedBy),
  });
  if (error) return { error };
  await refresh(eventId);
  return { id: data, website: link.url, websiteChanged: link.changed };
}

/** Remove (kept for Undo until the next day's cleanup). Removing the Presented by sponsor: the screen asks first. */
export async function removeSponsor(eventId: string, sponsorId: string): Promise<Fail> {
  await requireUser();
  const { error } = await call("remove_sponsor", { p_sponsor: sponsorId });
  if (error) return { error };
  await refresh(eventId);
  return {};
}

/** Undo a Remove. presentedBy: whether it got Presented by back (only if nobody took it since). */
export async function restoreSponsor(eventId: string, sponsorId: string): Promise<Fail & { presentedBy?: boolean }> {
  await requireUser();
  const { data, error } = await call<{ presented_by: boolean }>("restore_sponsor", { p_sponsor: sponsorId });
  if (error) return { error };
  await refresh(eventId);
  return { presentedBy: Boolean(data?.presented_by) };
}

/** Show on the public page, or not. */
export async function setSponsorShown(eventId: string, sponsorId: string, show: boolean): Promise<Fail> {
  await requireUser();
  const { error } = await call("set_sponsor_shown", { p_sponsor: sponsorId, p_show: Boolean(show) });
  if (error) return { error };
  await refresh(eventId);
  return {};
}

/** Presented by: one showing sponsor, or nobody (null). */
export async function setPresentedBy(eventId: string, sponsorId: string | null): Promise<Fail> {
  await requireUser();
  const { error } = await call("set_presented_by", { p_event: eventId, p_sponsor: sponsorId || null });
  if (error) return { error };
  await refresh(eventId);
  return {};
}

export type MoveResult = { moved: boolean; crossed: boolean; levelId: string | null; levelName: string | null; place: number; count: number };

/** Up or down one place; from the end of a level, into the next or previous one ("Moved to Bronze"). */
export async function moveSponsor(eventId: string, sponsorId: string, dir: "up" | "down"): Promise<Fail & { result?: MoveResult }> {
  await requireUser();
  if (dir !== "up" && dir !== "down") return { error: "Use the up or down arrow." };
  const { data, error } = await call<{ moved: boolean; crossed: boolean; level_id: string | null; level_name: string | null; place: number; count: number }>(
    "move_sponsor",
    { p_sponsor: sponsorId, p_dir: dir },
  );
  if (error || !data) return { error: error ?? "That didn't move. Check your connection, then use the arrow again." };
  await refresh(eventId);
  return { result: { moved: data.moved, crossed: data.crossed, levelId: data.level_id, levelName: data.level_name, place: Number(data.place), count: Number(data.count) } };
}

// ---------------------------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------------------------

/** Add (levelId null; at the end, at most 4) or rename a level. */
export async function saveSponsorLevel(eventId: string, levelId: string | null, name: string): Promise<Fail & { id?: string }> {
  await requireUser();
  const n = String(name ?? "").trim();
  if (!n) return { error: "Name the level." };
  if (n.length > LEVEL_NAME_MAX) return { error: `Shorten the level's name to ${LEVEL_NAME_MAX} characters or fewer.` };
  const { data, error } = await call<string>("save_sponsor_level", { p_event: eventId, p_level: levelId || null, p_name: n });
  if (error) return { error };
  await refresh(eventId);
  return { id: data };
}

export async function moveSponsorLevel(eventId: string, levelId: string, dir: "up" | "down"): Promise<Fail> {
  await requireUser();
  if (dir !== "up" && dir !== "down") return { error: "Use the up or down arrow." };
  const { error } = await call("move_sponsor_level", { p_level: levelId, p_dir: dir });
  if (error) return { error };
  await refresh(eventId);
  return {};
}

/** Remove a level, moving its sponsors to toLevelId in one step (null only when it's the last level). */
export async function removeSponsorLevel(eventId: string, levelId: string, toLevelId: string | null): Promise<Fail & { moved?: number }> {
  await requireUser();
  const { data, error } = await call<number>("remove_sponsor_level", { p_level: levelId, p_to: toLevelId || null });
  if (error) return { error };
  await refresh(eventId);
  return { moved: Number(data ?? 0) };
}

// ---------------------------------------------------------------------------------------------
// Reuse
// ---------------------------------------------------------------------------------------------

export type ReuseCandidate = Sponsor & {
  levelName: string | null;
  /** Already on this event (copied from it, or the same name). */
  duplicate: boolean;
  /** A level here with the same name, if any. */
  matchesLevelId: string | null;
  logoUrl: string | null;
};

/** The reuse window's list for one source event: its sponsors, with duplicates and level matches marked. */
export async function getReuseCandidates(eventId: string, fromEventId: string): Promise<Fail & { levels?: SponsorLevel[]; sponsors?: ReuseCandidate[] }> {
  await requireUser();
  const [event, from] = await Promise.all([eventFor(eventId), eventFor(fromEventId)]);
  if (!event || !from || from.organization_id !== event.organization_id)
    return { error: "You can only add sponsors from your account's events that you host. Pick one of them." };
  const [here, src] = await Promise.all([loadEventSponsors(event.id, event.organization_id, event.event_type), loadReuseCandidates(fromEventId)]);
  const keys = new Set(here.sponsors.map((s) => sponsorNameKey(s.name)));
  const copied = new Set(here.sponsors.map((s) => s.copiedFrom).filter(Boolean));
  const hereIds = new Set(here.sponsors.map((s) => s.id));
  const levelName = new Map(src.levels.map((l) => [l.id, l.name]));
  const levelHere = new Map(here.levels.map((l) => [l.name.trim().toLowerCase(), l.id]));
  return {
    levels: src.levels,
    sponsors: src.sponsors.map((s) => {
      const ln = s.levelId ? (levelName.get(s.levelId) ?? null) : null;
      return {
        ...s,
        levelName: ln,
        duplicate: keys.has(sponsorNameKey(s.name)) || copied.has(s.id) || Boolean(s.copiedFrom && hereIds.has(s.copiedFrom)),
        matchesLevelId: ln ? (levelHere.get(ln.trim().toLowerCase()) ?? null) : null,
        logoUrl: organizerSponsorLogoUrl(fromEventId, s.logoVersion, "t2"),
      };
    }),
  };
}

/**
 * Copy sponsors from another event the person hosts ("Add from your other events"; year two: withLevels to
 * "Bring back last year's sponsors and levels"). sponsorIds: which ones (omit for all). levelMap: for source
 * levels with no level of the same name here, { "<source level name>": "<level id here>" } (needed once this
 * event has 4 levels). show: whether they show on the public page (omit: hidden on a published event, showing on a
 * draft). Logos are copied into this event's folder; logosFailed counts any that couldn't be.
 */
export async function reuseSponsors(
  eventId: string,
  fromEventId: string,
  options: { sponsorIds?: string[] | null; levelMap?: Record<string, string>; withLevels?: boolean; show?: boolean } = {},
): Promise<Fail & { added?: number; skipped?: number; logosFailed?: number }> {
  await requireUser();
  const ids = options.sponsorIds?.filter(isId) ?? null;
  const { data, error } = await call<{ added: number; skipped: number; logos: { id: string; from: string; to: string }[] }>("reuse_sponsors", {
    p_event: eventId,
    p_from: fromEventId,
    p_sponsors: ids,
    p_levels: options.levelMap ?? {},
    p_with_levels: Boolean(options.withLevels),
    p_show: typeof options.show === "boolean" ? options.show : null,
  });
  if (error || !data) return { error: error ?? "We couldn't add them. Check your connection, then try again." };
  const admin = createAdminClient();
  let logosFailed = 0;
  // Rows arrive without their logo: copy the files first, then attach (a failed copy leaves the name showing).
  for (const l of data.logos ?? []) {
    const copied = await copyLogoFiles(admin, l.from, l.to);
    if (!copied || (await call("attach_reused_sponsor_logo", { p_sponsor: l.id, p_path: l.to })).error) logosFailed++;
  }
  await refresh(eventId);
  return { added: data.added, skipped: data.skipped, logosFailed };
}

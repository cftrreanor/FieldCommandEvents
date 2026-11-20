import "server-only";
import { cache } from "react";
import { getOrigin } from "@/lib/data";
import { addDays, coordinatorStatus, newDateSpotHref, type NewDateSpot } from "@/lib/duplicate-words";
import { FILES_BUCKET } from "@/lib/event-files";
import { createAdminClient, createClient } from "@/lib/supabase/server";

// Duplicate event (owner decisions: docs/design-decisions/2026-11-20-duplicate-event.md). The database does the
// copy and every rule (supabase/migrations/20270207000000_duplicate_event.sql); this is what the server adds: the
// stored maps and documents, and the publish step's facts (with every "[new date]" left to fill in).

export type CopiedFile = { id: string; label: string; file_name: string; from: string; to: string };

/** What duplicate_event returns (and returns again for a retry with the same request id). */
export type DuplicateSummary = {
  kind: "volunteer" | "fair" | "band_contest" | "group_event";
  source: { id: string; name: string; starts_on: string; ends_on: string; status: string };
  name: string;
  starts_on: string;
  ends_on: string;
  days_moved: number;
  jobs: number;
  shifts: number;
  items: number;
  rooms: number;
  zones: number;
  /** Band contests and festivals: the registration dates, moved or left blank (and what they were). */
  registration: {
    deadline: string | null;
    deadline_was: string | null;
    deadline_left_blank: boolean;
    opens_on: string | null;
    opens_on_was: string | null;
    opens_on_left_blank: boolean;
  } | null;
  coordinators: {
    /** Held invitations: "Not emailed yet · sent when you publish". */
    held: { invitation_id: string; name: string; email: string; jobs: string[] }[];
    /** Account members, straight onto their jobs. */
    added: { user_id: string; name: string; job: string }[];
    /** Couldn't be copied (named, never failing the copy). */
    skipped: { name: string; email: string; job: string }[];
  };
  /** How many invitations on the source nobody accepted (not copied; no addresses are kept). */
  not_copied_invitations: number;
  volunteers_on_source: number;
  bands_on_source: number;
  files: CopiedFile[];
  /** The copied steps, each "Copied: check it" until opened. */
  steps: string[];
};

export type DuplicateResult = { event_id: string; existing: boolean; summary: DuplicateSummary };

/** One copied Coordinator's invitation and where it is on the ladder. */
export type CopyCoordinator = {
  invitation_id: string;
  name: string;
  email: string;
  station_id: string | null;
  jobs: string[];
  /** held: "Not emailed yet"; sent; expired: "Invitation expired [date]"; accepted. */
  status: "held" | "sent" | "expired" | "accepted";
  sent_at: string | null;
  expires_at: string | null;
  accepted_at: string | null;
  /** A held or expired invitation that can be sent now. */
  can_send: boolean;
  /** Why it can't be sent now (the plan doesn't include Coordinators, or the team is full). */
  why_not: string | null;
};

/** A copied step: "Copied: check it" until opened; opening it checks it off. */
export type CopyStep = { step: string; opened: boolean };

export type CopyPublishCheck = {
  source: DuplicateSummary["source"];
  days_moved: number;
  created_at: string;
  first_published_at: string | null;
  steps: CopyStep[];
  /** Copied steps nobody has opened yet ("Copied: check it"). Publishing doesn't wait for them. */
  unopened: { step: string }[];
  /** Every spot still holding "[new date]", in step order. Publishing waits for them (the database checks too). */
  newDates: NewDateSpot[];
  invitations: CopyCoordinator[];
  /** Ticked in the publish window: not emailed yet, or expired, and able to be sent. */
  toOffer: CopyCoordinator[];
  /** Not emailed yet or expired, and can't be sent now (with why). */
  cantSend: CopyCoordinator[];
  team: { used: number; max: number | null; free: number | null; coordinators_included: boolean };
  /** Why this person can't Delete and start over (null when they can). */
  discard_blocker: string | null;
};

/**
 * Copies a new copy's maps and documents in storage, server-side. A file that doesn't copy has its row removed, so
 * the copy never points at a missing file; it's named in what comes back. Safe to run again (a retry): a file
 * already there counts as copied.
 */
export async function copyCopiedFiles(eventId: string, files: CopiedFile[], retry = false): Promise<{ copied: CopiedFile[]; failed: CopiedFile[] }> {
  if (!files.length) return { copied: [], failed: [] };
  const bucket = createAdminClient().storage.from(FILES_BUCKET);
  // A retry copies only the rows still there whose file isn't (a file that didn't copy the first time had its row removed).
  if (retry) {
    const supabase = await createClient();
    const { data: rows } = await supabase.from("event_files").select("id").eq("event_id", eventId);
    const still = new Set((rows ?? []).map((r) => r.id as string));
    const left = (await Promise.all(files.filter((f) => still.has(f.id)).map(async (f) => ((await bucket.exists(f.to)).data ? null : f)))).filter(Boolean) as CopiedFile[];
    if (!left.length) return { copied: files.filter((f) => still.has(f.id)), failed: [] };
    files = left;
  }
  const results = await Promise.all(
    files.map(async (f) => {
      // Only within the source's and the copy's own folders.
      if (!f.to.startsWith(`${eventId}/`) || f.from.includes("..") || f.to.includes("..")) return { f, ok: false };
      const { error } = await bucket.copy(f.from, f.to);
      if (!error) return { f, ok: true };
      const { data: there } = await bucket.exists(f.to);
      if (!there) console.error("Copying a map or document failed", f.from, error.message);
      return { f, ok: Boolean(there) };
    }),
  );
  const failed = results.filter((r) => !r.ok).map((r) => r.f);
  if (failed.length) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("drop_uncopied_event_files", { p_event: eventId, p_ids: failed.map((f) => f.id) });
    if (error) console.error("Removing the rows of maps and documents that didn't copy failed", error.message);
  }
  return { copied: results.filter((r) => r.ok).map((r) => r.f), failed };
}

/**
 * A duplicated event that was never published: every Publish button opens its publish window (who gets emailed is
 * chosen there). False for anyone who can't see where it came from, or before the database update.
 */
export async function isUnpublishedCopy(eventId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("event_copies").select("first_published_at").eq("event_id", eventId).maybeSingle();
  return !error && Boolean(data) && !data?.first_published_at;
}

/** The copy's Coordinators and their ladder (hosts only; empty before the database update or for anyone else). */
export async function loadCopyCoordinators(eventId: string): Promise<CopyCoordinator[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("copy_coordinators", { p_event: eventId });
  if (error) return [];
  return (data ?? []) as CopyCoordinator[];
}

type RawPublishCheck = Omit<CopyPublishCheck, "unopened" | "newDates" | "toOffer" | "cantSend"> & { new_dates: NewDateSpot[] };

/**
 * What the copy's Publish step needs: copied steps opened or not, every "[new date]" left, who can be emailed and
 * who can't (and why), and whether Delete and start over is open. Null for an event that wasn't duplicated (or
 * before the database update). The heavy check: run once per request (the step bar uses loadCopySteps).
 */
export const loadCopyPublishCheck = cache(async (eventId: string): Promise<CopyPublishCheck | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("copy_publish_check", { p_event: eventId });
  if (error || !data) return null;
  const raw = data as RawPublishCheck;
  const invitations = raw.invitations ?? [];
  return {
    source: raw.source,
    days_moved: raw.days_moved,
    created_at: raw.created_at,
    first_published_at: raw.first_published_at,
    steps: raw.steps ?? [],
    // One rule everywhere (the publish window, the Ready card, the step bar): "Copied: check it" until opened.
    unopened: (raw.steps ?? []).filter((s) => !s.opened).map((s) => ({ step: s.step })),
    newDates: raw.new_dates ?? [],
    invitations,
    toOffer: invitations.filter((i) => (i.status === "held" || i.status === "expired") && i.can_send),
    cantSend: invitations.filter((i) => (i.status === "held" || i.status === "expired") && !i.can_send),
    team: raw.team,
    discard_blocker: raw.discard_blocker,
  };
});

/**
 * The step bar's light check: each copied step "copied" until opened, then "opened" (checked off); and how many
 * "[new date]" markers each step holds ("Add the new date"). Empty for an event that wasn't duplicated.
 */
export async function loadCopySteps(eventId: string): Promise<{
  copied: Partial<Record<string, "copied" | "opened">>;
  newDates: Partial<Record<string, number>>;
  newDateHrefs: Partial<Record<string, string>>;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("event_copy_steps").select("step, opened_at").eq("event_id", eventId);
  if (error || !data?.length) return { copied: {}, newDates: {}, newDateHrefs: {} };
  const { data: spots } = await supabase.rpc("copy_new_date_spots", { p_event: eventId });
  const newDates: Partial<Record<string, number>> = {};
  // Each step's link lands on its first marker (the right job, its field open, the cursor on "[new date]").
  const newDateHrefs: Partial<Record<string, string>> = {};
  for (const s of (spots ?? []) as NewDateSpot[]) {
    newDates[s.step] = (newDates[s.step] ?? 0) + s.count;
    newDateHrefs[s.step] ??= newDateSpotHref(`/dashboard/events/${eventId}`, s);
  }
  return { copied: Object.fromEntries(data.map((s) => [s.step, s.opened_at ? "opened" : "copied"])), newDates, newDateHrefs };
}

/** One copied Coordinator as Team setup and the event page show them (the ladder's words worked out once). */
export type CopiedPersonView = {
  id: string;
  name: string;
  email: string;
  jobs: string[];
  status: CopyCoordinator["status"];
  statusText: string;
  dot: boolean;
  tone: "warn" | "good" | "plain";
  canSend: boolean;
  url: string | null;
  until: string;
};

/**
 * A copy's Coordinators with their ladder, for Team setup, the job chips, and the event page; plus the team's
 * state (plan, spots). Null for an event that wasn't duplicated.
 */
export async function loadCopiedPeople(eventId: string): Promise<{ people: CopiedPersonView[]; team: CopyPublishCheck["team"]; published: boolean; source: string | null } | null> {
  const check = await loadCopyPublishCheck(eventId);
  if (!check) return null;
  const supabase = await createClient();
  const [{ data: ev }, { data: tokens }] = await Promise.all([
    supabase.from("events").select("status, timezone").eq("id", eventId).maybeSingle(),
    check.invitations.some((i) => i.status === "sent")
      ? supabase.from("invitations").select("id, token").in("id", check.invitations.filter((i) => i.status === "sent").map((i) => i.invitation_id))
      : Promise.resolve({ data: [] as { id: string; token: string | null }[] }),
  ]);
  const published = ev?.status === "published";
  const origin = await getOrigin();
  const until = addDays(new Date().toISOString().slice(0, 10), 30);
  const people = check.invitations.map((c) => {
    const s = coordinatorStatus(c, published, check.team.coordinators_included, ev?.timezone || "America/Chicago");
    const token = (tokens ?? []).find((t) => t.id === c.invitation_id)?.token;
    return {
      id: c.invitation_id,
      name: c.name,
      email: c.email,
      jobs: c.jobs.length ? c.jobs : ["a job"],
      status: c.status,
      statusText: s.text,
      dot: s.dot,
      tone: s.tone,
      canSend: c.can_send,
      url: token ? `${origin}/invite/${token}` : null,
      until,
    };
  });
  return { people, team: check.team, published, source: check.source?.name ?? null };
}

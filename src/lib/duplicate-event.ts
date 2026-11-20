import "server-only";
import { getOrigin } from "@/lib/data";
import { addDays, coordinatorStatus } from "@/lib/duplicate-words";
import { FILES_BUCKET } from "@/lib/event-files";
import { eachDay, findOldDates, type OldDate } from "@/lib/old-dates";
import { createAdminClient, createClient } from "@/lib/supabase/server";

// Duplicate event (owner decisions: docs/design-decisions/2026-11-20-duplicate-event.md). The database does the
// copy and every rule (supabase/migrations/20270207000000_duplicate_event.sql); this is what the server adds: the
// stored maps and documents, and the publish step's facts with old dates found in copied text.

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
  /** Invitations on the source nobody accepted: not copied. */
  not_copied_invitations: { email: string; job: string }[];
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

export type CopyStep = { step: string; opened: boolean; confirmed: boolean };

export type CopyPublishCheck = {
  source: DuplicateSummary["source"];
  days_moved: number;
  created_at: string;
  first_published_at: string | null;
  steps: CopyStep[];
  /** Copied steps nobody has opened, each with old dates found in its copied text. */
  unopened: { step: string; oldDates: OldDate[] }[];
  /** Old dates found in any copied text, by step. */
  oldDates: Partial<Record<string, OldDate[]>>;
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
export async function copyCopiedFiles(eventId: string, files: CopiedFile[]): Promise<{ copied: CopiedFile[]; failed: CopiedFile[] }> {
  if (!files.length) return { copied: [], failed: [] };
  const bucket = createAdminClient().storage.from(FILES_BUCKET);
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

/** The copy's Coordinators and their ladder (hosts only; empty before the database update or for anyone else). */
export async function loadCopyCoordinators(eventId: string): Promise<CopyCoordinator[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("copy_coordinators", { p_event: eventId });
  if (error) return [];
  return (data ?? []) as CopyCoordinator[];
}

type RawPublishCheck = Omit<CopyPublishCheck, "unopened" | "oldDates" | "toOffer" | "cantSend"> & {
  texts: Record<string, (string | null)[]>;
};

/**
 * What the copy's Publish step needs: copied steps opened or not, old dates found in copied text, who can be
 * emailed and who can't (and why), and whether Delete and start over is open. Null for an event that wasn't
 * duplicated (or before the database update).
 */
export async function loadCopyPublishCheck(eventId: string): Promise<CopyPublishCheck | null> {
  const supabase = await createClient();
  const [{ data, error }, { data: ev }] = await Promise.all([
    supabase.rpc("copy_publish_check", { p_event: eventId }),
    supabase.from("events").select("starts_on, ends_on, band_registration_deadline, band_registration_opens_on").eq("id", eventId).maybeSingle(),
  ]);
  if (error || !data || !ev) return null;
  const raw = data as RawPublishCheck;
  // The copy's own dates aren't old: its days, and its registration dates.
  const keep = [...eachDay(ev.starts_on, ev.ends_on), ev.band_registration_deadline, ev.band_registration_opens_on].filter(Boolean) as string[];
  const oldYear = raw.source?.starts_on ? Number(raw.source.starts_on.slice(0, 4)) : undefined;
  const oldDates: Partial<Record<string, OldDate[]>> = {};
  for (const [area, texts] of Object.entries(raw.texts ?? {})) {
    const found = texts.flatMap((t) => findOldDates(t, keep, oldYear));
    const seen = new Set<string>();
    const unique = found.filter((d) => !seen.has(d.text.toLowerCase()) && seen.add(d.text.toLowerCase()));
    if (unique.length) oldDates[area] = unique;
  }
  // Each step's copied text: Details has the description; a contest's or festival's registration step has the
  // information for directors and meals; jobs (or volunteers) have instructions and shift notes.
  const textFor = (step: string) => (step === "volunteers" ? "jobs" : step);
  const invitations = raw.invitations ?? [];
  return {
    source: raw.source,
    days_moved: raw.days_moved,
    created_at: raw.created_at,
    first_published_at: raw.first_published_at,
    steps: raw.steps ?? [],
    // One rule everywhere (the publish window, the Ready card, the phone line): still "Copied: check it", that is,
    // not opened and not saved or confirmed.
    unopened: (raw.steps ?? []).filter((s) => !s.opened && !s.confirmed).map((s) => ({ step: s.step, oldDates: oldDates[textFor(s.step)] ?? [] })),
    oldDates,
    invitations,
    toOffer: invitations.filter((i) => (i.status === "held" || i.status === "expired") && i.can_send),
    cantSend: invitations.filter((i) => (i.status === "held" || i.status === "expired") && !i.can_send),
    team: raw.team,
    discard_blocker: raw.discard_blocker,
  };
}

/**
 * The copied steps still asking to be checked, for the step bar: "copied" until opened, then "opened" until saved
 * or confirmed. Empty for an event that wasn't duplicated (or before the database update).
 */
export async function loadCopySteps(eventId: string): Promise<Partial<Record<string, "copied" | "opened">>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("event_copy_steps").select("step, opened_at, confirmed_at").eq("event_id", eventId);
  if (error || !data?.length) return {};
  const open = data.filter((s) => !s.confirmed_at);
  if (!open.length) return {};
  // "Saved since the copy was made" counts as confirmed: the publish check works that out.
  const { data: check } = await supabase.rpc("copy_publish_check", { p_event: eventId });
  const confirmed = new Set(((check as { steps?: CopyStep[] } | null)?.steps ?? []).filter((s) => s.confirmed).map((s) => s.step));
  return Object.fromEntries(open.filter((s) => !confirmed.has(s.step)).map((s) => [s.step, s.opened_at ? "opened" : "copied"]));
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
    supabase.from("events").select("status").eq("id", eventId).maybeSingle(),
    check.invitations.some((i) => i.status === "sent")
      ? supabase.from("invitations").select("id, token").in("id", check.invitations.filter((i) => i.status === "sent").map((i) => i.invitation_id))
      : Promise.resolve({ data: [] as { id: string; token: string | null }[] }),
  ]);
  const published = ev?.status === "published";
  const origin = await getOrigin();
  const until = addDays(new Date().toISOString().slice(0, 10), 30);
  const people = check.invitations.map((c) => {
    const s = coordinatorStatus(c, published, check.team.coordinators_included);
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

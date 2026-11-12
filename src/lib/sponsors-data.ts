import "server-only";
import { cache } from "react";
import { isSchemaError } from "@/lib/schema-check";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isSponsorKind, logoVersionOf, type PublicSponsor, type Sponsor, type SponsorLevel } from "@/lib/sponsors";
import { utcToZonedDate } from "@/lib/time";

// Loading sponsors (20270201000000_sponsors.sql). Organizers read through RLS (is_event_admin); the public
// only through public_sponsors, and only in src/app/e/[slug]/page.tsx (never layouts, headers, metadata,
// other public pages, or emails). Every loader works before the database update: no sponsors, add-on off.

/** Whether the account has the Sponsors add-on (sponsors_enabled). False for people who don't run its events. */
export const sponsorsEnabled = cache(async (orgId: string | null | undefined): Promise<boolean> => {
  if (!orgId) return false;
  const { data, error } = await (await createClient()).rpc("sponsors_enabled", { p_org: orgId });
  if (error) {
    if (!isSchemaError(error)) console.error("sponsors_enabled failed", error);
    return false;
  }
  return data === true;
});

export type EventSponsors = {
  /** The add-on is on for the event's account. */
  enabled: boolean;
  /** The event's kind can have sponsors (band contest, festival, fair). */
  kindAllowed: boolean;
  levels: SponsorLevel[];
  /** In order: by level, then place. Includes hidden ones; just-removed ones are in `removed` (for Undo). */
  sponsors: Sponsor[];
  removed: Sponsor[];
  /** Counts for the card and the step bar ("9 showing, 2 hidden"). */
  showing: number;
  hidden: number;
  presentedBy: Sponsor | null;
};

type SponsorRow = {
  id: string;
  level_id: string | null;
  name: string;
  website: string | null;
  logo_path: string | null;
  logo_width: number | null;
  logo_height: number | null;
  position: number;
  show_public: boolean;
  presented_by: boolean;
  removed_at: string | null;
  copied_from: string | null;
};
const SPONSOR_COLUMNS = "id, level_id, name, website, logo_path, logo_width, logo_height, position, show_public, presented_by, removed_at, copied_from";

const toSponsor = (r: SponsorRow): Sponsor => ({
  id: r.id,
  levelId: r.level_id,
  name: r.name,
  website: r.website,
  logoVersion: logoVersionOf(r.logo_path),
  logoWidth: r.logo_width,
  logoHeight: r.logo_height,
  position: r.position,
  showPublic: r.show_public,
  presentedBy: r.presented_by,
  removedAt: r.removed_at,
  copiedFrom: r.copied_from,
});

/** Sort sponsors by their level's place, then their own. */
function sortSponsors(list: Sponsor[], levels: SponsorLevel[]) {
  const rank = new Map(levels.map((l, i) => [l.id, i]));
  return list.sort((a, b) => (rank.get(a.levelId ?? "") ?? 99) - (rank.get(b.levelId ?? "") ?? 99) || a.position - b.position);
}

/**
 * An event's levels and sponsors, for its organizers (the Sponsors page, the event page card, the step bar).
 * With the add-on off they're still returned (the card says they're kept). Empty for anyone else.
 * Arguments: the event's id, its organization_id, and its event_type.
 */
export const loadEventSponsors = cache(
  async (eventId: string, orgId: string | null, eventType: string): Promise<EventSponsors> => {
    const empty: EventSponsors = { enabled: false, kindAllowed: isSponsorKind(eventType), levels: [], sponsors: [], removed: [], showing: 0, hidden: 0, presentedBy: null };
    if (!empty.kindAllowed) return empty;
    const supabase = await createClient();
    const [enabled, levelsRes, sponsorsRes] = await Promise.all([
      sponsorsEnabled(orgId),
      supabase.from("sponsor_levels").select("id, name, position").eq("event_id", eventId).order("position"),
      supabase.from("sponsors").select(SPONSOR_COLUMNS).eq("event_id", eventId).order("position"),
    ]);
    if (levelsRes.error || sponsorsRes.error) {
      const error = levelsRes.error ?? sponsorsRes.error;
      if (!isSchemaError(error)) console.error("Loading sponsors failed", error);
      return { ...empty, enabled };
    }
    const levels = (levelsRes.data ?? []) as SponsorLevel[];
    const all = sortSponsors(((sponsorsRes.data ?? []) as SponsorRow[]).map(toSponsor), levels);
    const sponsors = all.filter((s) => !s.removedAt);
    return {
      enabled,
      kindAllowed: true,
      levels,
      sponsors,
      removed: all.filter((s) => s.removedAt),
      showing: sponsors.filter((s) => s.showPublic).length,
      hidden: sponsors.filter((s) => !s.showPublic).length,
      presentedBy: sponsors.find((s) => s.presentedBy) ?? null,
    };
  },
);

/** The main public page's sponsors (public_sponsors): published, add-on on, shown, kept. Hosts see a draft's. */
export const loadPublicSponsors = cache(async (slug: string): Promise<PublicSponsor[]> => {
  const { data, error } = await (await createClient()).rpc("public_sponsors", { p_slug: slug });
  if (error) {
    if (!isSchemaError(error)) console.error("public_sponsors failed", error);
    return [];
  }
  type Row = {
    id: string;
    name: string;
    level_name: string | null;
    level_rank: number | null;
    place: number;
    website: string | null;
    logo_version: string | null;
    logo_width: number | null;
    logo_height: number | null;
    presented_by: boolean;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    levelName: r.level_name,
    levelRank: r.level_rank,
    place: r.place,
    website: r.website,
    logoVersion: r.logo_version || null,
    logoWidth: r.logo_width,
    logoHeight: r.logo_height,
    presentedBy: r.presented_by,
  }));
});

export type ReuseSource = {
  eventId: string;
  name: string;
  eventType: string;
  startsOn: string;
  sponsors: number;
  levels: number;
  /** The same kind as this event (last year's candidates). */
  sameKind: boolean;
};

/** Events the person hosts that have sponsors, newest first ("Add from your other events"). */
export async function loadReuseSources(eventId: string): Promise<ReuseSource[]> {
  const { data, error } = await (await createClient()).rpc("sponsor_reuse_sources", { p_event: eventId });
  if (error) {
    if (!isSchemaError(error)) console.error("sponsor_reuse_sources failed", error);
    return [];
  }
  type Row = { event_id: string; name: string; event_type: string; starts_on: string; sponsors: number; levels: number; same_kind: boolean };
  return ((data ?? []) as Row[]).map((r) => ({
    eventId: r.event_id,
    name: r.name,
    eventType: r.event_type,
    startsOn: r.starts_on,
    sponsors: r.sponsors,
    levels: r.levels,
    sameKind: r.same_kind,
  }));
}

/**
 * Year two: the event to offer "Bring back last year's sponsors and levels" from: the most recent earlier
 * event of the same kind the person hosts that has sponsors, while this one has none. Null otherwise.
 */
export async function loadLastYearSource(event: { id: string; starts_on: string }, current: EventSponsors) {
  if (current.sponsors.length || current.removed.length) return null;
  return (await loadReuseSources(event.id)).find((s) => s.sameKind && s.startsOn < event.starts_on) ?? null;
}

/** Another event's levels and sponsors, for the reuse window's list (only events the person hosts: RLS). */
export async function loadReuseCandidates(fromEventId: string) {
  const supabase = await createClient();
  const [levelsRes, sponsorsRes] = await Promise.all([
    supabase.from("sponsor_levels").select("id, name, position").eq("event_id", fromEventId).order("position"),
    supabase.from("sponsors").select(SPONSOR_COLUMNS).eq("event_id", fromEventId).is("removed_at", null).order("position"),
  ]);
  const levels = (levelsRes.data ?? []) as SponsorLevel[];
  return { levels, sponsors: sortSponsors(((sponsorsRes.data ?? []) as SponsorRow[]).map(toSponsor), levels) };
}

// ---------------------------------------------------------------------------------------------
// Admin (platform admins only; the admin pages check requirePlatformAdmin first)
// ---------------------------------------------------------------------------------------------

export type SponsorAdminSummary = {
  on: boolean;
  since: string | null;
  /** Who turned it on (name or email). */
  by: string | null;
  /** Events with at least one sponsor (kept, not removed), and how many sponsors in all. */
  events: number;
  sponsors: number;
  /** Sponsors per event, for the account page's event list. */
  perEvent: Record<string, number>;
  /** Upcoming published events with sponsors showing: the turn-off window names them. */
  upcoming: { id: string; name: string; startsOn: string; showing: number }[];
  /** False before the database update. */
  available: boolean;
};

export async function loadSponsorAdminSummary(orgId: string): Promise<SponsorAdminSummary> {
  const admin = createAdminClient();
  const none: SponsorAdminSummary = { on: false, since: null, by: null, events: 0, sponsors: 0, perEvent: {}, upcoming: [], available: false };
  const { data: org, error } = await admin.from("organizations").select("sponsors_on, sponsors_on_since, sponsors_on_by").eq("id", orgId).maybeSingle();
  if (error || !org) {
    if (error && !isSchemaError(error)) console.error("Loading the Sponsors add-on failed", error);
    return none;
  }
  const [{ data: byRow }, { data: rows }] = await Promise.all([
    org.sponsors_on_by ? admin.from("profiles").select("full_name, email").eq("id", org.sponsors_on_by).maybeSingle() : Promise.resolve({ data: null }),
    admin
      .from("sponsors")
      .select("event_id, show_public, events!inner(id, name, status, starts_on, ends_on, timezone, organization_id)")
      .eq("events.organization_id", orgId)
      .is("removed_at", null),
  ]);
  type Row = { event_id: string; show_public: boolean; events: { id: string; name: string; status: string; starts_on: string; ends_on: string; timezone: string } };
  const list = (rows ?? []) as unknown as Row[];
  const perEvent: Record<string, number> = {};
  const upcoming = new Map<string, { id: string; name: string; startsOn: string; showing: number }>();
  for (const r of list) {
    perEvent[r.event_id] = (perEvent[r.event_id] ?? 0) + 1;
    const today = utcToZonedDate(new Date().toISOString(), r.events.timezone);
    if (r.show_public && r.events.status === "published" && r.events.ends_on >= today) {
      const u = upcoming.get(r.event_id) ?? { id: r.event_id, name: r.events.name, startsOn: r.events.starts_on, showing: 0 };
      u.showing++;
      upcoming.set(r.event_id, u);
    }
  }
  const by = byRow as { full_name: string | null; email: string | null } | null;
  return {
    on: Boolean(org.sponsors_on),
    since: org.sponsors_on_since ?? null,
    by: by ? by.full_name?.trim() || by.email || null : null,
    events: Object.keys(perEvent).length,
    sponsors: list.length,
    perEvent,
    upcoming: [...upcoming.values()].sort((a, b) => a.startsOn.localeCompare(b.startsOn)),
    available: true,
  };
}

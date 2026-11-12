// The Sponsors add-on (docs/design-decisions/2026-11-12-sponsors.md): the numbers, kinds, and link rules every
// sponsor screen, the logo pipeline, and the database share. Safe to import in client components.

/**
 * The plain line wherever the website promises no ads (owner decision, 2026-11-12): sponsor thank-yous aren't ads.
 * Written once; docs/brand-voice.md quotes it.
 */
export const SPONSOR_PROMISE =
  "Organizers can thank their own sponsors on their public event pages. Sponsors never show on sign-up or registration pages or in emails, and we never sell sponsorships or track who sees them.";

/** Event kinds that can have sponsors. Never others. */
export const SPONSOR_KINDS = ["band_contest", "group_event", "fair"] as const;
export type SponsorKind = (typeof SPONSOR_KINDS)[number];
export const isSponsorKind = (type: string | null | undefined): type is SponsorKind => (SPONSOR_KINDS as readonly string[]).includes(type ?? "");

/** The private storage bucket for sponsor logos (5 MB, PNG and JPEG). */
export const SPONSOR_LOGO_BUCKET = "sponsor-logos";

/** At most this many levels per event (the database checks too). */
export const MAX_LEVELS = 4;
/** How many of the 1st level the live line names. */
export const LIVE_NAMES = 2;
export const SPONSOR_NAME_MAX = 100;
export const LEVEL_NAME_MAX = 40;
export const WEBSITE_MAX = 300;

/** Logo rules: written once, quoted by every window and error ("at least 600 pixels wide is best; we can't use logos under 200"). */
export const LOGO = {
  /** Wide enough to stay sharp in the biggest tile (288 on screen, 2 image pixels per screen pixel). Under it: a warning. */
  minWidth: 600,
  ideal: [1200, 400] as const,
  /** Below this it isn't accepted. */
  refuseUnder: 200,
  maxMB: 5,
  maxBytes: 5 * 1024 * 1024,
  /** Every upload is resized to at most this wide (the master), then a copy is made for each tile size. */
  resizeTo: 1200,
  /** Most pixels we'll open (about a 7000 × 5700 image); bigger images are refused before they're decoded. */
  maxPixels: 40_000_000,
  types: ["image/png", "image/jpeg"] as const,
} as const;

/**
 * Tile sizes by the level's place (1st level biggest): the most a logo shows at on screen (in a 672 px page
 * column). Every logo is at least 48 px tall on screen; the 3rd and 4th levels add the name under the logo.
 * Without levels, everyone gets the 2nd size. `file` is the stored copy, made at 2x for sharp screens.
 */
export const TILES = [
  { file: "t0", w: 288, h: 96, grid: "grid-cols-1 sm:grid-cols-2", box: "h-24 max-w-72", name: "text-lg", under: false, size: "the biggest logos" },
  { file: "t1", w: 192, h: 64, grid: "grid-cols-2 sm:grid-cols-3", box: "h-16 max-w-48", name: "text-base", under: false, size: "large logos" },
  { file: "t2", w: 144, h: 48, grid: "grid-cols-2 sm:grid-cols-3", box: "h-12 max-w-36", name: "text-sm", under: true, size: "smaller logos with the name under each" },
  { file: "t2", w: 144, h: 48, grid: "grid-cols-2 sm:grid-cols-3", box: "h-12 max-w-36", name: "text-sm", under: true, size: "smaller logos with the name under each" },
] as const;
export type Tile = (typeof TILES)[number];
/** The stored tile copies (t0, t1, t2), each made to fit inside 2x its box. */
export const TILE_FILES = [
  { file: "t0", w: 288 * 2, h: 96 * 2 },
  { file: "t1", w: 192 * 2, h: 64 * 2 },
  { file: "t2", w: 144 * 2, h: 48 * 2 },
] as const;
export type TileFile = (typeof TILE_FILES)[number]["file"];
export const isTileFile = (v: string): v is TileFile => TILE_FILES.some((t) => t.file === v);

/** The tile for a level's place (0 = highest); without levels (null), the 2nd size. */
export const tileFor = (rank: number | null | undefined): Tile => TILES[rank == null ? 1 : Math.min(Math.max(rank, 0), TILES.length - 1)];

/**
 * The size a logo shows at inside a tile's box, keeping its shape: for an <img>'s fixed width and height.
 * Logos that aren't wide (square or tall) show small at any level, so tiles add the name under them.
 */
export function logoBox(tile: { w: number; h: number }, width: number, height: number) {
  const scale = Math.min(tile.w / width, tile.h / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export const isNarrowLogo = (width: number | null, height: number | null) => Boolean(width && height && width <= height * 1.2);

/** Upload warnings: under 600 wide may look blurry; taller than wide shows small. */
export function logoWarnings(width: number, height: number) {
  return { small: width < LOGO.minWidth, tall: height > width };
}

// ---------------------------------------------------------------------------------------------
// Links: https only, known tracking parameters stripped, length capped. Nothing counts taps.
// ---------------------------------------------------------------------------------------------

/** On every sponsor link. */
export const SPONSOR_LINK_REL = "sponsored noopener noreferrer";

/** Query parameters that only track people (removed); anything else stays, so links keep working. */
const TRACKING = /^(utm_[a-z0-9_]*|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_eid|mc_cid|igshid|igsh|yclid|twclid|ttclid|li_fat_id|_ga|_gl|_hsenc|_hsmi|mkt_tok|oly_anon_id|oly_enc_id|vero_id|rb_clickid|s_cid|srsltid)$/i;

export type NormalizedLink = { url: string | null; changed: boolean; error?: string };

/**
 * A sponsor's website as we'll link to it: a bare domain gets https://, http:// becomes https:// (the
 * mock-ups: "We'll link to https://…, secure and without the tracking part"), tracking parameters go,
 * and anything that isn't a plain web address is refused. Empty is fine (no link).
 */
export function normalizeSponsorLink(input: string | null | undefined): NormalizedLink {
  const raw = (input ?? "").trim();
  if (!raw) return { url: null, changed: false };
  const bad = (error: string): NormalizedLink => ({ url: null, changed: false, error });
  if (/\s/.test(raw)) return bad("Enter a web address without spaces, like oakstreetdental.com");
  let withScheme = raw;
  if (/^http:\/\//i.test(raw)) withScheme = `https://${raw.slice(7)}`;
  else if (!/^https:\/\//i.test(raw)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/]+\.[^/]+:\d+/.test(raw)) return bad("Enter a web address, like oakstreetdental.com");
    withScheme = `https://${raw.replace(/^\/\//, "")}`;
  }
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return bad("Enter a web address, like oakstreetdental.com");
  }
  if (u.protocol !== "https:" || u.username || u.password) return bad("Enter a web address, like oakstreetdental.com");
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^\d+(\.\d+)+$/.test(host)) return bad("Enter a web address, like oakstreetdental.com");
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  let url = u.toString();
  // Tidy: no lone "?" or a trailing slash on the bare domain.
  url = url.replace(/\?(#|$)/, "$1");
  if (u.pathname === "/" && !u.search && !u.hash) url = url.replace(/\/$/, "");
  if (url.length > WEBSITE_MAX) return bad("That web address is too long. Use the sponsor's main address");
  return { url, changed: url !== raw };
}

/** A link as people read it: without https:// or a trailing slash. */
export const displayLink = (url: string) => url.replace(/^https:\/\//, "").replace(/\/$/, "");

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

/** Comparing names for duplicates, as the database does (sponsor_name_key): lower case, letters and digits only. */
export const sponsorNameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

// ---------------------------------------------------------------------------------------------
// Types the loaders return
// ---------------------------------------------------------------------------------------------

export type SponsorLevel = { id: string; name: string; position: number };

/** A sponsor as organizers see it (hidden and just-removed ones too). */
export type Sponsor = {
  id: string;
  levelId: string | null;
  name: string;
  website: string | null;
  /** The logo's version (its folder), for its address; null without a logo. */
  logoVersion: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
  position: number;
  showPublic: boolean;
  presentedBy: boolean;
  removedAt: string | null;
  copiedFrom: string | null;
};

/** What the main public page shows (public_sponsors). */
export type PublicSponsor = {
  id: string;
  name: string;
  levelName: string | null;
  /** 0 for the highest level; null without levels. */
  levelRank: number | null;
  place: number;
  website: string | null;
  logoVersion: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
  presentedBy: boolean;
};

/** Levels in order, each with its sponsors in order (no levels: one group with level null). */
export type PublicSponsorGroup = { level: string | null; rank: number | null; sponsors: PublicSponsor[] };

export function groupPublicSponsors(list: PublicSponsor[]): PublicSponsorGroup[] {
  const groups: PublicSponsorGroup[] = [];
  for (const s of list) {
    const last = groups.at(-1);
    if (last && last.level === s.levelName) last.sponsors.push(s);
    else groups.push({ level: s.levelName, rank: s.levelRank, sponsors: [s] });
  }
  return groups;
}

/** Where a public logo is served from: only while public_sponsors shows it; the version makes it cacheable for good. */
export const publicSponsorLogoUrl = (slug: string, s: { id: string; logoVersion: string | null }, file: TileFile) =>
  s.logoVersion ? `/e/${encodeURIComponent(slug)}/sponsor-logo/${s.id}/${s.logoVersion}/${file}` : null;

/** Where organizers see a logo (any of their event's, hidden or just uploaded and not saved yet). */
export const organizerSponsorLogoUrl = (eventId: string, logoVersion: string | null, file: TileFile | "master") =>
  logoVersion ? `/dashboard/events/${eventId}/sponsor-logo/${logoVersion}/${file}` : null;

/** The version (folder name) in a stored logo path: <org>/<event>/<version>/master.png. */
export const logoVersionOf = (path: string | null) => (path ? (path.split("/")[2] ?? null) : null);

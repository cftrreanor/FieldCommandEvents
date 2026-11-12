// The Sponsors screens' words (docs/design-decisions/2026-11-12-sponsors.md and the round-2 mock-ups, with the
// light check's fixes). Written once: the card, the page, every window, and the copied email quote these.
// Safe to import in client components.
import { LIVE_NAMES, LOGO, TILES } from "@/lib/sponsors";

export type SponsorKindWords = {
  /** "contest", "festival", "fair" */
  kind: string;
  /** "contest day" */
  day: string;
  /** Where the day's sponsor line goes ("the live schedule"). */
  live: string;
  /** The same, as the subject of a sentence ("the schedule names …"). */
  liveShort: string;
  /** Where sponsors never show, for the "where it shows" box. */
  never: string;
};

/** Each kind's own words (pattern 23). */
export function sponsorKindWords(eventType: string): SponsorKindWords {
  if (eventType === "band_contest") {
    return {
      kind: "contest",
      day: "contest day",
      live: "the live schedule",
      liveShort: "the schedule",
      never: "The volunteer sign-up and band registration pages, directors' pages, and emails",
    };
  }
  if (eventType === "fair") {
    return { kind: "fair", day: "fair day", live: "What's at the event", liveShort: "What's at the event", never: "The volunteer sign-up page and emails" };
  }
  return {
    kind: "festival",
    day: "festival day",
    live: "Happening now",
    liveShort: "Happening now",
    never: "The volunteer sign-up and group registration pages, directors' pages, and emails",
  };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const ordinal = (n: number) => ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"][n - 1] ?? `${n}th`;
export const listAnd = (items: string[]) =>
  items.length <= 1 ? items.join("") : items.length === 2 ? `${items[0]} and ${items[1]}` : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;

/** "9 showing, 2 hidden" (or "9 showing" with none hidden). */
export const showLine = (showing: number, hidden: number) => `${showing} showing${hidden ? `, ${hidden} hidden` : ""}`;

/** What a level gets on the public page, by its place (said on the Sponsors page, for sponsor packets). */
export function levelGets(rank: number, eventType: string, levels: string[]) {
  const w = sponsorKindWords(eventType);
  const tile = TILES[Math.min(rank, TILES.length - 1)];
  return rank === 0
    ? `${tile.size}, listed first, and the first ${LIVE_NAMES} named on ${w.live} on ${w.day}`
    : `${tile.size}, after ${levels[rank - 1] ?? `the ${ordinal(rank)} level`}`;
}

/** Example level names, shown as examples only (never filled in). */
export const LEVEL_EXAMPLES = ["For example, Gold", "For example, Silver", "For example, Bronze", "For example, Friend"];

// ---------------------------------------------------------------------------------------------
// Logos: one short line where you upload, the full requirements one tap away, and the email to copy.
// ---------------------------------------------------------------------------------------------

/** The logo rule, said one way everywhere. */
export const LOGO_SHORT = `PNG or JPG, ${LOGO.minWidth} pixels wide or more, up to ${LOGO.maxMB} MB`;

/** The full requirements (light check: transparent background, "Best: 1200 × 400", one minimum). */
export const LOGO_SPEC: { k: string; v: string }[] = [
  { k: "File", v: "PNG (a transparent background is best) or JPG" },
  {
    k: "Size",
    v: `${LOGO.minWidth} pixels wide or more looks sharp. Smaller logos may look blurry, and we can't use logos under ${LOGO.refuseUnder} pixels wide. Best: ${LOGO.ideal[0]} × ${LOGO.ideal[1]} pixels, about 3 times as wide as tall`,
  },
  { k: "Square or tall logos", v: "They show smaller than wide ones: the same height, less wide, with the name under them" },
  { k: "File size", v: `Up to ${LOGO.maxMB} MB. We resize it to at most ${LOGO.resizeTo} pixels wide and make a copy for each level's size` },
  { k: "Not accepted", v: "PDF, SVG, Word, or PowerPoint files" },
  { k: "Don't work well", v: "Photos of banners or signs, and screenshots of a website" },
  { k: "Shows best", v: "Big, simple shapes with a little empty space around them. Tiny text and thin lines blur at small sizes" },
];

/** "Gold: up to 288 × 96" for each level (or one line without levels), from the tile sizes. */
export function tileSizes(levels: string[]) {
  if (!levels.length) return [`Every sponsor: up to ${TILES[1].w} × ${TILES[1].h}`];
  return levels.map((l, i) => `${l}: up to ${TILES[i].w} × ${TILES[i].h}${TILES[i].under ? ", with the name under it" : ""}`);
}

/** Where a logo appears, said in the requirements and in the email. */
export function logoWhere(eventType: string) {
  const w = sponsorKindWords(eventType);
  return `On the ${w.kind}'s public page, in the thank-you to sponsors near the end. The "Presented by" sponsor's logo also shows under the ${w.kind}'s name.`;
}

/** The email organizers copy to ask a sponsor for their logo (signed with their name and their group's). */
export function logoEmail({ event, date, eventType, sponsor, from, group }: { event: string; date: string; eventType: string; sponsor?: string; from: string; group: string }) {
  const w = sponsorKindWords(eventType);
  return `Subject: Your logo for ${event}

Hi${sponsor ? ` ${sponsor}` : ""},

Thank you for sponsoring ${event} on ${date}. We'd like to thank you on the ${w.kind}'s public page, in the thank-you to our sponsors near the end. Please send us your logo:

- a PNG with a transparent background (best) or a JPG
- ${LOGO.minWidth} pixels wide or more (${LOGO.ideal[0]} × ${LOGO.ideal[1]} pixels is best)
- a wide version if you have one, about 3 times as wide as tall
- up to ${LOGO.maxMB} MB

Please don't send a PDF, SVG, Word, or PowerPoint file, a photo of a banner or sign, or a screenshot of your website. Big, simple shapes with a little empty space around them show best.

Thank you,
${[from, group].filter(Boolean).join("\n")}`;
}

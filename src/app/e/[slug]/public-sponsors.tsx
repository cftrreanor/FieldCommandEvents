import {
  LIVE_NAMES,
  SPONSOR_LINK_REL,
  groupPublicSponsors,
  isNarrowLogo,
  logoBox,
  publicSponsorLogoUrl,
  tileFor,
  type PublicSponsor,
  type SponsorKind,
} from "@/lib/sponsors";

// The Sponsors add-on on the main public event page (docs/design-decisions/2026-11-12-sponsors.md): Presented by
// under the event's name, the thank-you section near the end, and on the day one short line at the end of the live
// list. Only src/app/e/[slug]/page.tsx renders these, with sponsors it loaded itself (loadPublicSponsors): never the
// layout, shared headers, metadata, other public pages, or emails.

/** Each kind's own words. */
export const SPONSOR_WORDS: Record<SponsorKind, { kind: string; back: string }> = {
  band_contest: { kind: "contest", back: "Back to the schedule" },
  group_event: { kind: "festival", back: "Back to Happening now" },
  fair: { kind: "fair", back: "Back to what's at the event" },
};

/**
 * Thank-you tiles (light check): white in light mode; in dark mode a dark tile like the page's cards, with the logo
 * on a small light plate inside it, so a wall of sponsors isn't the brightest thing on the page. Names stay in the
 * page's own text color. A linked tile has one cue: the field-border edge, the ↗, and its name underlined.
 */
const TILE_BASE = "rounded-md border bg-white text-foreground dark:bg-surface";
const TILE_EDGE = { linked: "border-field-border", plain: "border-border" };
/** The light plate a logo sits on (dark mode only: in light mode the tile is already white). */
const PLATE = "dark:rounded dark:bg-[#ECE9E2] dark:p-2";
/** Links on public pages: underlined, 44 px tall; the event's color in light mode, white in dark mode. */
const PUBLIC_LINK = "inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4 dark:text-foreground";
const NEW_TAB = <span className="sr-only"> (opens their website in a new tab)</span>;

/** A logo shown under this height is too thin to read alone (a very wide logo): its name goes under it. */
const READABLE_HEIGHT = 40;

function hasLogo(s: PublicSponsor): s is PublicSponsor & { logoVersion: string; logoWidth: number; logoHeight: number } {
  return Boolean(s.logoVersion && s.logoWidth && s.logoHeight);
}

/** Business names compared the way people read them: trimmed, ignoring letter case. */
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A fair's community partners (booth hosts), less anyone who's also a sponsor: they show once, as a sponsor. */
export function partnersNotSponsors(hosts: string[], sponsors: PublicSponsor[]) {
  const seen: string[] = [];
  return hosts.filter((h) => {
    if (sponsors.some((s) => sameName(s.name, h)) || seen.some((x) => sameName(x, h))) return false;
    seen.push(h);
    return true;
  });
}

/** The tallest a "Presented by" logo shows; under PRESENTED_MIN_H (a very wide logo) only the name shows. */
const PRESENTED_BOX = { w: 200, h: 48 };
const PRESENTED_MIN_H = 36;

/**
 * Under the event's name: the one "Presented by" sponsor. Its logo keeps its shape at about 40 to 48 px tall (width
 * following), on a light plate; a logo too thin to read at that size leaves just the name. The name is the link.
 */
export function PresentedBy({ slug, sponsors }: { slug: string; sponsors: PublicSponsor[] }) {
  const s = sponsors.find((x) => x.presentedBy);
  if (!s) return null;
  const size = hasLogo(s) ? logoBox(PRESENTED_BOX, s.logoWidth, s.logoHeight) : null;
  const src = size && size.height >= PRESENTED_MIN_H ? publicSponsorLogoUrl(slug, s, "t1") : null;
  const body = (
    <>
      {size && src && (
        <span className="flex shrink-0 items-center justify-center rounded-md border border-border bg-white p-1 dark:border-transparent dark:bg-[#ECE9E2]">
          {/* eslint-disable-next-line @next/next/no-img-element -- our own resized copy, served with long caching */}
          <img src={src} alt="" width={size.width} height={size.height} className="object-contain max-sm:h-10 max-sm:w-auto" />
        </span>
      )}
      <span className={`font-semibold [overflow-wrap:anywhere] ${s.website ? "underline underline-offset-4" : ""}`}>{s.name}</span>
      {s.website && (
        <>
          <span aria-hidden className="text-base leading-none">
            ↗
          </span>
          {NEW_TAB}
        </>
      )}
    </>
  );
  const link = "inline-flex min-h-11 items-center gap-2.5";
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-sm text-muted">Presented by</span>
      {s.website ? (
        <a href={s.website} target="_blank" rel={SPONSOR_LINK_REL} className={link}>
          {body}
        </a>
      ) : (
        <span className={link}>{body}</span>
      )}
    </p>
  );
}

/**
 * One sponsor's tile at its level's size: the logo at its real shape, the name under small, square, or tall logos.
 * Names wrap to 2 lines at most (the full name stays in the link's accessible name). Tiles in a level line up at
 * the same height.
 */
function SponsorTile({ slug, s, rank }: { slug: string; s: PublicSponsor; rank: number | null }) {
  const tile = tileFor(rank);
  const linked = Boolean(s.website);
  // pb-1: the clamp hides overflow, and the underline sits below the last line.
  const nameLine = "line-clamp-2 pb-1 text-center leading-snug [overflow-wrap:anywhere]";
  // The underline on an inner span, so it follows every wrapped line inside the clamp.
  const label = <span className={linked ? "underline underline-offset-4" : undefined}>{s.name}</span>;
  let inner;
  if (hasLogo(s)) {
    const size = logoBox(tile, s.logoWidth, s.logoHeight);
    const under = tile.under || isNarrowLogo(s.logoWidth, s.logoHeight) || size.height < READABLE_HEIGHT;
    inner = (
      <span className="flex w-full flex-col items-center gap-1.5">
        <span className={`flex max-w-full items-center justify-center ${PLATE}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- our own resized copy for this tile size, cached for a year */}
          <img
            src={publicSponsorLogoUrl(slug, s, tile.file)!}
            alt={under ? "" : s.name}
            width={size.width}
            height={size.height}
            loading="lazy"
            decoding="async"
            className="h-auto max-w-full object-contain"
          />
        </span>
        {under && <span className={`text-sm font-medium ${nameLine}`}>{label}</span>}
      </span>
    );
  } else {
    inner = <span className={`${tile.name} font-semibold ${nameLine}`}>{label}</span>;
  }
  const box = `relative flex h-full min-h-[4.5rem] items-center justify-center px-6 py-4 ${TILE_BASE} ${linked ? TILE_EDGE.linked : TILE_EDGE.plain}`;
  if (!s.website) return <div className={box}>{inner}</div>;
  return (
    <a href={s.website} target="_blank" rel={SPONSOR_LINK_REL} className={`${box} hover:border-brand`}>
      {inner}
      <span aria-hidden className="absolute top-1 right-1.5 text-base leading-none font-semibold text-muted">
        ↗
      </span>
      {NEW_TAB}
    </a>
  );
}

/**
 * "Thank you to our sponsors" near the end of the page, supporting the event (by name): by level, bigger first.
 * Fairs fold in their booth hosts as partners ("Thank you to our sponsors and partners"). On the day, a way back up
 * to the live part.
 */
export function SponsorThanks({
  slug,
  kind,
  sponsors,
  eventName,
  partners = [],
  backTo,
}: {
  slug: string;
  kind: SponsorKind;
  sponsors: PublicSponsor[];
  /** What they support: the event's name. */
  eventName: string;
  partners?: string[];
  /** On the day: the live part's id. */
  backTo?: string;
}) {
  if (sponsors.length === 0) return null;
  const words = SPONSOR_WORDS[kind];
  return (
    <section id="sponsors" aria-labelledby="sponsors-heading" className="mt-12 scroll-mt-6 border-t border-border pt-8">
      <h2 id="sponsors-heading" className="text-xl font-semibold">
        {partners.length ? "Thank you to our sponsors and partners" : "Thank you to our sponsors"}
      </h2>
      <p className="mt-1 text-muted">Supporting {eventName}</p>
      {groupPublicSponsors(sponsors).map((g) => (
        <div key={g.level ?? "all"} className="mt-6">
          {g.level && <h3 className="text-base font-semibold">{g.level}</h3>}
          <ul className={`mt-3 grid auto-rows-fr gap-3 ${tileFor(g.rank).grid}`}>
            {g.sponsors.map((s) => (
              <li key={s.id} className="h-full">
                <SponsorTile slug={slug} s={s} rank={g.rank} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {partners.length > 0 && (
        <div className="mt-8">
          <h3 className="text-base font-semibold">Partners</h3>
          <ul className="mt-2 grid gap-x-6 gap-y-1 leading-7 sm:grid-cols-2">
            {partners.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {backTo && (
        <p className="mt-6">
          <a href={`#${backTo}`} className={PUBLIC_LINK}>
            <span aria-hidden className="mr-1.5">
              ↑
            </span>
            {words.back}
          </a>
        </p>
      )}
    </section>
  );
}

/**
 * On the day, at the end of the live part: one sentence naming the highest showing level's first sponsors (or the
 * first two without levels), with the rest as a link down to the thank-you. No ring, and not the heading again.
 * "Today's sponsors: Ridge Line Pizza, Hill Country Credit Union, and 22 more ↓"
 */
export function SponsorLiveLine({ sponsors, className = "mt-6" }: { sponsors: PublicSponsor[]; className?: string }) {
  if (sponsors.length === 0) return null;
  const top = groupPublicSponsors(sponsors)[0].sponsors.slice(0, LIVE_NAMES).map((s) => s.name);
  const more = sponsors.length - top.length;
  const label = sponsors.length === 1 ? "Today's sponsor:" : "Today's sponsors:";
  return (
    <p className={`text-sm leading-6 ${className}`}>
      <span className="font-semibold">{label}</span>{" "}
      {more === 0 ? (
        top.length === 2 ? `${top[0]} and ${top[1]}` : top.join("")
      ) : (
        <>
          {top.length > 1 ? `${top.join(", ")}, ` : `${top[0]} `}
          {/* Inline, with padding around it for a 44 px tap area. */}
          <a href="#sponsors" className="-mx-1 rounded px-1 py-3 font-semibold text-brand underline underline-offset-4 dark:text-foreground">
            and {more} more<span className="sr-only"> {more === 1 ? "sponsor" : "sponsors"}</span>
            <span aria-hidden> ↓</span>
          </a>
        </>
      )}
    </p>
  );
}

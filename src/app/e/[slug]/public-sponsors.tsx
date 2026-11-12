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

/** Tiles: white in light mode, a soft off-white in dark mode so they don't glare. Name-only tiles match. */
const TILE = "border border-border bg-white text-[#1d2733] dark:border-transparent dark:bg-[#ECE9E2]";
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

/** Under the event's name: the one Presented by sponsor. Its logo keeps its shape; the name is an underlined link. */
export function PresentedBy({ slug, sponsors, onDay }: { slug: string; sponsors: PublicSponsor[]; onDay: boolean }) {
  const s = sponsors.find((x) => x.presentedBy);
  if (!s) return null;
  const narrow = hasLogo(s) && isNarrowLogo(s.logoWidth, s.logoHeight);
  const size = hasLogo(s) ? logoBox(narrow ? { w: 52, h: 52 } : { w: 160, h: 52 }, s.logoWidth, s.logoHeight) : null;
  const src = publicSponsorLogoUrl(slug, s, "t1");
  // On the day, phones get one short line (a smaller logo, the tap area kept at 44 px by overlapping the space
  // around it) so Up next stays on the first screen.
  const compact = onDay ? `max-sm:min-h-0 max-sm:px-1 max-sm:py-0.5 ${narrow ? "max-sm:size-[1.875rem]" : ""}` : "";
  const link = `inline-flex min-h-11 items-center gap-2.5 ${onDay ? "max-sm:-my-[7px]" : ""}`;
  const body = (
    <>
      {size && src && (
        <span className={`flex shrink-0 items-center justify-center rounded-md px-1.5 py-1.5 ${narrow ? "size-16" : "min-h-16"} ${TILE} ${compact}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- our own resized copy, served with long caching */}
          <img src={src} alt="" width={size.width} height={size.height} className={`object-contain ${onDay ? "max-sm:h-6 max-sm:w-auto" : ""}`} />
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
  return (
    <p className={`flex flex-wrap items-center gap-x-3 ${onDay ? "mt-1.5 gap-y-0 sm:mt-3 sm:gap-y-1" : "mt-3 gap-y-1"}`}>
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

/** One sponsor's tile at its level's size: the logo at its real shape, the name under small, square, or tall logos. */
function SponsorTile({ slug, s, rank }: { slug: string; s: PublicSponsor; rank: number | null }) {
  const tile = tileFor(rank);
  const linked = Boolean(s.website);
  let inner;
  if (hasLogo(s)) {
    const size = logoBox(tile, s.logoWidth, s.logoHeight);
    const under = tile.under || isNarrowLogo(s.logoWidth, s.logoHeight) || size.height < READABLE_HEIGHT;
    inner = (
      <span className="flex w-full flex-col items-center gap-1.5">
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
        {under && <span className={`text-center text-sm leading-snug font-medium [overflow-wrap:anywhere] ${linked ? "underline underline-offset-4" : ""}`}>{s.name}</span>}
      </span>
    );
  } else {
    inner = <span className={`${tile.name} text-center leading-snug font-semibold [overflow-wrap:anywhere] ${linked ? "underline underline-offset-4" : ""}`}>{s.name}</span>;
  }
  const box = `relative flex h-full min-h-[4.5rem] items-center justify-center rounded-md px-3 ${linked ? "py-5" : "py-3"} ${TILE}`;
  if (!s.website) return <div className={box}>{inner}</div>;
  return (
    <a href={s.website} target="_blank" rel={SPONSOR_LINK_REL} className={`${box} hover:border-brand dark:hover:border-brand`}>
      {inner}
      <span aria-hidden className="absolute top-1 right-1.5 text-base leading-none font-semibold text-[#4b5f72]">
        ↗
      </span>
      {NEW_TAB}
    </a>
  );
}

/**
 * "Thank you to our sponsors" near the end of the page: by level, bigger first. Fairs fold in their community
 * partners ("Thank you to our sponsors and partners"). On the day, a way back up to the live part.
 */
export function SponsorThanks({
  slug,
  kind,
  sponsors,
  group,
  partners = [],
  backTo,
}: {
  slug: string;
  kind: SponsorKind;
  sponsors: PublicSponsor[];
  /** Who's being supported: the account's name. */
  group: string | null;
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
      <p className="mt-1 text-muted">With thanks to everyone supporting {group?.trim() || `this ${words.kind}`}</p>
      {groupPublicSponsors(sponsors).map((g) => (
        <div key={g.level ?? "all"} className="mt-6">
          {g.level && <h3 className="text-base font-semibold">{g.level}</h3>}
          <ul className={`mt-3 grid gap-3 ${tileFor(g.rank).grid}`}>
            {g.sponsors.map((s) => (
              <li key={s.id}>
                <SponsorTile slug={slug} s={s} rank={g.rank} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {partners.length > 0 && (
        <div className="mt-8">
          <h3 className="text-base font-semibold">Community partners</h3>
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
 * On the day, at the end of the live list: the highest showing level's first names (or the first two without
 * levels), then a link to the rest. No ring, and not the thank-you heading again.
 */
export function SponsorLiveLine({ sponsors, className = "mt-6" }: { sponsors: PublicSponsor[]; className?: string }) {
  if (sponsors.length === 0) return null;
  const top = groupPublicSponsors(sponsors)[0].sponsors.slice(0, LIVE_NAMES).map((s) => s.name);
  const more = sponsors.length - top.length;
  return (
    <div className={`text-sm leading-6 ${className}`}>
      <p>
        <span className="font-semibold">Today&apos;s sponsors:</span> {more > 0 ? `${top.join(", ")},` : top.join(" and ")}
      </p>
      {more > 0 && (
        <a href="#sponsors" className={PUBLIC_LINK}>
          and {more} more {more === 1 ? "sponsor" : "sponsors"}
          <span aria-hidden className="ml-1">
            ↓
          </span>
        </a>
      )}
    </div>
  );
}

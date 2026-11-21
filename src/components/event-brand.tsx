import { HeaderBar } from "@/components/logo";
import { PublicNav } from "./public-nav";
import { eventLogoUrl, loadEventBrand } from "@/lib/event-brand";

/**
 * The header bar on an event's public pages: our logo, then the account's logo when there is one. The organization
 * page passes `org` (its own address, and no logo in the bar: the logo heads the page instead).
 */
export async function EventHeaderBar({
  slug,
  maxWidth = "max-w-2xl",
  org,
  children,
}: {
  slug: string;
  maxWidth?: string;
  org?: { href: string };
  children?: React.ReactNode;
}) {
  const src = org ? null : eventLogoUrl(slug, (await loadEventBrand(slug)).logoPath);
  return (
    <HeaderBar maxWidth={maxWidth} href={org?.href ?? `/e/${slug}`} eventLogo={src ? { src, alt: "Organizer logo" } : null}>
      {children ?? <PublicNav />}
    </HeaderBar>
  );
}

/**
 * The event name, date, and place at the top of an event's main public pages.
 * With an account color (`band`), a full-width band in that color with white
 * text, placed above the page's main column; without one, the standard
 * heading inside it.
 */
export function EventHeading({
  band,
  eyebrow,
  title,
  compact = false,
  children,
}: {
  band: boolean;
  eyebrow?: string;
  title: string;
  /** A short band (a confirm step), so the step's button shows without scrolling on a phone. */
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const inner = (
    <>
      {eyebrow && <p className="mb-1 text-sm font-medium text-muted">{eyebrow}</p>}
      <h1 className={`${compact ? "text-2xl sm:text-3xl" : "text-4xl sm:text-5xl"} font-medium tracking-tight [overflow-wrap:anywhere]`}>{title}</h1>
      {children}
    </>
  );
  if (!band) return <header className={compact ? "mt-2" : "mt-6"}>{inner}</header>;
  return (
    <header className="event-band bg-[var(--band)] text-white">
      <div className={`mx-auto w-full max-w-2xl px-4 ${compact ? "py-4 sm:py-6" : "py-10 sm:py-14"}`}>{inner}</div>
    </header>
  );
}

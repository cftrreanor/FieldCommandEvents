import Link from "next/link";
import type { ReactNode } from "react";
import { JumpLink } from "@/components/jump-link";
import { headerLinkClass } from "@/components/logo";

// The website's links to the pricing page, shown only while it's switched on (sitePricing() in
// src/lib/site-pricing.ts), and the header's main button, which follows the pilot's end (src/lib/pilot.ts).

export const PRICES = { href: "/pricing", label: "Prices" } as const;
/** An answer's or paragraph's link to the pricing page, only while it's live. */
export const PRICES_LINK = { href: PRICES.href, label: "See packages and prices" } as const;

/** For a page's Menu (phones): "Prices" next to "Pilot details", only while the page is live. */
export const pricesLinks = (live: boolean) => (live ? [PRICES] : []);

/** "Prices" in the header from `sm` up (phones have it in the Menu). */
export function PricesHeaderLink({ live }: { live: boolean }) {
  if (!live) return null;
  return (
    <Link href={PRICES.href} className={`hidden sm:block ${headerLinkClass}`}>
      {PRICES.label}
    </Link>
  );
}

/**
 * Where every "Get started" (and "Start free") goes: once the pilot is over and the pricing page is live, the pricing
 * request form, with the page's kind of event filled in; otherwise the form on the page (`joinHref`). One form, not two
 * (owner decision, follow-up check 2).
 */
export function startHref(site: { live: boolean; afterPilot: boolean }, joinHref: string, kinds: readonly string[] = []): string {
  if (!(site.afterPilot && site.live)) return joinHref;
  return `/pricing/ask?start=1${kinds.length ? `&kinds=${kinds.map(encodeURIComponent).join(",")}` : ""}`;
}

/** Whether "Get started" goes to the pricing request form, so the page's own form gives way to a button. */
export const startsOnPricingForm = (site: { live: boolean; afterPilot: boolean }) => site.afterPilot && site.live;

/** A call-to-action link: a jump down the page for "#join", else a page link. */
export function CtaLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (href.startsWith("#")) {
    return (
      <JumpLink href={href as `#${string}`} className={className}>
        {children}
      </JumpLink>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export const HEADER_CTA_CLASS =
  "inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-violet px-3 text-[13px] font-semibold text-header transition hover:brightness-90 sm:px-5 sm:text-sm";

/**
 * The header's main button. During the pilot: "Join the pilot" (or the page's own words) to the form on the page.
 * After it: "Get started", to the pricing request form while the pricing page is live, else to the form on the
 * page (docs/design-decisions/2026-11-22-pricing-page.md; Marketing and Engineer rulings on the header).
 */
export function HeaderCta({
  afterPilot,
  live,
  joinHref,
  label = "Join the pilot",
  kinds = [],
}: {
  afterPilot: boolean;
  live: boolean;
  /** The pilot form: "#join" on its own page, "/#join" elsewhere. */
  joinHref: string;
  label?: string;
  /** The page's kind of event, filled in on the request form. */
  kinds?: readonly string[];
}) {
  const text = afterPilot ? "Get started" : label;
  // The request form says where it came from: "Get started: ask about a package" (Content F10).
  return (
    <CtaLink href={startHref({ live, afterPilot }, joinHref, kinds)} className={HEADER_CTA_CLASS}>
      {text}
    </CtaLink>
  );
}

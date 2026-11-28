import Link from "next/link";
import { ADMINISTRATORS_PAGE, AUDIENCES, CONFERENCES_PAGE, MEETINGS_PAGE, STUDENT_PRIVACY_PAGE } from "@/lib/audiences";
import { brand } from "@/lib/brand";
import { PRICES } from "@/components/site-prices";
import { pricingPageLive } from "@/lib/site-pricing";

/** The marketing pages' footer: a link to each kind of event, plus Prices (while that page is live) and contact. */
export async function SiteFooter() {
  const live = await pricingPageLive();
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted sm:px-6">
        <nav aria-label="Event types">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {[...AUDIENCES, CONFERENCES_PAGE, MEETINGS_PAGE, ADMINISTRATORS_PAGE].map((a) => (
              <li key={a.path}>
                <Link href={a.path} className="inline-flex min-h-11 items-center hover:text-foreground">
                  {a.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-6 flex flex-col gap-2 border-t border-border pt-6 sm:flex-row sm:justify-between">
          <span>
            © {new Date().getFullYear()} {brand.name} · {brand.city}, {brand.region}
          </span>
          <span className="flex flex-wrap gap-x-6 gap-y-2">
            {live && (
              <Link href={PRICES.href} className="hover:text-foreground">
                {PRICES.label}
              </Link>
            )}
            <Link href={STUDENT_PRIVACY_PAGE.path} className="hover:text-foreground">
              {STUDENT_PRIVACY_PAGE.name}
            </Link>
            <a href={`mailto:${brand.supportEmail}`} className="hover:text-foreground">
              {brand.supportEmail}
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}

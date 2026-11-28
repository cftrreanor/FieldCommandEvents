import "server-only";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { PILOT_END } from "@/lib/pilot";
import { loadPricingPage, type PricingPage } from "@/lib/pricing";
import { schemaAwareFetch } from "@/lib/schema-check";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSupabaseEnv } from "@/lib/supabase/env";
import { utcToZonedDate } from "@/lib/time";

// What the website's pages need to know about the pricing page (docs/design-decisions/2026-11-22-pricing-page.md):
// whether the owner has switched it on (site_settings.pricing_page_live), and whether the free pilot is over.

/** The pilot's dates are Chicago dates (src/lib/pilot.ts); PILOT_END is its last free day. */
export function pilotOver(now = new Date()): boolean {
  return utcToZonedDate(now.toISOString(), "America/Chicago") > PILOT_END;
}

/**
 * Whether the pricing page is switched on, read with the server key (visitors can't read site_settings) and kept
 * for a minute, so every public page can ask without a database trip. Off when it can't be read (the database
 * update hasn't run, or no server key while building): links to the page only show when it surely exists.
 */
export const pricingPageLive = unstable_cache(
  async (): Promise<boolean> => {
    try {
      const { data, error } = await createAdminClient().from("site_settings").select("pricing_page_live").eq("id", true).maybeSingle();
      if (error) return false;
      return Boolean(data?.pricing_page_live);
    } catch {
      return false;
    }
  },
  ["pricing-page-live"],
  { revalidate: 60, tags: ["pricing-page"] },
);

/** Both answers at once, for a page's header, menu, and footer. */
export async function sitePricing(): Promise<{ live: boolean; afterPilot: boolean }> {
  return { live: await pricingPageLive(), afterPilot: pilotOver() };
}

/**
 * A visitor's client with no cookies, so the pricing page can be built once a minute for everyone (ISR). It reads
 * only pricing_page(), which returns nothing until the page is switched on.
 */
export function createAnonClient() {
  const { url, key } = requireSupabaseEnv();
  return createPlainClient(url, key, { auth: { persistSession: false }, global: { fetch: schemaAwareFetch } });
}

/**
 * The live pricing page's data, for the website's lines drawn from it (the home page's cost answer, a pass line on
 * the page for its kind of event). Null while the page is hidden or when it can't be read.
 */
export async function livePricingPage(live: boolean): Promise<PricingPage | null> {
  if (!live) return null;
  try {
    const load = await loadPricingPage(createAnonClient());
    return load.status === "ok" ? load.page : null;
  } catch {
    return null;
  }
}

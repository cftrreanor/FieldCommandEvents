import "server-only";
import { cache } from "react";
import { downloadLogo, loadOrgBrand, logoVersion } from "@/lib/org-brand";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * The look an event's public pages take from its account: the logo (served by
 * /e/[slug]/logo) and the color, unless the event has them switched off (Edit
 * event details). Logos and colors are public by nature, so our server reads
 * them for anyone. Works before the color and switch database updates too.
 */
export const loadEventBrand = cache(async (slug: string): Promise<{ logoPath: string | null; color: string | null }> => {
  const admin = createAdminClient();
  const withSwitch = await admin.from("events").select("organization_id, show_brand").eq("slug", slug).maybeSingle();
  const event = (
    withSwitch.error ? (await admin.from("events").select("organization_id").eq("slug", slug).maybeSingle()).data : withSwitch.data
  ) as { organization_id: string | null; show_brand?: boolean } | null;
  if (!event?.organization_id || event.show_brand === false) return { logoPath: null, color: null };
  return loadOrgBrand(event.organization_id);
});

/** The logo's address for an <img>; it changes when a new logo is uploaded, so browsers don't show the old one. */
export function eventLogoUrl(slug: string, logoPath: string | null) {
  if (!logoPath) return null;
  return `/e/${slug}/logo?v=${logoVersion(logoPath)}`;
}

/** The logo file itself, or null. */
export async function downloadEventLogo(slug: string) {
  return downloadLogo((await loadEventBrand(slug)).logoPath);
}

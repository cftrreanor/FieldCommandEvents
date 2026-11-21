import "server-only";
import { cache } from "react";
import { LOGO_BUCKET, LOGO_TYPES } from "@/lib/badges";
import { isHexColor } from "@/lib/brand-color";
import type { OrgListing } from "@/lib/org-page";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * An account's look on public pages: its logo and color. Logos and colors are public by nature, so our server reads
 * them for anyone. Works before the color database update too. Event pages read it through loadEventBrand (which
 * adds the event's own switch); the organization page through its listing.
 */
export const loadOrgBrand = cache(async (organizationId: string): Promise<{ logoPath: string | null; color: string | null }> => {
  const admin = createAdminClient();
  const withColor = await admin.from("organizations").select("logo_path, brand_color").eq("id", organizationId).maybeSingle();
  const org = (
    withColor.error ? (await admin.from("organizations").select("logo_path").eq("id", organizationId).maybeSingle()).data : withColor.data
  ) as { logo_path: string | null; brand_color?: string | null } | null;
  return { logoPath: org?.logo_path ?? null, color: brandColor(org?.brand_color) };
});

/** A saved color, or null when there's none (or it isn't a color). */
export const brandColor = (v: unknown) => (isHexColor(v) ? v : null);

/** The version part of a logo's address: it changes when a new logo is uploaded, so browsers don't show the old one. */
export const logoVersion = (logoPath: string) => logoPath.split("/").pop()?.split(".")[0] ?? "";

/** A logo file from storage, or null. */
export async function downloadLogo(logoPath: string | null) {
  if (!logoPath) return null;
  const { data: file } = await createAdminClient().storage.from(LOGO_BUCKET).download(logoPath);
  if (!file) return null;
  const type = file.type && (LOGO_TYPES as readonly string[]).includes(file.type) ? file.type : "image/png";
  return { body: await file.arrayBuffer(), type };
}

/**
 * The public organization page's listing (org_page_listing): null when the page is off, the account can't have one,
 * or the address is unknown. `missingDb` when the database update hasn't been run yet.
 */
export const loadOrgPage = cache(async (slug: string, limit = 100): Promise<{ listing: OrgListing | null; missingDb: boolean }> => {
  const { data, error } = await createAdminClient().rpc("org_page_listing", { p_slug: slug, p_limit: limit });
  if (error) {
    if (error.code !== "PGRST202" && error.code !== "42883") console.error("org_page_listing failed", error.message);
    return { listing: null, missingDb: error.code === "PGRST202" || error.code === "42883" };
  }
  return { listing: (data as OrgListing | null) ?? null, missingDb: false };
});

/** The organization page's logo address (served by /o/[slug]/logo while the page is on). */
export function orgLogoUrl(slug: string, logoPath: string | null) {
  return logoPath ? `/o/${slug}/logo?v=${logoVersion(logoPath)}` : null;
}

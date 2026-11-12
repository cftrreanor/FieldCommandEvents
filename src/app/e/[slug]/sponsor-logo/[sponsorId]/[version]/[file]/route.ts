import { downloadLogoFile } from "@/lib/sponsor-logos";
import { isTileFile } from "@/lib/sponsors";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A sponsor's logo for the main public event page, only while public_sponsors would show that sponsor with that
 * logo (published, the add-on on, shown, not removed; an event's hosts also preview a draft's), checked with one
 * lookup (public_sponsor_logo). The version in the address changes with every new logo, so a published one is
 * kept for a year by browsers and the CDN alike.
 */
export async function GET(_request: Request, { params }: RouteContext<"/e/[slug]/sponsor-logo/[sponsorId]/[version]/[file]">) {
  const { slug, sponsorId, version, file } = await params;
  const notFound = () => new Response("No logo", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!isTileFile(file) || !UUID.test(sponsorId) || !UUID.test(version)) return notFound();
  const { data } = await (await createClient()).rpc("public_sponsor_logo", { p_slug: slug, p_sponsor: sponsorId, p_version: version });
  const row = ((data ?? []) as { logo_path: string; published: boolean }[])[0];
  if (!row?.logo_path) return notFound();
  const logo = await downloadLogoFile(createAdminClient(), row.logo_path, file);
  if (!logo) return notFound();
  const cache: Record<string, string> = row.published
    ? { "Cache-Control": "public, max-age=31536000, immutable", "CDN-Cache-Control": "public, s-maxage=31536000, immutable" }
    : // A draft's preview is only for its hosts: never kept by shared caches.
      { "Cache-Control": "private, no-store" };
  return new Response(logo.body, { headers: { "Content-Type": logo.type, ...cache, "X-Content-Type-Options": "nosniff" } });
}

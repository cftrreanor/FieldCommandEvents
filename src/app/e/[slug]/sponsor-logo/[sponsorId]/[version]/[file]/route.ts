import { downloadLogoFile } from "@/lib/sponsor-logos";
import { isTileFile } from "@/lib/sponsors";
import { loadPublicSponsors } from "@/lib/sponsors-data";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * A sponsor's logo for the main public event page, only while public_sponsors shows that sponsor (published,
 * the add-on on, shown, not removed; an event's hosts also preview a draft's). The version in the address
 * changes with every new logo, so a published one is cached for a year.
 */
export async function GET(_request: Request, { params }: RouteContext<"/e/[slug]/sponsor-logo/[sponsorId]/[version]/[file]">) {
  const { slug, sponsorId, version, file } = await params;
  const notFound = () => new Response("No logo", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!isTileFile(file)) return notFound();
  const shown = (await loadPublicSponsors(slug)).find((s) => s.id === sponsorId && s.logoVersion === version);
  if (!shown) return notFound();
  const admin = createAdminClient();
  const [{ data: row }, { data: event }] = await Promise.all([
    admin.from("sponsors").select("logo_path").eq("id", sponsorId).maybeSingle(),
    admin.from("events").select("status").eq("slug", slug).maybeSingle(),
  ]);
  if (!row?.logo_path) return notFound();
  const logo = await downloadLogoFile(admin, row.logo_path, file);
  if (!logo) return notFound();
  return new Response(logo.body, {
    headers: {
      "Content-Type": logo.type,
      // A draft's preview is only for its hosts: never kept by shared caches.
      "Cache-Control": event?.status === "published" ? "public, max-age=31536000, immutable" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

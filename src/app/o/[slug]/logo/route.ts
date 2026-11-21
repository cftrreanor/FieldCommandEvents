import { downloadLogo, loadOrgPage } from "@/lib/org-brand";

/** The account's logo, for its organization page: only while the page is on (nothing about the group otherwise). */
export async function GET(_request: Request, { params }: RouteContext<"/o/[slug]/logo">) {
  const { listing } = await loadOrgPage((await params).slug, 0);
  const logo = await downloadLogo(listing?.org.logo_path ?? null);
  if (!logo) return new Response("No logo", { status: 404 });
  return new Response(logo.body, {
    headers: {
      "Content-Type": logo.type,
      // The address changes with each new logo (?v=), so it can be kept a while.
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

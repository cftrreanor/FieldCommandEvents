import { downloadLogo } from "@/lib/org-brand";
import { createAdminClient, createClient } from "@/lib/supabase/server";

/**
 * The account's logo, for its organization page: only while the page is on (org_page_logo reads that one value,
 * not the whole listing). Before it's on, the account's own hosts still get it, for the preview before turning it
 * on (the organizations policy lets only them read the account); nobody else learns anything about the group.
 */
export async function GET(_request: Request, { params }: RouteContext<"/o/[slug]/logo">) {
  const slug = (await params).slug;
  const { data: livePath, error } = await createAdminClient().rpc("org_page_logo", { p_slug: slug });
  let path = !error && typeof livePath === "string" ? livePath : null;
  let privately = false;
  if (!path) {
    const { data: own } = await (await createClient()).from("organizations").select("logo_path").eq("slug", slug).maybeSingle();
    path = (own?.logo_path as string | null | undefined) ?? null;
    privately = true;
  }
  const logo = await downloadLogo(path);
  if (!logo) return new Response("No logo", { status: 404 });
  return new Response(logo.body, {
    headers: {
      "Content-Type": logo.type,
      // The address changes with each new logo (?v=), so it can be kept a while (only by the host's own browser
      // when it's their preview).
      "Cache-Control": privately ? "private, max-age=300" : "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

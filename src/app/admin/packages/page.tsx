import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/admin";
import { loadTiers } from "@/lib/package-names";
import { createAdminClient } from "@/lib/supabase/server";
import { PageHeader } from "../kit";
import { PackagesGrid } from "./grid";

export const metadata: Metadata = { title: "Packages" };

/** What each package includes and costs, and each event pass's price. Changes apply to every account on the package. */
export default async function PackagesPage() {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const [tiers, { data: orgs }, { data: settings }] = await Promise.all([
    loadTiers(),
    admin.from("organizations").select("package"),
    admin.from("site_settings").select("pricing_page_live").maybeSingle(),
  ]);
  // Before the 20270114000000 update, packages have no prices yet; before 20270211000000, no website fields.
  const needs =
    !tiers.length || !("price_month_cents" in tiers[0])
      ? "20270114000000_package_admin.sql"
      : !("show_on_website" in tiers[0])
        ? "20270211000000_pricing_page.sql"
        : null;
  if (needs) {
    return (
      <div>
        <PageHeader title="Packages" />
        <p className="text-sm">
          This page needs a database update. Run <code>supabase/migrations/{needs}</code> in the Supabase SQL Editor.
        </p>
      </div>
    );
  }
  const counts: Record<string, number> = {};
  for (const o of (orgs ?? []) as { package: string }[]) counts[o.package] = (counts[o.package] ?? 0) + 1;
  return (
    <div>
      <PageHeader
        title="Packages"
        sub="What each package includes and costs. Select a box to change it. Changes apply to every account on that package right away."
      />
      <PackagesGrid
        packages={tiers.filter((t) => t.kind === "package")}
        passes={tiers.filter((t) => t.kind === "pass")}
        counts={counts}
        live={!!settings?.pricing_page_live}
      />
    </div>
  );
}

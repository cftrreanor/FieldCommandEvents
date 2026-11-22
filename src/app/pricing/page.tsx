import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brand } from "@/lib/brand";
import { loadPricingPage } from "@/lib/pricing";
import { missing } from "@/lib/schema-check";
import { createAnonClient, pilotOver } from "@/lib/site-pricing";
import { PricingView } from "./pricing-view";

// Built for everyone at once and refreshed every minute (ISR): read as a visitor, with no cookies. Admins preview
// it before it's switched on at /pricing/preview.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Packages and Prices",
  description: `${brand.name} packages and prices for schools, clubs, and community groups. Volunteers, families, and visiting directors never pay. Nothing renews or charges on its own.`,
  alternates: { canonical: "/pricing" },
};

export default async function PricingPage() {
  const load = await loadPricingPage(createAnonClient());
  // Not switched on: visitors get "not found" (a deliberate 404, not a missing database update).
  if (load.status === "hidden") notFound();
  if (load.status === "missing") missing();
  return <PricingView page={load.status === "ok" ? load.page : null} afterPilot={pilotOver()} />;
}

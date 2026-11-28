import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadPricingPage } from "@/lib/pricing";
import { PILOT_END_LABEL } from "@/lib/pilot";
import { missing } from "@/lib/schema-check";
import { pilotOver } from "@/lib/site-pricing";
import { createClient } from "@/lib/supabase/server";
import { LINK } from "../parts";
import { PreviewBanner, PricingView } from "../pricing-view";

export const metadata: Metadata = { title: "Packages and prices (preview)", robots: { index: false, follow: false } };

/**
 * An admin's look at the pricing page, live or not. pricing_page() returns it only to platform admins while the page
 * is off; anyone else gets "not found". It shows the words for the day the page goes live (after the pilot) unless
 * ?words=today asks for today's (PM F1: preview as of go-live day).
 */
export default async function PricingPreview({ searchParams }: { searchParams: Promise<{ words?: string }> }) {
  await requireUser();
  const supabase = await createClient();
  const { data: isAdmin, error } = await supabase.rpc("is_platform_admin");
  if (error) missing();
  if (!isAdmin) notFound();
  const load = await loadPricingPage(supabase);
  if (load.status === "missing") missing();
  if (load.status === "hidden") notFound();
  const today = (await searchParams).words === "today";
  const afterPilot = today ? pilotOver() : true;
  const live = load.status === "ok" && load.page.live;
  const wordsNote = pilotOver() ? null : today ? (
    <>
      Showing today&apos;s words.{" "}
      <Link href="/pricing/preview" className={LINK}>
        Show the words after {PILOT_END_LABEL}
      </Link>
    </>
  ) : (
    <>
      Showing the words for after {PILOT_END_LABEL}.{" "}
      <Link href="/pricing/preview?words=today" className={LINK}>
        Show today&apos;s words
      </Link>
    </>
  );
  const banner = live ? (
    wordsNote && (
      <div role="note" className="border-b border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-3 text-sm leading-6 sm:px-6">
          <span className="font-semibold">This page is public. </span>
          {wordsNote}
        </div>
      </div>
    )
  ) : (
    <PreviewBanner>{wordsNote}</PreviewBanner>
  );
  return <PricingView page={load.status === "ok" ? load.page : null} afterPilot={afterPilot} banner={banner} />;
}

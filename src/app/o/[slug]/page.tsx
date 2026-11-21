import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EventHeaderBar } from "@/components/event-brand";
import { brandThemeCss } from "@/lib/brand-color";
import { brandColor, loadOrgPage, orgLogoUrl } from "@/lib/org-brand";
import { todayIn, type OrgListing } from "@/lib/org-page";
import { missing } from "@/lib/schema-check";
import { createAdminClient } from "@/lib/supabase/server";
import { OrgBody, OrgFooter, OrgHeading, type ShiftFacts } from "./parts";

type Params = { params: Promise<{ slug: string }> };

// Not listed by search engines (owner decision 4, 2026-11-20): robots.ts also keeps /o/ out.
const ROBOTS = { index: false, follow: false } as const;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { listing } = await loadOrgPage((await params).slug);
  return { title: listing ? listing.org.name : "This page isn't available", robots: ROBOTS };
}

/**
 * When each listed event's shifts run (the first start and last end still to come), and its one open shift when only
 * one is left (the button then goes straight to it). Shifts are public, like the sign-up pages that show them.
 */
async function shiftFacts(slugs: string[]): Promise<Map<string, ShiftFacts>> {
  const facts = new Map<string, ShiftFacts>();
  if (!slugs.length) return facts;
  const { data } = await createAdminClient()
    .from("events")
    .select("slug, shifts(id, starts_at, ends_at, max_capacity, registered_count, stations(showing, signup_kind))")
    .in("slug", slugs)
    .gt("shifts.ends_at", new Date().toISOString());
  type Row = {
    slug: string;
    shifts: { id: string; starts_at: string; ends_at: string; max_capacity: number; registered_count: number; stations: { showing?: boolean; signup_kind?: string } | null }[];
  };
  for (const ev of (data ?? []) as unknown as Row[]) {
    const live = (ev.shifts ?? []).filter((s) => s.stations?.showing !== false && s.stations?.signup_kind !== "items");
    const open = live.filter((s) => s.max_capacity - s.registered_count > 0);
    const starts = live.map((s) => s.starts_at).sort();
    const ends = live.map((s) => s.ends_at).sort();
    facts.set(ev.slug, {
      range: live.length ? { start: starts[0], end: ends.at(-1)! } : null,
      onlyOpenShift: open.length === 1 ? open[0].id : null,
    });
  }
  return facts;
}

/**
 * Every event on the page is full or closed right now, though some are switched on and still to come: the page says
 * "Every spot is taken right now" instead of "Nothing's coming up".
 */
async function hasFullEvents(slug: string) {
  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("id").eq("slug", slug).maybeSingle();
  if (!org) return false;
  const { data } = await admin
    .from("events")
    // Something to take: shifts still to come, or things to bring (an event with neither isn't "full").
    .select("event_type, timezone, starts_on, ends_on, shifts(id), station_items(id)")
    .gt("shifts.ends_at", new Date().toISOString())
    .eq("organization_id", org.id)
    .eq("status", "published")
    .eq("on_org_page", true)
    .eq("volunteer_signup_open", true)
    .in("event_type", ["volunteer", "fair"]);
  type Row = { event_type: string; timezone: string; starts_on: string; ends_on: string; shifts: unknown[] | null; station_items: unknown[] | null };
  return ((data ?? []) as Row[]).some((e) => {
    const today = todayIn(e.timezone);
    const something = (e.shifts?.length ?? 0) > 0 || (e.station_items?.length ?? 0) > 0;
    return something && e.ends_on >= today && !(e.event_type === "fair" && today >= e.starts_on);
  });
}

/** The public organization page: the group's events with open spots, by month, then its ways to help anytime. */
export default async function OrgPage({ params }: Params) {
  const { slug } = await params;
  const { listing, missingDb } = await loadOrgPage(slug);
  if (missingDb) missing();
  // Off, a teacher account, suspended or closed, or an unknown address: "This page isn't available" (404).
  if (!listing) notFound();
  const { org, events, help } = listing as OrgListing;
  const color = brandColor(org.brand_color);
  const logo = orgLogoUrl(org.slug, org.logo_path);
  const [facts, allFull] = await Promise.all([shiftFacts(events.map((e) => e.slug)), events.length ? false : hasFullEvents(org.slug)]);
  const heading = <OrgHeading name={org.name} logo={logo} band={Boolean(color)} />;

  return (
    <>
      <div className="event-brand flex flex-1 flex-col">
        {color && <style>{brandThemeCss(".event-brand", color)}</style>}
        <EventHeaderBar slug={org.slug} org={{ href: `/o/${org.slug}` }} />
        {color && (
          <header className="event-band bg-[var(--band)] text-white">
            <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">{heading}</div>
          </header>
        )}
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-12">
          {!color && <header className="mt-2">{heading}</header>}
          <OrgBody name={org.name} contact={org.contact_email} events={events} help={help} facts={facts} allFull={allFull} />
        </main>
      </div>
      <OrgFooter />
    </>
  );
}

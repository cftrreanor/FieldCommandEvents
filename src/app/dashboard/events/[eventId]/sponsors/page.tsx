import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { brand } from "@/lib/brand";
import { requireUser } from "@/lib/auth";
import { getEventAccess, getOrigin } from "@/lib/data";
import { missing } from "@/lib/schema-check";
import { isSponsorKind } from "@/lib/sponsors";
import { loadEventSponsors, loadLastYearSource, loadReuseSources } from "@/lib/sponsors-data";
import { createClient } from "@/lib/supabase/server";
import { utcToZonedDate } from "@/lib/time";
import { StepPage } from "../conferences/step-page";
import { SponsorsManager, type SponsorsMode } from "./manager";
import { SponsorsOffLine } from "./sponsors-card";
import { sponsorKindWords } from "./words";

export const metadata: Metadata = { title: "Sponsors" };

/**
 * The Sponsors page (the Sponsors add-on, boards 3, 4, and 7): band contests, festivals, and fairs, for the event's
 * hosts on accounts with the add-on. On a band contest's or festival's draft, it's the optional Sponsors step (the
 * step page layout, "Next up: Publish"); fairs reach it from their event page's card. With the add-on off, sponsors
 * that were kept are said to be kept, and nothing can be changed.
 */
export default async function SponsorsPage({ params }: PageProps<"/dashboard/events/[eventId]/sponsors">) {
  const { eventId } = await params;
  const user = await requireUser();
  const supabase = await createClient();
  const [{ data: event }, access] = await Promise.all([
    supabase.from("events").select("id, slug, name, status, event_type, organization_id, starts_on, ends_on, timezone").eq("id", eventId).maybeSingle(),
    getEventAccess(eventId),
  ]);
  if (!event) missing();
  const back = `/dashboard/events/${eventId}`;
  if (!access.isHost || !isSponsorKind(event.event_type)) redirect(back);

  const data = await loadEventSponsors(eventId, event.organization_id, event.event_type);
  // Organizers without the add-on never see sponsor settings; with it off, only kept sponsors get a line.
  if (!data.enabled && data.sponsors.length === 0) redirect(back);

  const words = sponsorKindWords(event.event_type);
  const intro = `Thank the businesses and people who support your ${words.kind}. You arrange sponsorships and any payment yourself; ${brand.name} only shows them.`;
  const published = event.status === "published";
  const stepped = !published && (event.event_type === "band_contest" || event.event_type === "group_event");

  if (!data.enabled) {
    return (
      <div className="mx-auto max-w-3xl">
        {!stepped && (
          <Link href={back} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground">
            ← {event.name}
          </Link>
        )}
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Sponsors</h1>
        <Card className="mt-6">
          <SponsorsOffLine count={data.sponsors.length} />
        </Card>
      </div>
    );
  }

  const [lastYear, sources, { data: org }, { data: me }] = await Promise.all([
    loadLastYearSource(event, data),
    loadReuseSources(eventId),
    supabase.from("organizations").select("name").eq("id", event.organization_id).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  const today = utcToZonedDate(new Date().toISOString(), event.timezone);
  const mode: SponsorsMode = !published ? "draft" : today > event.ends_on ? "after" : "live";
  const publicUrl = `${await getOrigin()}/e/${event.slug}`;

  const body = (
    <SponsorsManager
      eventId={eventId}
      eventName={event.name}
      eventType={event.event_type}
      publicUrl={publicUrl}
      previewHref={`/e/${event.slug}`}
      mode={mode}
      stepped={stepped}
      levels={data.levels}
      sponsors={data.sponsors}
      lastYear={lastYear}
      sources={sources}
      from={(me?.full_name as string | null)?.trim() ?? ""}
      group={(org?.name as string | null) ?? ""}
    />
  );

  if (stepped) {
    // The optional Sponsors step: the step bar (from the layout), the step's title, a line about it, then the page.
    return (
      <StepPage eventId={eventId} title="Sponsors" intro={intro} area={null}>
        {body}
      </StepPage>
    );
  }
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={back} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground">
        ← {event.name}
      </Link>
      <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Sponsors</h1>
      <p className="mt-2 text-muted">{intro}</p>
      <div className="mt-6">{body}</div>
    </div>
  );
}

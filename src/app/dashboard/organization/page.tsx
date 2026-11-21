import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { getOrigin } from "@/lib/data";
import { brandColor, loadOrgBrand, logoVersion } from "@/lib/org-brand";
import { loadOrgPageAccounts, orgPageHref } from "@/lib/org-page-summary";
import type { OrgListingEvent } from "@/lib/org-page";
import { addDays, isOrgPageKind, NEVER_LISTED, shortDay, type EventOrgPageStatus, type OrgPageSummary } from "@/lib/org-page-words";
import { isSchemaError, missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { utcToZonedDate } from "@/lib/time";
import { signupState } from "@/lib/volunteer-signup";
import type { HelpItem } from "../org-page-actions";
import { HelpAnytime } from "./help-anytime";
import type { OrgPageNeed } from "@/components/org-page-switch";
import { EventsList, type OrgEventRow } from "./events-list";
import { StatusCard, TurnOff } from "./on-page";
import { OffAndTurnOn, type PickEvent, type PreviewEvent } from "./turn-on";

export const metadata: Metadata = { title: "Organization page" };

type EventRow = {
  id: string;
  name: string;
  slug: string;
  event_type: string;
  status: string;
  starts_on: string;
  ends_on: string;
  timezone: string;
  on_org_page: boolean;
  org_page_needs_review: boolean;
  volunteer_signup_open: boolean;
  volunteer_signup_opens_on: string | null;
};

type Listing = {
  events: { slug: string; open_spots: number; items_needed: number; opens_on: string | null; happening_now?: boolean }[];
} | null;

/**
 * The Organization page (docs/design-decisions/2026-11-20-organization-page.md): one public page for the account's
 * volunteer events and fairs, and its ways to help anytime. Only the Account Host and Co-hosts of every event
 * (is_org_admin) open it; it opens from the Account page and My events. Someone who runs more than one account picks
 * it with ?org= (each card links to its own); every action checks is_org_admin for that account in the database.
 */
export default async function OrganizationPage({ searchParams }: PageProps<"/dashboard/organization">) {
  const wanted = (await searchParams).org;
  const supabase = await createClient();
  // Only is_org_admin can read an account at all (the organizations policy), so anyone else lands back home.
  const accounts = await loadOrgPageAccounts(supabase);
  const account = accounts.find((a) => a.id === wanted) ?? accounts[0];
  if (!account) redirect("/dashboard");
  const org = { id: account.id, default_timezone: account.default_timezone };
  const { data: admin } = await supabase.rpc("is_org_admin", { org: org.id });
  if (!admin) redirect("/dashboard");
  const switcher = accounts.length > 1 ? accounts.map((a) => ({ id: a.id, name: a.name, current: a.id === org.id })) : null;
  const { data: summaryData, error: summaryError } = await supabase.rpc("org_page_summary", { p_org: org.id });
  if (summaryError || !summaryData) {
    if (!isSchemaError(summaryError)) console.error("org_page_summary", summaryError);
    missing();
  }
  const summary = summaryData as OrgPageSummary;
  const today = utcToZonedDate(new Date().toISOString(), org.default_timezone || "America/Chicago");

  const [{ data: eventData, error: eventsError }, { data: helpData }, origin] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, slug, event_type, status, starts_on, ends_on, timezone, on_org_page, org_page_needs_review, volunteer_signup_open, volunteer_signup_opens_on")
      .eq("organization_id", org.id)
      .order("starts_on")
      .order("name"),
    supabase.from("org_help_items").select("id, title, note, link, ends_on").eq("organization_id", org.id).order("ends_on").order("created_at"),
    getOrigin(),
  ]);
  if (eventsError) missing();
  const events = (eventData ?? []) as EventRow[];
  const help = (helpData ?? []) as HelpItem[];
  const evToday = (e: EventRow) => utcToZonedDate(new Date().toISOString(), e.timezone);
  const kinds = events.filter((e) => isOrgPageKind(e.event_type));
  const upcoming = kinds.filter((e) => e.ends_on >= evToday(e));
  // Ended in the last year, folded under the list.
  const ended = kinds.filter((e) => e.ends_on < evToday(e) && e.ends_on >= `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`).reverse();
  // Other kinds coming up, named once so nobody wonders where they went.
  const others = events.filter((e) => !isOrgPageKind(e.event_type) && e.ends_on >= evToday(e));
  const url = summary.slug ? `${origin}/o/${summary.slug}` : null;

  if (summary.blocked) {
    return (
      <Shell orgName={summary.name} switcher={switcher}>
        <Card>
          <h2 className="text-lg font-semibold">
            {summary.blocked === "teacher"
              ? "Teacher accounts don't have an organization page"
              : summary.blocked === "suspended"
                ? "This account is suspended, so its organization page is off"
                : "This account is closed, so its organization page is off"}
          </h2>
        </Card>
      </Shell>
    );
  }

  if (!summary.page_on) {
    const pick: PickEvent[] = upcoming.map((e) => {
      const s = signupState(e);
      return {
        id: e.id,
        name: e.name,
        kind: e.event_type,
        startsOn: e.starts_on,
        endsOn: e.ends_on,
        draft: e.status !== "published",
        signup: s === "draft" ? null : s === "later" ? `Sign-up opens ${shortDay(e.volunteer_signup_opens_on!)}` : s === "open" ? "Sign-up open" : "Sign-up closed",
      };
    });
    // The preview before turning on is the real page: its parts, the group's color and logo, and what each event
    // would show today (worked out here, since the public read only answers once the page is on).
    const [look, previewFacts] = await Promise.all([loadOrgBrand(org.id), previewListing(supabase, upcoming)]);
    const logoUrl = look.logoPath ? `/o/${account.summary.slug ?? (await currentSlug(supabase, org.id))}/logo?v=${logoVersion(look.logoPath)}` : null;
    return (
      <Shell orgName={summary.name} switcher={switcher}>
        <OffAndTurnOn
          orgId={org.id}
          name={summary.name}
          contact={summary.contact_email ?? ""}
          events={pick}
          help={help.filter((h) => h.ends_on >= today)}
          url={url}
          look={{ color: brandColor(look.color), logo: logoUrl }}
          preview={previewFacts}
        />
      </Shell>
    );
  }

  // On: each event's status, from the same function Event settings and the Publish step read (lesson L1).
  const [statuses, listing] = await Promise.all([
    Promise.all(upcoming.map(async (e) => [e.id, (await supabase.rpc("event_org_page_status", { p_event: e.id })).data as EventOrgPageStatus | null] as const)),
    supabase.rpc("org_page_listing", { p_slug: summary.slug }).then((r) => r.data as Listing),
  ]);
  const statusOf = new Map(statuses);
  const needOf = new Map<string, OrgPageNeed>(
    (listing?.events ?? []).map((x) => [x.slug, { spots: x.open_spots, items: x.items_needed, opensOn: x.opens_on, now: Boolean(x.happening_now) }]),
  );
  const rows: OrgEventRow[] = upcoming
    .map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.event_type,
      startsOn: e.starts_on,
      endsOn: e.ends_on,
      draft: e.status !== "published",
      status: statusOf.get(e.id) ?? null,
      need: needOf.get(e.slug) ?? null,
    }))
    .filter((r): r is OrgEventRow & { status: EventOrgPageStatus } => r.status != null);

  return (
    <Shell orgName={summary.name} switcher={switcher}>
      <StatusCard orgId={org.id} url={url!} name={summary.name} contact={summary.contact_email ?? ""} />
      <EventsList
        orgName={summary.name}
        rows={rows}
        toReview={summary.new_to_review}
        ended={ended.map((e) => ({ id: e.id, name: e.name, startsOn: e.starts_on }))}
        others={others.map((e) => e.name)}
        neverLine={NEVER_LISTED}
      />
      <HelpAnytime orgId={org.id} items={help} today={today} />
      <TurnOff orgId={org.id} />
    </Shell>
  );
}

function Shell({
  orgName,
  switcher,
  children,
}: {
  orgName: string;
  /** More than one account: one link each, the current one marked. */
  switcher: { id: string; name: string; current: boolean }[] | null;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/dashboard/account" className="mb-3 inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground">
          ← Account
        </Link>
        {switcher && (
          <nav aria-label="Your accounts" className="mb-3 flex flex-wrap gap-2">
            {switcher.map((a) => (
              <Link
                key={a.id}
                href={orgPageHref(a.id)}
                aria-current={a.current ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold [overflow-wrap:anywhere] ${
                  a.current ? "border-brand bg-brand-soft" : "border-field-border bg-surface hover:border-brand"
                }`}
              >
                {a.name}
              </Link>
            ))}
          </nav>
        )}
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Organization page</h1>
        <p className="mt-2 max-w-2xl leading-7 text-muted">
          One public page for <span className="[overflow-wrap:anywhere]">{orgName}</span>: the volunteer events and fairs you choose, and ways to help anytime.
          While it&apos;s on, each event&apos;s sign-up page also shows the soonest open spots at your other events.
        </p>
      </div>
      {children}
    </div>
  );
}


/** The account's address part (organizations.slug) for the logo's address before the page's first turn-on. */
async function currentSlug(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string) {
  const { data } = await supabase.from("organizations").select("slug").eq("id", orgId).maybeSingle();
  return (data?.slug as string | undefined) ?? "";
}

/**
 * What each upcoming event would show on the page today, for the preview before turning on: the same facts the
 * public read gives (org_page_rows), worked out from the event's own shifts and things to bring, since the public
 * read answers only once the page is on. `why`: why it wouldn't be listed today (null when it would).
 */
async function previewListing(supabase: Awaited<ReturnType<typeof createClient>>, events: EventRow[]): Promise<PreviewEvent[]> {
  if (!events.length) return [];
  const { data } = await supabase
    .from("events")
    .select(
      "id, slug, name, event_type, status, starts_on, ends_on, timezone, venue_name, volunteer_signup_open, volunteer_signup_opens_on, shifts(id, starts_at, ends_at, max_capacity, registered_count, stations(name, showing, signup_kind)), station_items(needed, claimed_count, stations(showing))",
    )
    .in(
      "id",
      events.map((e) => e.id),
    );
  type Row = EventRow & {
    venue_name: string | null;
    shifts: { id: string; starts_at: string; ends_at: string; max_capacity: number; registered_count: number; stations: { name: string; showing?: boolean; signup_kind?: string } | null }[] | null;
    station_items: { needed: number; claimed_count: number; stations: { showing?: boolean } | null }[] | null;
  };
  const now = new Date();
  return ((data ?? []) as unknown as Row[]).map((e) => {
    const today = utcToZonedDate(now.toISOString(), e.timezone);
    const live = (e.shifts ?? []).filter((s) => s.stations?.showing !== false && s.stations?.signup_kind !== "items" && new Date(s.ends_at) > now);
    const toStart = live.filter((s) => new Date(s.starts_at) > now);
    const room = (s: (typeof live)[number]) => Math.max(s.max_capacity - s.registered_count, 0);
    const openToStart = toStart.filter((s) => room(s) > 0).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const spots = toStart.reduce((n, s) => n + room(s), 0);
    const items = (e.station_items ?? []).filter((i) => i.stations?.showing !== false).reduce((n, i) => n + Math.max(i.needed - i.claimed_count, 0), 0);
    const happeningNow = live.some((s) => new Date(s.starts_at) <= now);
    const nowOpen = live.some((s) => new Date(s.starts_at) <= now && room(s) > 0);
    const state = signupState(e);
    const yearOut = addDays(today, 365);
    const why =
      e.status !== "published"
        ? "a draft: it shows once you publish it"
        : e.ends_on < today
          ? "over"
          : e.event_type === "fair" && today >= e.starts_on
            ? "online sign-up closes on fair day"
            : e.starts_on > yearOut
              ? "more than a year away"
              : state === "later"
                ? null
                : state !== "open"
                  ? "sign-up is closed"
                  : spots === 0 && items === 0 && !nowOpen
                    ? "full"
                    : null;
    const first = openToStart[0];
    const listing: OrgListingEvent = {
      slug: e.slug,
      name: e.name,
      kind: e.event_type,
      starts_on: e.starts_on,
      ends_on: e.ends_on,
      timezone: e.timezone,
      venue_name: e.venue_name,
      open_spots: spots,
      items_needed: items,
      opens_on: state === "later" ? e.volunteer_signup_opens_on : null,
      happening_now: happeningNow,
      soonest_shift: first ? { id: first.id, starts_at: first.starts_at, ends_at: first.ends_at, job: first.stations?.name ?? "" } : null,
    };
    const starts = live.map((s) => s.starts_at).sort();
    const ends = live.map((s) => s.ends_at).sort();
    return {
      id: e.id,
      why,
      listing,
      facts: { range: live.length ? { start: starts[0], end: ends.at(-1)! } : null, onlyOpenShift: openToStart.length === 1 ? openToStart[0].id : null },
    };
  });
}

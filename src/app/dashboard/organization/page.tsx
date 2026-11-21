import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { getMyOrganization, getOrigin } from "@/lib/data";
import { isOrgPageKind, NEVER_LISTED, shortDay, type EventOrgPageStatus, type OrgPageSummary } from "@/lib/org-page-words";
import { isSchemaError, missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { utcToZonedDate } from "@/lib/time";
import { signupState } from "@/lib/volunteer-signup";
import type { HelpItem } from "../org-page-actions";
import { HelpAnytime } from "./help-anytime";
import { EventsList, type OrgEventRow } from "./events-list";
import { StatusCard, TurnOff } from "./on-page";
import { OffAndTurnOn, type PickEvent } from "./turn-on";

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
  events: { slug: string; open_spots: number; items_needed: number; opens_on: string | null }[];
} | null;

/**
 * The Organization page (docs/design-decisions/2026-11-20-organization-page.md): one public page for the account's
 * volunteer events and fairs, and its ways to help anytime. Only the Account Host and Co-hosts of every event
 * (is_org_admin) open it; it opens from the Account page and My events.
 */
export default async function OrganizationPage() {
  const org = await getMyOrganization();
  // Only is_org_admin can read an account at all (the organizations policy), so anyone else lands back home.
  if (!org) redirect("/dashboard");
  const supabase = await createClient();
  const { data: admin } = await supabase.rpc("is_org_admin", { org: org.id });
  if (!admin) redirect("/dashboard");
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
      <Shell orgName={summary.name}>
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
    return (
      <Shell orgName={summary.name}>
        <OffAndTurnOn
          orgId={org.id}
          name={summary.name}
          contact={summary.contact_email ?? ""}
          events={pick}
          help={help.filter((h) => h.ends_on >= today)}
          url={url}
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
  const needOf = new Map((listing?.events ?? []).map((x) => [x.slug, { spots: x.open_spots, items: x.items_needed, opensOn: x.opens_on }]));
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
    <Shell orgName={summary.name}>
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

function Shell({ orgName, children }: { orgName: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/dashboard/account" className="mb-3 inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground">
          ← Account
        </Link>
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


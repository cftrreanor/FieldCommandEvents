import "server-only";
import { createAdminClient, type createClient } from "@/lib/supabase/server";
import { addDays, isOrgPageKind, shortDay, type EventOrgPageStatus, type OrgPageSummary } from "@/lib/org-page-words";

/**
 * The account's organization page at a glance, for the Account card and the My events card: null for anyone who
 * can't open the page (not the Account Host or a Co-host of every event), teacher accounts, and before the
 * database update has been run.
 */
export async function loadOrgPageSummary(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string): Promise<OrgPageSummary | null> {
  const { data: admin } = await supabase.rpc("is_org_admin", { org: orgId });
  if (!admin) return null;
  const { data, error } = await supabase.rpc("org_page_summary", { p_org: orgId });
  if (error || !data) return null;
  const s = data as OrgPageSummary;
  return s.blocked === "teacher" ? null : s;
}

/** "5 events shown · Classroom wish list ends Fri, Nov 27", or the off state. New events to review are said first, on their own, with a Review link. */
export function orgPageCardWords(s: OrgPageSummary, today: string): string {
  if (s.blocked) return "Off · nothing shown";
  if (!s.page_on) return "Off · nothing shown";
  const parts = [s.events_shown ? `${s.events_shown} ${s.events_shown === 1 ? "event" : "events"} shown` : "On · nothing shown right now"];
  // The way to help ending soonest, when it ends within two weeks (so it doesn't drop off unnoticed).
  const soon = s.help_ending_soonest;
  if (soon && soon.ends_on <= addDays(today, 14)) parts.push(`${soon.title} ${soon.ends_on === today ? "ends today" : `ends ${shortDay(soon.ends_on)}`}`);
  return parts.join(" · ");
}


/**
 * One event's place on the organization page, for its hosts (Event settings and the Publish step): its status
 * (event_org_page_status), its open spots when it's listed, and the account's name for the Co-host of one event's
 * line (they can't read the account itself, so our server reads its name, which every public page shows anyway).
 * Null for other kinds, people who aren't the event's hosts, and before the database update.
 */
export async function loadEventOrgPage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  event: { id: string; slug: string; organization_id: string; event_type: string | null },
): Promise<{ status: EventOrgPageStatus; need: { spots: number; items: number; opensOn: string | null; now: boolean } | null; orgName: string } | null> {
  if (!isOrgPageKind(event.event_type)) return null;
  const { data, error } = await supabase.rpc("event_org_page_status", { p_event: event.id });
  if (error || !data) return null;
  const status = data as EventOrgPageStatus;
  const [{ data: org }, listing] = await Promise.all([
    createAdminClient().from("organizations").select("name").eq("id", event.organization_id).maybeSingle(),
    status.listed && status.page_slug
      ? supabase.rpc("org_page_listing", { p_slug: status.page_slug }).then((r) => r.data as { events?: { slug: string; open_spots: number; items_needed: number; opens_on: string | null; happening_now?: boolean }[] } | null)
      : Promise.resolve(null),
  ]);
  const mine = listing?.events?.find((x) => x.slug === event.slug);
  return {
    status,
    need: mine ? { spots: mine.open_spots, items: mine.items_needed, opensOn: mine.opens_on, now: Boolean(mine.happening_now) } : null,
    orgName: (org?.name as string | undefined) ?? "your account",
  };
}

export type OrgPageAccount = { id: string; name: string; default_timezone: string | null; summary: OrgPageSummary };

/**
 * Every account this person can run the organization page for (the Account Host or a Co-host of every event:
 * the organizations policy lets them read only those), each with its summary, oldest account first. Teacher
 * accounts and anyone else's accounts are left out. One card per account on My events and the Account page.
 */
export async function loadOrgPageAccounts(supabase: Awaited<ReturnType<typeof createClient>>): Promise<OrgPageAccount[]> {
  const { data } = await supabase.from("organizations").select("id, name, default_timezone").order("created_at").limit(20);
  const rows = (data ?? []) as { id: string; name: string; default_timezone: string | null }[];
  const withSummary = await Promise.all(rows.map(async (o) => ({ ...o, summary: await loadOrgPageSummary(supabase, o.id) })));
  return withSummary.filter((o): o is OrgPageAccount => o.summary != null);
}

/** The Organization page's address for one account. */
export const orgPageHref = (orgId: string) => `/dashboard/organization?org=${orgId}`;

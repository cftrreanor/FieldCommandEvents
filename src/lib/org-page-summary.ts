import "server-only";
import { createAdminClient, type createClient } from "@/lib/supabase/server";
import { addDays, isOrgPageKind, shortDay, toReview, type EventOrgPageStatus, type OrgPageSummary } from "@/lib/org-page-words";

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

/** "5 events shown · Classroom wish list ends Fri, Nov 27 · 1 new event to review", or the off state. */
export function orgPageCardWords(s: OrgPageSummary, today: string): string {
  if (s.blocked) return "Off · nothing shown";
  if (!s.page_on) return "Off · nothing shown";
  const parts = [s.events_shown ? `${s.events_shown} ${s.events_shown === 1 ? "event" : "events"} shown` : "On · nothing shown right now"];
  // The way to help ending soonest, when it ends within two weeks (so it doesn't drop off unnoticed).
  const soon = s.help_ending_soonest;
  if (soon && soon.ends_on <= addDays(today, 14)) parts.push(`${soon.title} ${soon.ends_on === today ? "ends today" : `ends ${shortDay(soon.ends_on)}`}`);
  if (s.new_to_review) parts.push(toReview(s.new_to_review));
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
): Promise<{ status: EventOrgPageStatus; need: { spots: number; items: number; opensOn: string | null } | null; orgName: string } | null> {
  if (!isOrgPageKind(event.event_type)) return null;
  const { data, error } = await supabase.rpc("event_org_page_status", { p_event: event.id });
  if (error || !data) return null;
  const status = data as EventOrgPageStatus;
  const [{ data: org }, listing] = await Promise.all([
    createAdminClient().from("organizations").select("name").eq("id", event.organization_id).maybeSingle(),
    status.listed && status.page_slug
      ? supabase.rpc("org_page_listing", { p_slug: status.page_slug }).then((r) => r.data as { events?: { slug: string; open_spots: number; items_needed: number; opens_on: string | null }[] } | null)
      : Promise.resolve(null),
  ]);
  const mine = listing?.events?.find((x) => x.slug === event.slug);
  return {
    status,
    need: mine ? { spots: mine.open_spots, items: mine.items_needed, opensOn: mine.opens_on } : null,
    orgName: (org?.name as string | undefined) ?? "your account",
  };
}

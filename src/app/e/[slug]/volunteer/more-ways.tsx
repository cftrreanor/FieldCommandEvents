import { isSchemaError } from "@/lib/schema-check";
import type { OrgListing } from "@/lib/org-page";
import { createAdminClient } from "@/lib/supabase/server";
import { MoreWaysBlock, type MoreMode } from "./more-ways-block";
import { heldShiftIds, loadRemembered } from "./remembered";

/**
 * "More ways to help from [Org]" on an event's volunteer sign-up page, only while the account's organization page
 * is on (org_page_listing returns null otherwise). Rendered inside <Suspense> so it never holds up the page. The
 * listing leaves out this event, the shifts this device holds, anything at the same time as those, and shifts already
 * under way.
 */
export async function MoreWays({ eventId, mode }: { eventId: string; mode: MoreMode }) {
  const admin = createAdminClient();
  const [held, remembered] = await Promise.all([heldShiftIds(), loadRemembered(eventId)]);
  const { data, error } = await admin.rpc("org_page_listing", { p_event: eventId, p_skip_shifts: held, p_limit: 12 });
  if (error) {
    if (!isSchemaError(error)) console.error("org_page_listing (more ways) failed", error.message);
    return null;
  }
  const listing = data as OrgListing | null;
  if (!listing || (!listing.events.length && !listing.help.length)) return null;
  // Candidates: a few more than the three shown, so a shift booked here can drop one out without leaving a gap.
  const events = listing.events.filter((e) => !e.opens_on).slice(0, 6);
  // Open spots on each suggested shift (shifts are public, like the sign-up pages that show them).
  const shiftIds = events.map((e) => e.soonest_shift?.id).filter((id): id is string => Boolean(id));
  const { data: rows } = shiftIds.length
    ? await admin.from("shifts").select("id, max_capacity, registered_count").in("id", shiftIds)
    : { data: [] };
  const spots = Object.fromEntries(((rows ?? []) as { id: string; max_capacity: number; registered_count: number }[]).map((s) => [s.id, Math.max(s.max_capacity - s.registered_count, 0)]));
  return (
    <MoreWaysBlock
      mode={mode}
      org={{ name: listing.org.name, slug: listing.org.slug }}
      events={events}
      help={listing.help}
      spots={spots}
      // Details carry over only for a remembered adult with a phone on file (minors use the full form).
      carries={Boolean(remembered && !remembered.minor && remembered.phone)}
    />
  );
}

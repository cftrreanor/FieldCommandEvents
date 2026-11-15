import { type NextRequest } from "next/server";
import { buildIcs } from "@/lib/ics";
import { ADULTS, otherAdultNames, parentLink, toIcsEvent, type Child } from "@/lib/parents";
import { createAdminClient } from "@/lib/supabase/server";

// "Apple / Outlook" on a parent's registration link. The private link is the
// key, the same as the page itself. It matches the emailed invite, so adding
// it again updates that calendar entry instead of making a second one.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) return new Response("Not found", { status: 404 });
  const admin = createAdminClient();
  const { data: reg } = await admin
    .from("parent_registrations")
    .select(`id, event_id, parent_name, email, children, calendar_sequence, ${ADULTS}`)
    .eq("access_token", token)
    .maybeSingle();
  const { data: event } = reg
    ? await admin
        .from("events")
        .select("slug, name, starts_on, ends_on, window_start, window_end, timezone, venue_name, venue_address")
        .eq("id", reg.event_id)
        .maybeSingle()
    : { data: null };
  if (!reg || !event || event.slug !== slug) return new Response("Not found", { status: 404 });

  const ics = toIcsEvent(
    { ...reg, children: (reg.children ?? []) as Child[], other_adults: otherAdultNames(reg.adults) },
    event,
    parentLink(request.nextUrl.origin, slug, token),
  );
  return new Response(buildIcs("PUBLISH", ics), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="visit.ics"',
      "Cache-Control": "private, no-store",
    },
  });
}

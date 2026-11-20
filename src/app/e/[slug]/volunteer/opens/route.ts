import { type NextRequest } from "next/server";
import { buildIcs } from "@/lib/ics";
import { createClient } from "@/lib/supabase/server";
import { zonedToUtc } from "@/lib/time";
import { signupOpensClock, signupState } from "@/lib/volunteer-signup";

// "Add a reminder to my calendar" on the volunteer sign-up page before it opens: a 15-minute reminder at 8:00 AM on
// the opening day, linking back to the page (like registration's, bands/opens). Only for a published event whose
// sign-up is waiting for its day (the public can read published events). Nothing is emailed.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, name, status, timezone, volunteer_signup_open, volunteer_signup_opens_on")
    .eq("slug", slug)
    .maybeSingle();
  if (!event || signupState(event) !== "later" || !event.volunteer_signup_opens_on) {
    return new Response("Volunteer sign-up isn't waiting to open.", { status: 404 });
  }
  const start = zonedToUtc(event.volunteer_signup_opens_on, "08:00", event.timezone);
  const ics = buildIcs("PUBLISH", {
    uid: `volunteer-signup-opens-${event.id}`,
    timezone: event.timezone,
    sequence: 0,
    start,
    end: new Date(start.getTime() + 15 * 60_000),
    summary: `Sign up to volunteer: ${event.name}`,
    description: `Volunteer sign-up opened at ${signupOpensClock(event.timezone)} today. Pick a shift on the sign-up page.`,
    url: `${request.nextUrl.origin}/e/${slug}/volunteer`,
    alarm: false,
  });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-volunteer-sign-up-opens.ics"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}

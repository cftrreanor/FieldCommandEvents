import { type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { slotsToTimes } from "@/lib/rooms";
import { composeScheduleEmail, replyName } from "@/lib/schedule-emails";
import { createClient } from "@/lib/supabase/server";

// "Preview the email" in the Post the schedule window (board 11): the email one group's directors would get, as
// it would look now. Hosts only (the database answers is_event_admin); nothing is sent.
export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await getUser();
  if (!user) return new Response("Sign in to preview this email.", { status: 401 });
  const supabase = await createClient();
  const { data: host } = await supabase.rpc("is_event_admin", { ev: eventId });
  if (host !== true) return new Response("Only the festival's organizers can preview this email.", { status: 403 });
  const bandId = request.nextUrl.searchParams.get("band") ?? "";
  const [{ data: event }, { data: band }, { data: rooms }, { data: slots }, { data: me }] = await Promise.all([
    supabase.from("events").select("id, name, timezone, venue_name, venue_address, director_info, payment_link").eq("id", eventId).maybeSingle(),
    supabase.from("bands").select("id, band_name, head_director_name").eq("id", bandId).eq("event_id", eventId).maybeSingle(),
    supabase.from("rooms").select("id, name, note, path_order").eq("event_id", eventId),
    supabase.from("room_slots").select("room_id, band_id, starts_at, ends_at").eq("band_id", bandId),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  if (!event || !band) return new Response("That group isn't registered for this festival.", { status: 404 });
  const times = slotsToTimes(slots ?? [], new Map((rooms ?? []).map((r) => [r.id as string, (r.path_order as number | null) ?? 999]))).get(band.id) ?? [];
  const email = await composeScheduleEmail({
    kind: "posted",
    event,
    rooms: rooms ?? [],
    band,
    times,
    greet: band.head_director_name?.trim().split(/\s+/)[0] || null,
    by: me?.full_name?.trim() || null,
    whatChanged: null,
    origin: request.nextUrl.origin,
    replyName: await replyName(eventId),
  });
  const banner = `<div style="font-family:Helvetica,Arial,sans-serif;background:#0b3558;color:#fff;padding:10px 16px;font-size:14px">Preview, not sent · Subject: ${email.subject.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</div>`;
  return new Response(email.html.replace(/<body([^>]*)>/, `<body$1>${banner}`), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

import { downloadLogoFile } from "@/lib/sponsor-logos";
import { isTileFile } from "@/lib/sponsors";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A sponsor logo for the event's own hosts (the Sponsors page and its windows): any of the event's logos,
 * hidden ones and ones just uploaded and not saved yet. Private, but kept a year (the version changes).
 */
export async function GET(_request: Request, { params }: RouteContext<"/dashboard/events/[eventId]/sponsor-logo/[version]/[file]">) {
  const { eventId, version, file } = await params;
  const notFound = () => new Response("No logo", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!UUID.test(eventId) || !UUID.test(version) || !(isTileFile(file) || file === "master")) return notFound();
  const supabase = await createClient();
  const [{ data: isHost }, { data: event }] = await Promise.all([
    supabase.rpc("is_event_admin", { ev: eventId }),
    supabase.from("events").select("organization_id").eq("id", eventId).maybeSingle(),
  ]);
  if (!isHost || !event?.organization_id) return notFound();
  const admin = createAdminClient();
  const folder = `${event.organization_id}/${eventId}/${version}`;
  // PNG when the logo has see-through parts, JPEG otherwise.
  const logo = (await downloadLogoFile(admin, `${folder}/master.png`, file)) ?? (await downloadLogoFile(admin, `${folder}/master.jpg`, file));
  if (!logo) return notFound();
  return new Response(logo.body, {
    headers: { "Content-Type": logo.type, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}

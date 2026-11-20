import Link from "next/link";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { canDuplicateKind, duplicateHref, firstName, listAnd, plural } from "@/lib/duplicate-words";
import { loadAccountHost } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";

const OUTLINE = "inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";

/**
 * Event settings, Publishing and more: the Duplicate event panel, above Delete. The Account Host and Co-hosts of
 * every event see what comes over and the button; a Co-host of this event only sees who can do it for them.
 */
export async function DuplicatePanel({ event }: { event: { id: string; name: string; event_type: string | null; organization_id: string } }) {
  if (!canDuplicateKind(event.event_type)) return null;
  const supabase = await createClient();
  const { data: admin } = await supabase.rpc("is_org_admin", { org: event.organization_id });
  if (!admin) {
    const user = await requireUser();
    const host = await loadAccountHost(supabase, event.organization_id, user.id);
    return (
      <Card className="scroll-mt-6" id="duplicate">
        <h2 className="text-lg font-semibold">Duplicate event</h2>
        <div className="mt-1 space-y-2 text-sm leading-6">
          <p className="font-semibold">{host.name ? `${host.name} can duplicate this event for you.` : "Your Account Host can duplicate this event for you."}</p>
          <p className="text-muted">Only the Account Host and Co-hosts of every event can create events. You&apos;re a Co-host of {event.name} only.</p>
        </div>
        {host.email && (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <a href={`mailto:${host.email}?subject=${encodeURIComponent(`Duplicate ${event.name}?`)}`} className={OUTLINE}>
              Email {firstName(host.name) || "them"}
            </a>
            <span className="text-muted [overflow-wrap:anywhere]">{host.email}</span>
          </div>
        )}
      </Card>
    );
  }
  const [{ count: jobs }, { count: shifts }, { count: items }, { count: files }, { data: leads }] = await Promise.all([
    supabase.from("stations").select("id", { count: "exact", head: true }).eq("event_id", event.id),
    supabase.from("shifts").select("id", { count: "exact", head: true }).eq("event_id", event.id),
    supabase.from("station_items").select("id", { count: "exact", head: true }).eq("event_id", event.id),
    supabase.from("event_files").select("id", { count: "exact", head: true }).eq("event_id", event.id),
    supabase.from("station_leads").select("user_id").eq("event_id", event.id),
  ]);
  const coordinators = new Set((leads ?? []).map((l) => l.user_id)).size;
  const parts = [
    "its details",
    event.event_type === "band_contest" || event.event_type === "group_event" ? "registration setup" : "",
    jobs ? plural(jobs, "job", "jobs") : "",
    shifts ? plural(shifts, "shift", "shifts") : "",
    items ? plural(items, "thing to bring", "things to bring") : "",
    files ? plural(files, "file", "files") : "",
    coordinators ? plural(coordinators, "Coordinator", "Coordinators") : "",
  ].filter(Boolean);
  return (
    <Card className="scroll-mt-6" id="duplicate">
      <h2 className="text-lg font-semibold">Duplicate event</h2>
      <div className="mt-1 space-y-2 text-sm leading-6 text-muted">
        <p>Start a new draft from this event: {listAnd(parts)}. You pick the new dates.</p>
        <p>
          {event.event_type === "band_contest" ? "Bands and volunteers aren't copied." : event.event_type === "group_event" ? "Groups and volunteers aren't copied." : "Volunteers aren't copied."}{" "}
          Nothing on {event.name} changes.
        </p>
      </div>
      <div className="mt-4">
        <Link href={duplicateHref(event.id, "settings")} className={OUTLINE}>
          Duplicate event
        </Link>
      </div>
    </Card>
  );
}

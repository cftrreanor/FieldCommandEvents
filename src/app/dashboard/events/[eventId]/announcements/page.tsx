import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SetupStep, StepStatus } from "@/components/setup-step";
import { Badge, Card } from "@/components/ui";
import { getEventAccess } from "@/lib/data";
import { groupWords, hasBands, hasEnsembles } from "@/lib/event-types";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { formatTime, utcToZonedDate } from "@/lib/time";
import { endAnnouncement, postAnnouncement } from "./actions";
import { EndButton } from "./end-button";
import { PostForm } from "./post-form";
import { SavedBy } from "@/components/saved-by";

export const metadata: Metadata = { title: "Broadcast messages" };

type Row = { id: string; body: string; priority: "routine" | "schedule" | "emergency"; audiences: string[]; created_at: string; ends_at: string | null };

const TYPE = { routine: "Announcement", schedule: "Schedule change", emergency: "Emergency" } as const;

/**
 * Day-of banners for an event: post one (a band switch, a delay, an emergency)
 * and it shows at the top of the pages of the people it's for.
 * Hosts post to anyone; Volunteer Leads to volunteers and Coordinators.
 * Laid out as numbered steps (see "Setup pages" in docs/DESIGN.md).
 */
export default async function AnnouncementsPage({ params }: PageProps<"/dashboard/events/[eventId]/announcements">) {
  const { eventId } = await params;
  const access = await getEventAccess(eventId);
  if (!access.canManage) redirect(`/dashboard/events/${eventId}`);

  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("id, name, slug, timezone, event_type, status").eq("id", eventId).maybeSingle();
  if (!event) missing();
  const since = new Date(new Date().getTime() - 3 * 864e5).toISOString();
  const { data } = await supabase
    .from("announcements")
    .select("id, body, priority, audiences, created_at, ends_at")
    .eq("event_id", eventId)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Row[];
  const now = new Date().getTime();
  const isLive = (r: Row) => now - Date.parse(r.created_at) < 864e5 && (!r.ends_at || Date.parse(r.ends_at) > now);
  const live = rows.filter(isLive);
  const past = rows.filter((r) => !isLive(r));
  const tz = event.timezone;
  const words = groupWords(event.event_type);

  const all = [
    { value: "public", label: "Public", where: "the event's public page", hostOnly: true },
    ...(hasEnsembles(event.event_type)
      ? [{ value: "band_directors", label: words.one === "group" ? "Group leads" : "Directors", where: `their ${words.one} page`, hostOnly: true }]
      : []),
    { value: "volunteers", label: "Volunteers", where: "their My volunteering page", hostOnly: false },
    { value: "section_leads", label: "Event team", where: "Volunteer Leads' and Coordinators' event pages", hostOnly: false },
  ];
  const audiences = all.filter((a) => access.isHost || !a.hostOnly);
  const label = (v: string) => all.find((a) => a.value === v)?.label ?? v;
  const time = (iso: string) => `${utcToZonedDate(iso, tz) === utcToZonedDate(new Date(now).toISOString(), tz) ? "" : `${utcToZonedDate(iso, tz).slice(5)} `}${formatTime(iso, tz)}`;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/dashboard/events/${eventId}`} className="text-sm text-muted hover:text-foreground">
          ← Back to {event.name}
        </Link>
        <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Broadcast messages</h1>
        <SavedBy eventId={eventId} area="announcements" className="mt-2" />
        <p className="mt-1 text-muted">
          Post a quick message, like {hasBands(event.event_type) ? "a band switch" : "a room change"} or a delay, and it shows at the top of the pages of the people it&apos;s for, as soon as
          their page updates. Each person sees it for at least a minute, then it fades away. Emergencies are also emailed.
          {!access.isHost && " Volunteer Leads can post to volunteers and the event team."}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <SetupStep
          id="post"
          title="1. Broadcast a message"
          status={<StepStatus done={false} todoLabel="Ready to send" />}
          open
          intro={
            event.status !== "published" ? (
              <span className="text-warning">This event isn&apos;t published, so the public won&apos;t see banners yet.</span>
            ) : (
              "Say what's happening, pick who it's for, and broadcast it."
            )
          }
        >
          <PostForm action={postAnnouncement.bind(null, eventId)} audiences={audiences} eventType={event.event_type} />
        </SetupStep>

        <SetupStep
          id="showing"
          title="2. Showing now"
          status={<StepStatus done={live.length > 0} doneLabel={`${live.length} showing`} todoLabel="Nothing showing" />}
          open={live.length > 0}
          intro="Each banner shows until its end time, or until you end it."
        >
          {live.length === 0 ? (
            <p className="text-sm text-muted">Nothing is showing right now.</p>
          ) : (
            <ul className="space-y-3">
              {live.map((r) => (
                <li key={r.id}>
                  <Card className={r.priority === "emergency" ? "border-danger bg-danger/5" : ""}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge tone={r.priority === "emergency" ? "warning" : r.priority === "schedule" ? "info" : "neutral"}>{TYPE[r.priority]}</Badge>
                          <span className="text-muted">
                            {time(r.created_at)} · {r.ends_at ? `until ${time(r.ends_at)}` : "until you end it"} · {r.audiences.map(label).join(", ")}
                          </span>
                        </p>
                        <p className="mt-2 whitespace-pre-line">{r.body}</p>
                      </div>
                      {(access.isHost || r.audiences.every((a) => a === "volunteers" || a === "section_leads")) && (
                        <EndButton end={endAnnouncement.bind(null, eventId, r.id)} />
                      )}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </SetupStep>

        <SetupStep
          id="earlier"
          title="3. Earlier"
          status={<StepStatus done={past.length > 0} doneLabel={`${past.length} in the last 3 days`} todoLabel="None yet" />}
          open={false}
          intro="Banners that have ended, from the last three days."
        >
          {past.length === 0 ? (
            <p className="text-sm text-muted">No earlier banners.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {past.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  <p className="text-xs text-muted">
                    {TYPE[r.priority]} · {time(r.created_at)} · {r.audiences.map(label).join(", ")}
                  </p>
                  <p className="mt-0.5 text-sm whitespace-pre-line">{r.body}</p>
                </li>
              ))}
            </ul>
          )}
        </SetupStep>
      </div>
    </div>
  );
}

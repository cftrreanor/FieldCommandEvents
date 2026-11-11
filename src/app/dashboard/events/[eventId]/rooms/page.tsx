import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { RoomSchedule, type ScheduleSlot } from "@/components/room-schedule";
import { SavedBy } from "@/components/saved-by";
import { Badge, Card } from "@/components/ui";
import { opensLater, registrationIsOpen } from "@/lib/bands";
import { getEventAccess } from "@/lib/data";
import { hasRooms } from "@/lib/event-types";
import { directorsOf, type Room } from "@/lib/rooms";
import { datesMoved, sendStatus } from "@/lib/schedule-emails";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { eachDate, formatDate, utcToZonedDate, zoneName } from "@/lib/time";
import { SetupTabs } from "../../_components/setup-tabs";
import { StepPage } from "../conferences/step-page";
import { loadSchedule } from "./actions";
import { EmailNewTimes, PostButton, SendTheRest } from "./post-window";
import { RoomsEditor } from "./rooms-editor";
import { ScheduleEditor, type ScheduleGroup } from "./schedule-editor";

export const metadata: Metadata = { title: "Rooms and schedule" };

// Posting, or saving new times, emails each director from the page's own request: give it time to finish.
export const maxDuration = 300;

const INTRO =
  "The rooms every group moves through, in order, and how long each group spends in each. Once groups register, you set their order here and post the schedule.";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A festival's Rooms and schedule (build 2b, boards 2, 3, 4, 10, 11, 12, and 19). While it's a draft, step 2 of
 * the setup steps: the rooms, saving as you go. Once live, the management page: where the schedule stands with
 * "Post the schedule", then tabs for the group times, the rooms, and each room's list. The team (not hosts) sees
 * the schedule room by room.
 */
export default async function RoomsPage({ params, searchParams }: PageProps<"/dashboard/events/[eventId]/rooms">) {
  const { eventId } = await params;
  const { tab } = await searchParams;
  const supabase = await createClient();
  const [{ data: event }, access, { data: onTeam }] = await Promise.all([
    supabase
      .from("events")
      .select(
        "id, slug, name, status, event_type, timezone, starts_on, ends_on, performance_order_published, classifications, band_registration_open, band_registration_deadline, band_registration_opens_on",
      )
      .eq("id", eventId)
      .maybeSingle(),
    getEventAccess(eventId),
    supabase.rpc("is_event_staff", { ev: eventId }),
  ]);
  if (!event) missing();
  if (!hasRooms(event.event_type) || !onTeam) redirect(`/dashboard/events/${eventId}`);

  const tz = event.timezone;
  const days = eachDate(event.starts_on, event.ends_on ?? event.starts_on);
  const base = `/dashboard/events/${eventId}/rooms`;

  if (!access.isHost) return <TeamView eventId={eventId} name={event.name} tz={tz} live={days.includes(utcToZonedDate(new Date().toISOString(), tz))} />;

  const [snap, { data: bandData }, { data: slotData }] = await Promise.all([
    loadSchedule(eventId),
    supabase
      .from("bands")
      .select("id, band_name, school_name, classification, available_day, earliest_start, latest_finish, scratched_at, created_at")
      .eq("event_id", eventId)
      .order("created_at"),
    supabase.from("room_slots").select("room_id, band_id, starts_at, ends_at").eq("event_id", eventId).order("starts_at"),
  ]);
  if (!snap || !bandData) missing();
  type Band = {
    id: string;
    band_name: string;
    school_name: string;
    classification: string | null;
    available_day: string | null;
    earliest_start: string | null;
    latest_finish: string | null;
    scratched_at: string | null;
  };
  const bands = bandData as Band[];
  const groupNames = Object.fromEntries(bands.map((b) => [b.id, b.band_name || b.school_name || "A group"]));

  // Step 2 of setup: the rooms only (no groups can register before it's published).
  if (event.status !== "published") {
    return (
      <StepPage eventId={eventId} title="Rooms and schedule" intro={INTRO} area="schedule">
        <RoomsEditor eventId={eventId} initial={snap} groupNames={groupNames} days={days} tz={tz} next={{ href: `/dashboard/events/${eventId}/bands`, label: "Registration" }} />
      </StepPage>
    );
  }

  const groups: ScheduleGroup[] = bands.map((b) => ({
    id: b.id,
    name: groupNames[b.id],
    school: b.school_name,
    classification: b.classification,
    request: { day: b.available_day, earliest: b.earliest_start?.slice(0, 5) ?? null, latest: b.latest_finish?.slice(0, 5) ?? null },
    withdrawn: Boolean(b.scratched_at),
  }));
  const active = bands.filter((b) => !b.scratched_at);
  const slots = (slotData ?? []) as { room_id: string; band_id: string; starts_at: string; ends_at: string }[];
  const timed = new Set(slots.map((s) => s.band_id));
  const withTimes = active.filter((b) => timed.has(b.id)).length;
  const pathCount = snap.rooms.filter((r) => r.path_order != null).length;
  const current = tab === "rooms" || tab === "lists" || tab === "times" ? tab : pathCount === 0 ? "rooms" : "times";
  const regOpen = registrationIsOpen(event) || (event.band_registration_open && opensLater(event));
  const deadline = event.band_registration_deadline ? formatDate(event.band_registration_deadline, { year: undefined }) : null;
  const [send, moved] = event.performance_order_published
    ? await Promise.all([sendStatus(supabase, eventId, new Map(Object.entries(groupNames))), datesMoved(supabase, eventId)])
    : [null, null];

  const statusLine = event.performance_order_published
    ? "Directors and the festival page have the times. Changes here save with a button, and you choose who's emailed."
    : `${regOpen ? `Registration is open${deadline ? ` through ${deadline}` : ""}. You can post now; groups that register later get times when you add them.` : `Registration ${deadline ? `closed ${deadline}` : "is closed"}.`} Posting emails each director their group's times.`;

  return (
    <div data-required-marks>
      <Link href={`/dashboard/events/${eventId}`} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground">
        ← {event.name}
      </Link>
      <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Rooms and schedule</h1>
      <SavedBy eventId={eventId} area="schedule" className="mt-2" />
      <p className="mt-1 text-sm text-muted">All times in {zoneName(tz)}</p>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              {event.performance_order_published ? <Badge tone="success">Posted</Badge> : <Badge>Not posted</Badge>}
              <span>
                {plural(active.length, "group", "groups")} · {withTimes} {withTimes === 1 ? "has" : "have"} times
              </span>
            </p>
            <p className="mt-1 text-sm text-muted">{statusLine}</p>
            {send && <SendLine send={send} eventId={eventId} />}
            {moved && (
              <div className="mt-3">
                <p className="text-sm">
                  {moved.line} Directors haven&apos;t been emailed about it.
                </p>
                <div className="mt-2">
                  <EmailNewTimes eventId={eventId} />
                </div>
              </div>
            )}
          </div>
          {!event.performance_order_published && <PostButton eventId={eventId} rooms={pathCount} />}
          {event.performance_order_published && (
            <a href={`/e/${event.slug}`} target="_blank" className="inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand">
              See the festival page<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
      </Card>

      <div className="mt-8">
        <SetupTabs
          label="Rooms and schedule"
          tabs={[
            { key: "times", label: "Group times", status: plural(active.length, "group", "groups"), href: `${base}?tab=times`, active: current === "times" },
            { key: "rooms", label: "Rooms", status: plural(pathCount, "room", "rooms"), href: `${base}?tab=rooms`, active: current === "rooms" },
            { key: "lists", label: "Each room's list", status: "By room", href: `${base}?tab=lists`, active: current === "lists" },
          ]}
        />
      </div>
      <div className="mt-6">
        {current === "rooms" && <RoomsEditor eventId={eventId} initial={snap} groupNames={groupNames} days={days} tz={tz} />}
        {current === "times" && (
          <ScheduleEditor eventId={eventId} initial={snap} groups={groups} days={days} tz={tz} classifications={(event.classifications as string[] | null) ?? []} />
        )}
        {current === "lists" && <Lists rooms={snap.rooms} slots={slots} bands={bands} tz={tz} live={days.includes(utcToZonedDate(new Date().toISOString(), tz))} />}
      </div>
    </div>
  );
}

/**
 * Where the emails stand, counted by group (a group is emailed once all its directors' emails went): still sending,
 * any list with emails that didn't go (with "Send the rest again", for every list, not only the latest), or the
 * latest list sent.
 */
function SendLine({ send, eventId }: { send: NonNullable<Awaited<ReturnType<typeof sendStatus>>>; eventId: string }) {
  if (send.going) {
    return (
      <p className="mt-2 text-sm" role="status">
        <AutoRefresh seconds={5} />
        Sending… {send.going.sent} of {send.going.groups} emailed so far
      </p>
    );
  }
  if (send.rest) {
    return (
      <div className="mt-2 text-sm" role="status">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">
            {send.rest.sent} of {send.rest.groups} emailed
          </span>
          <span aria-hidden>·</span>
          <SendTheRest eventId={eventId} label="Send the rest again" />
        </p>
        {send.rest.failed.length > 0 && <p className="mt-1 text-danger">Not emailed yet: {send.rest.failed.join(", ")}</p>}
      </div>
    );
  }
  const n = send.latest.groups;
  return (
    <p className="mt-2 text-sm font-medium" role="status">
      <span aria-hidden className="text-success">
        ✓{" "}
      </span>
      {send.latest.kind === "changed"
        ? `Last change: new times emailed to the directors of ${n === 1 ? "the group" : `the ${n} groups`} it affected`
        : `Times emailed to ${n === 1 ? directorsOf(1) : `the directors of all ${n} groups`}`}
    </p>
  );
}

function Lists({
  rooms,
  slots,
  bands,
  tz,
  live,
}: {
  rooms: Room[];
  slots: { room_id: string; band_id: string; starts_at: string; ends_at: string }[];
  bands: { id: string; band_name: string; school_name: string; classification: string | null }[];
  tz: string;
  live: boolean;
}) {
  const byId = new Map(bands.map((b) => [b.id, b]));
  const list: ScheduleSlot[] = slots.flatMap((s) => {
    const b = byId.get(s.band_id);
    return b ? [{ ...s, band_name: b.band_name, school_name: b.school_name, classification: b.classification ?? "" }] : [];
  });
  if (!rooms.length) return <Card>No rooms yet. Add them in the Rooms tab.</Card>;
  return <RoomSchedule rooms={rooms} slots={list} timezone={tz} live={live} />;
}

/** The team (Volunteer Leads and Coordinators): the schedule, room by room, read only. */
async function TeamView({ eventId, name, tz, live }: { eventId: string; name: string; tz: string; live: boolean }) {
  const supabase = await createClient();
  const [{ data: rooms }, { data: slots }, { data: bands }] = await Promise.all([
    supabase.from("rooms").select("id, name, note, path_order, minutes").eq("event_id", eventId),
    supabase.from("room_slots").select("room_id, band_id, starts_at, ends_at").eq("event_id", eventId).order("starts_at"),
    supabase.rpc("event_bands", { ev: eventId }),
  ]);
  return (
    <div>
      <Link href={`/dashboard/events/${eventId}`} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground">
        ← {name}
      </Link>
      <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Rooms and schedule</h1>
      <p className="mt-1 text-sm text-muted">All times in {zoneName(tz)}</p>
      {live && <AutoRefresh status className="mt-1" />}
      <div className="mt-6">
        {(rooms ?? []).length ? (
          <Lists
            rooms={(rooms ?? []) as Room[]}
            slots={(slots ?? []) as { room_id: string; band_id: string; starts_at: string; ends_at: string }[]}
            bands={(bands ?? []) as { id: string; band_name: string; school_name: string; classification: string | null }[]}
            tz={tz}
            live={live}
          />
        ) : (
          <Card>The organizer hasn&apos;t set up the rooms yet.</Card>
        )}
      </div>
    </div>
  );
}

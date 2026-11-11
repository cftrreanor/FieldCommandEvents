import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { EventBannerSlot } from "@/components/event-banner-slot";
import { Card } from "@/components/ui";
import { hasRooms } from "@/lib/event-types";
import { groupState, roomNowNext } from "@/lib/festival-day";
import { shortDay, weekday } from "@/lib/rooms";
import { missing } from "@/lib/schema-check";
import { formatTime, utcToZonedDate, zoneName } from "@/lib/time";
import type { PushGroup } from "../rooms/push-back-form";
import { DayBoard, type BoardGroup, type BoardRoom } from "./day-board";
import { loadFestivalDay } from "./load";

export const metadata: Metadata = { title: "Event day" };
// Pushing the schedule back can email directors from the page's own request: give it time to finish.
export const maxDuration = 300;

/**
 * Festivals on the day (board 13): the rooms at a glance, then every registered group with its next tap. "Now" comes
 * only from the team's marks. A day switch on two-day festivals, set to today.
 */
export default async function EventDayPage({ params, searchParams }: PageProps<"/dashboard/events/[eventId]/event-day">) {
  const { eventId } = await params;
  const { day: dayParam } = await searchParams;
  const d = await loadFestivalDay(eventId, dayParam);
  if (!d.event) missing();
  const { event, access } = d;
  if (!hasRooms(event.event_type) || !d.onTeam) redirect(`/dashboard/events/${eventId}`);

  const tz = event.timezone;
  const time = (iso: string) => formatTime(iso, tz);
  const roomName = new Map(d.rooms.map((r) => [r.id, r.name]));
  const nameOf = (id: string) => roomName.get(id) ?? "A room";
  const groupName = new Map(d.groups.map((g) => [g.id, g.band_name || g.school_name || "A group"]));
  const base = `/dashboard/events/${eventId}/event-day`;
  const multiDay = d.days.length > 1;
  const dayQuery = multiDay ? `?day=${d.day}` : "";

  const rooms: BoardRoom[] = d.rooms.map((r) => {
    const { now, next } = roomNowNext(r.id, d.daySlots, d.marks);
    return {
      id: r.id,
      name: r.name,
      note: r.note,
      now: now ? groupName.get(now.slot.band_id) ?? "A group" : null,
      next: next ? groupName.get(next.band_id) ?? "A group" : null,
      href: `${base}/room/${r.id}${dayQuery}`,
    };
  });

  // Every registered group on this day (and every group with no times yet), in time order.
  const onDay = d.groups.filter((g) => d.dayOfGroup.get(g.id) === d.day || !d.slots.some((s) => s.band_id === g.id));
  const firstStart = (id: string) => d.slots.filter((s) => s.band_id === id).map((s) => s.starts_at).sort()[0] ?? "~";
  const groups: BoardGroup[] = onDay
    .map((g) => {
      const s = groupState({ bandId: g.id, slots: d.slots, marks: d.marks, now: d.now, live: d.live, roomName: nameOf, time });
      return {
        id: g.id,
        name: g.band_name || "A group",
        school: g.school_name,
        start: firstStart(g.id),
        status: s.status,
        line: s.line,
        tap: s.tap,
        alt: s.alt,
        finished: s.finished,
        noTimes: s.rooms.length === 0,
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));

  // "Push the schedule back" (hosts and co-hosts): every group with times, in order, each with its first time; the
  // default is this day's first group that hasn't started yet.
  const pushGroups: PushGroup[] = d.order.flatMap((id) => {
    const start = firstStart(id);
    if (start === "~" || !groupName.has(id)) return [];
    const day = utcToZonedDate(start, tz);
    return [{ id, name: groupName.get(id)!, day, dayLabel: weekday(day), startsAt: start, startLabel: time(start) }];
  });
  const todays = pushGroups.filter((g) => g.day === d.day);
  const pushDefault = (todays.find((g) => g.startsAt > d.now.toISOString()) ?? todays.at(-1) ?? pushGroups[0])?.id;

  return (
    <div>
      <Link href={`/dashboard/events/${eventId}`} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground">
        ← {event.name}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Event day</h1>
          <p className="mt-1 text-sm text-muted">
            Saved · updated {time(d.now.toISOString())} · times in {zoneName(tz)}
          </p>
        </div>
        {multiDay && (
          <nav aria-label="Festival day" className="inline-flex rounded-md ring-1 ring-field-border">
            {d.days.map((day, i) => (
              <Link
                key={day}
                href={`${base}?day=${day}`}
                aria-current={day === d.day ? "page" : undefined}
                className={`inline-flex min-h-11 items-center px-4 text-sm font-semibold ${i === 0 ? "rounded-l-md" : ""} ${i === d.days.length - 1 ? "rounded-r-md" : ""} ${
                  day === d.day ? "bg-brand text-brand-foreground" : "hover:bg-background"
                }`}
              >
                {shortDay(day)}
                {day === d.today && <span className="sr-only"> (today)</span>}
              </Link>
            ))}
          </nav>
        )}
      </div>
      <AutoRefresh seconds={20} />
      <EventBannerSlot eventId={eventId} audience="section_leads" tz={tz} className="mt-4" />

      {!event.performance_order_published && (
        <Card className="mt-4 p-4">
          <p className="text-sm">
            The schedule isn&apos;t posted yet, so families don&apos;t see times or marks.{" "}
            {access.isHost && (
              <Link href={`/dashboard/events/${eventId}/rooms`} className="font-semibold text-brand underline underline-offset-4">
                Rooms and schedule
              </Link>
            )}
          </p>
        </Card>
      )}

      <DayBoard
        eventId={eventId}
        rooms={rooms}
        groups={groups}
        dayLabel={weekday(d.day)}
        isHost={access.isHost}
        roomsHref={`/dashboard/events/${eventId}/rooms`}
        push={
          access.isHost && pushGroups.length > 0
            ? {
                groups: pushGroups,
                defaultGroup: pushDefault,
                posted: event.performance_order_published,
                version: event.room_schedule_version ?? null,
                multiDay,
              }
            : null
        }
      />
    </div>
  );
}

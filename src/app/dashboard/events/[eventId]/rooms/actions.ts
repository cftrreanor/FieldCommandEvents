"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { friendlyDbError } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import { opensLater, registrationIsOpen } from "@/lib/bands";
import { getOrigin } from "@/lib/data";
import { checkRequest, longDay, slotsToTimes, timeChanges, tooLongRooms, type Room } from "@/lib/rooms";
import { sendScheduleBatch } from "@/lib/schedule-emails";
import { createClient } from "@/lib/supabase/server";
import { eachDate, formatTime, utcToZonedDate, utcToZonedTime, zonedToUtc } from "@/lib/time";
import type { Conflict, OrderItem, Snapshot } from "./schedule-plan";

// Rooms and schedule (build 2b, 2026-11-11). Every save sends the version the page started from and a short
// summary of what changed; a co-host's save in between comes back as a Conflict with the schedule as it is now.
// Once the schedule is posted, a save emails only when the organizer chose to, and only the groups whose times
// changed (worked out here from the times before and after, not trusted from the page).

export type RoomInput = { id?: string; name: string; note: string; onPath: boolean; minutes: number };

export type SaveResult =
  | { ok: true; version: number; rooms?: Room[]; emailed?: number; message?: string }
  | { conflict: Conflict }
  | { cantRemove: { roomId: string; roomName: string; groups: { id: string; name: string }[]; version: number } }
  | { error: string };

type Db = Awaited<ReturnType<typeof createClient>>;
type Slot = { room_id: string; band_id: string; starts_at: string; ends_at: string };
type DbError = { code?: string; message: string } | null;

const whole = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;
const isConflict = (e: DbError) => e?.code === "FC409";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The schedule as saved now, for the page (and after a co-host's save). */
export async function loadSchedule(eventId: string): Promise<Snapshot | null> {
  await requireUser();
  return snapshot(await createClient(), eventId);
}

async function snapshot(supabase: Db, eventId: string): Promise<Snapshot | null> {
  const [{ data: ev }, { data: rooms }, { data: order }, { data: days }] = await Promise.all([
    supabase
      .from("events")
      .select("timezone, starts_on, room_schedule_version, room_schedule_start, room_interval_minutes, room_passing_minutes, performance_order_published")
      .eq("id", eventId)
      .maybeSingle(),
    supabase.from("rooms").select("id, name, note, path_order, minutes").eq("event_id", eventId).order("path_order", { nullsFirst: false }).order("created_at"),
    supabase.from("group_order").select("band_id, position, day, skipped_room_ids, extra_minutes_before").eq("event_id", eventId).order("position"),
    supabase.from("room_schedule_days").select("day, starts_at").eq("event_id", eventId),
  ]);
  if (!ev) return null;
  const tz = ev.timezone;
  const starts: Record<string, string> = {};
  if (ev.room_schedule_start) starts[ev.starts_on] = utcToZonedTime(ev.room_schedule_start, tz);
  for (const d of (days ?? []) as { day: string; starts_at: string }[]) starts[d.day] = utcToZonedTime(d.starts_at, tz);
  const items: OrderItem[] = ((order ?? []) as { band_id: string; day: string | null; skipped_room_ids: string[]; extra_minutes_before: number }[]).map((o) => ({
    bandId: o.band_id,
    day: o.day ?? ev.starts_on,
    skipped: o.skipped_room_ids ?? [],
    extraMinutes: o.extra_minutes_before ?? 0,
  }));
  // Days in festival order; the database's position keeps each day's order.
  items.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return {
    version: Number(ev.room_schedule_version ?? 0),
    rooms: (rooms ?? []) as Room[],
    interval: ev.room_interval_minutes,
    passing: ev.room_passing_minutes,
    starts,
    order: items,
    posted: ev.performance_order_published,
  };
}

/** What co-hosts saved since this version, and the schedule now. */
async function conflict(supabase: Db, eventId: string, since: number): Promise<{ conflict: Conflict } | { error: string }> {
  const [{ data: ev }, { data: rows }, snap] = await Promise.all([
    supabase.from("events").select("timezone").eq("id", eventId).single(),
    supabase.from("room_schedule_changes").select("saver_name, saved_at, summary").eq("event_id", eventId).gt("version", since).order("version", { ascending: false }).limit(10),
    snapshot(supabase, eventId),
  ]);
  if (!snap || !ev) return { error: "This festival couldn't be loaded. Reload the page." };
  const seen = new Set<string>();
  const changes = ((rows ?? []) as { saver_name: string | null; saved_at: string; summary: string | null }[])
    .filter((r) => {
      // A rooms save that also changed the timing is logged twice with the same words: show it once.
      const k = `${r.saver_name}|${r.summary}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => ({ name: r.saver_name?.trim() || "Someone on your team", at: formatTime(r.saved_at, ev.timezone), summary: r.summary }));
  return { conflict: { changes: changes.length ? changes : [{ name: "Someone on your team", at: "", summary: null }], snapshot: snap } };
}

async function loadSlots(supabase: Db, eventId: string) {
  const { data } = await supabase.from("room_slots").select("room_id, band_id, starts_at, ends_at").eq("event_id", eventId);
  return (data ?? []) as Slot[];
}

/**
 * Once posted, and if the organizer chose to: email the directors of every group whose times changed (from the
 * times before and after this save). Returns how many groups.
 */
async function emailChanges(supabase: Db, eventId: string, before: Slot[], email: boolean, goneRooms: Map<string, string> = new Map()) {
  const [{ data: ev }, { data: rooms }, { data: bands }] = await Promise.all([
    supabase.from("events").select("timezone, starts_on, ends_on, status, performance_order_published").eq("id", eventId).single(),
    supabase.from("rooms").select("id, name, path_order").eq("event_id", eventId),
    supabase.from("bands").select("id").eq("event_id", eventId).is("scratched_at", null),
  ]);
  if (!email || !ev?.performance_order_published || ev.status !== "published") return 0;
  const after = await loadSlots(supabase, eventId);
  const pathOrder = new Map((rooms ?? []).map((r) => [r.id as string, (r.path_order as number | null) ?? 999]));
  // Rooms this save removed keep their names from before.
  const names = new Map([...goneRooms, ...(rooms ?? []).map((r) => [r.id as string, r.name as string] as [string, string])]);
  const changes = timeChanges(
    slotsToTimes(before, pathOrder),
    slotsToTimes(after, pathOrder),
    names,
    ev.timezone,
    (bands ?? []).map((b) => b.id as string),
    { multi: ev.starts_on !== ev.ends_on },
  ).filter((c) => after.some((s) => s.band_id === c.bandId));
  if (!changes.length) return 0;
  return queue(supabase, eventId, "changed", changes.map((c) => c.bandId), Object.fromEntries(changes.map((c) => [c.bandId, c.text])));
}

/** Puts the emails on the send list and sends them once the page has its answer. Returns how many groups. */
async function queue(supabase: Db, eventId: string, kind: "posted" | "changed", bandIds: string[], changes?: Record<string, string>) {
  if (!bandIds.length) return 0;
  const { data: batch, error } = await supabase.rpc("queue_room_schedule_emails", {
    p_event: eventId,
    p_kind: kind,
    p_band_ids: bandIds,
    p_changes: changes ?? null,
  });
  if (error) {
    console.error("Queueing schedule emails failed", error.message);
    return 0;
  }
  if (!batch) return 0;
  const origin = await getOrigin();
  after(() => sendScheduleBatch(batch as string, origin));
  return bandIds.length;
}

function checkRooms(rooms: RoomInput[]) {
  if (rooms.length > 30) return "Up to 30 rooms.";
  if (rooms.some((r) => !r.name.trim() || r.name.trim().length > 80)) return "Every room needs a name (up to 80 characters).";
  if (rooms.some((r) => r.note.trim().length > 200)) return "Keep “Where it is” to 200 characters.";
  if (rooms.some((r) => r.onPath && !whole(r.minutes, 1, 240))) return "Each room takes 1 to 240 minutes per group.";
  return null;
}

/**
 * Rooms, walking time, and how often a new group starts. `rooms` is null when only the timing changed. A room the
 * team has marked groups in can't be removed: the answer says which groups could skip it instead.
 */
export async function saveRooms(
  eventId: string,
  input: { rooms: RoomInput[] | null; interval: number; passing: number | null; expectedVersion: number; summary: string; email: boolean },
): Promise<SaveResult> {
  await requireUser();
  if (input.rooms) {
    const problem = checkRooms(input.rooms);
    if (problem) return { error: problem };
  }
  if (!whole(input.interval, 5, 240)) return { error: "A new group can start every 5 to 240 minutes." };
  if (input.passing !== null && !whole(input.passing, 0, 60)) return { error: "Walking time between rooms: 0 to 60 minutes." };
  const supabase = await createClient();
  const [before, { data: oldRooms }] = await Promise.all([loadSlots(supabase, eventId), supabase.from("rooms").select("id, name").eq("event_id", eventId)]);
  let version = input.expectedVersion;
  if (input.rooms) {
    const { data, error } = await supabase.rpc("save_rooms", {
      p_event: eventId,
      p_rooms: input.rooms.map((r) => ({ id: r.id ?? null, name: r.name.trim(), note: r.note.trim(), on_path: r.onPath, minutes: r.onPath ? r.minutes : 20 })),
      p_expected_version: version,
      p_summary: input.summary.slice(0, 500),
    });
    if (isConflict(error)) return conflict(supabase, eventId, version);
    if (error?.code === "P0001" && /can't be removed/.test(error.message)) return cantRemove(supabase, eventId, input.rooms, version, error.message);
    if (error) return { error: friendlyDbError(error) };
    version = Number(data);
  }
  const { data: ev } = await supabase
    .from("events")
    .select("room_interval_minutes, room_passing_minutes, room_schedule_start")
    .eq("id", eventId)
    .single();
  const passing = input.passing ?? ev?.room_passing_minutes ?? 5;
  if (ev && (ev.room_interval_minutes !== input.interval || ev.room_passing_minutes !== passing)) {
    const { data: order } = await supabase.from("group_order").select("band_id, day, skipped_room_ids, extra_minutes_before").eq("event_id", eventId).order("position");
    const { data, error } = await supabase.rpc("save_room_schedule", {
      p_event: eventId,
      p_start: ev.room_schedule_start,
      p_interval: input.interval,
      p_passing: passing,
      p_order: (order ?? []).map((o) => ({ band_id: o.band_id, day: o.day, skipped_room_ids: o.skipped_room_ids, extra_minutes_before: o.extra_minutes_before })),
      p_days: null,
      p_expected_version: version,
      p_summary: input.summary.slice(0, 500),
    });
    if (isConflict(error)) return conflict(supabase, eventId, version);
    if (error) return { error: friendlyDbError(error) };
    version = Number(data);
  }
  const emailed = await emailChanges(supabase, eventId, before, input.email, new Map((oldRooms ?? []).map((r) => [r.id as string, r.name as string])));
  const { data: rooms } = await supabase.from("rooms").select("id, name, note, path_order, minutes").eq("event_id", eventId).order("path_order", { nullsFirst: false }).order("created_at");
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true, version, rooms: (rooms ?? []) as Room[], emailed, message: emailed ? `Saved. Emailing ${plural(emailed, "director", "directors")} their new times.` : "Saved" };
}

/** The room the database wouldn't remove, and the groups still to come there (no mark in it, time not started). */
async function cantRemove(supabase: Db, eventId: string, rooms: RoomInput[], version: number, message: string): Promise<SaveResult> {
  const { data: all } = await supabase.from("rooms").select("id, name").eq("event_id", eventId);
  const kept = new Set(rooms.map((r) => r.id).filter(Boolean));
  const gone = (all ?? []).filter((r) => !kept.has(r.id));
  const room = gone.find((r) => message.includes(`groups in ${r.name}, so`)) ?? gone[0];
  if (!room) return { error: friendlyDbError({ code: "P0001", message }) };
  const [{ data: slots }, { data: marks }, { data: bands }] = await Promise.all([
    supabase.from("room_slots").select("band_id, starts_at").eq("room_id", room.id),
    supabase.from("group_checkins").select("band_id").eq("room_id", room.id),
    supabase.from("bands").select("id, band_name").eq("event_id", eventId),
  ]);
  const marked = new Set((marks ?? []).map((m) => m.band_id));
  const now = new Date().toISOString();
  const name = new Map((bands ?? []).map((b) => [b.id, b.band_name as string]));
  const groups = (slots ?? [])
    .filter((s) => !marked.has(s.band_id) && s.starts_at > now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((s) => ({ id: s.band_id as string, name: name.get(s.band_id) ?? "A group" }));
  return { cantRemove: { roomId: room.id, roomName: room.name, groups, version } };
}

/** "Skip it for the groups still to come": a room that can't be removed, off the schedule for these groups. */
export async function skipRoomForRest(
  eventId: string,
  input: { roomId: string; bandIds: string[]; roomName: string; expectedVersion: number; email: boolean },
): Promise<SaveResult> {
  await requireUser();
  const supabase = await createClient();
  const snap = await snapshot(supabase, eventId);
  if (!snap) return { error: "This festival couldn't be loaded. Reload the page." };
  const order = snap.order.map((o) => (input.bandIds.includes(o.bandId) && !o.skipped.includes(input.roomId) ? { ...o, skipped: [...o.skipped, input.roomId] } : o));
  return saveOrder(supabase, eventId, snap, snap.starts, order, input.expectedVersion, `Skipped ${input.roomName} for ${plural(input.bandIds.length, "group", "groups")} still to come`, input.email);
}

export type OrderInput = { bandId: string; day: string; skipped: string[]; extraMinutes: number };

/** The group times: each day's first start ("HH:MM"), and the groups in order, each on a day. */
export async function saveSchedule(
  eventId: string,
  input: { starts: Record<string, string>; order: OrderInput[]; expectedVersion: number; summary: string; email: boolean },
): Promise<SaveResult> {
  await requireUser();
  const supabase = await createClient();
  const snap = await snapshot(supabase, eventId);
  if (!snap) return { error: "This festival couldn't be loaded. Reload the page." };
  return saveOrder(supabase, eventId, snap, input.starts, input.order, input.expectedVersion, input.summary, input.email);
}

async function saveOrder(
  supabase: Db,
  eventId: string,
  snap: Snapshot,
  starts: Record<string, string>,
  order: OrderInput[],
  expectedVersion: number,
  summary: string,
  email: boolean,
): Promise<SaveResult> {
  const { data: ev } = await supabase.from("events").select("timezone, starts_on, ends_on").eq("id", eventId).single();
  if (!ev) return { error: "This festival couldn't be loaded. Reload the page." };
  const days = eachDate(ev.starts_on, ev.ends_on ?? ev.starts_on);
  const path = new Set(snap.rooms.filter((r) => r.path_order != null).map((r) => r.id));
  if (Object.entries(starts).some(([d, t]) => !days.includes(d) || !/^\d{2}:\d{2}$/.test(t))) return { error: "Pick a time for the first group of each day." };
  if (new Set(order.map((o) => o.bandId)).size !== order.length) return { error: "A group is on the schedule twice. Reload the page." };
  if (order.some((o) => !days.includes(o.day))) return { error: "That day isn't one of the festival's days." };
  if (order.some((o) => !whole(o.extraMinutes, 0, 600))) return { error: "A break can be up to 600 minutes." };
  const tz = ev.timezone;
  const before = await loadSlots(supabase, eventId);
  const first = starts[ev.starts_on];
  const { data, error } = await supabase.rpc("save_room_schedule", {
    p_event: eventId,
    p_start: first ? zonedToUtc(ev.starts_on, first, tz).toISOString() : null,
    p_interval: snap.interval,
    p_passing: snap.passing,
    p_order: order.map((o) => ({ band_id: o.bandId, day: o.day, skipped_room_ids: o.skipped.filter((r) => path.has(r)), extra_minutes_before: o.extraMinutes })),
    p_days: Object.entries(starts).map(([day, t]) => ({ day, starts_at: zonedToUtc(day, t, tz).toISOString() })),
    p_expected_version: expectedVersion,
    p_summary: summary.slice(0, 500),
  });
  if (isConflict(error)) return conflict(supabase, eventId, expectedVersion);
  if (error) return { error: friendlyDbError(error) };
  const emailed = await emailChanges(supabase, eventId, before, email);
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true, version: Number(data), emailed, message: emailed ? `Saved. Emailing ${plural(emailed, "director", "directors")} their new times.` : "Saved" };
}

/**
 * Posts the schedule: on the festival page, and each director with times is emailed. Only once: the flag flips
 * in one update, and only the request that flipped it sends. A room that would hold two groups at once blocks it.
 */
export async function postSchedule(eventId: string, input: { expectedVersion: number }): Promise<SaveResult> {
  await requireUser();
  const supabase = await createClient();
  const [{ data: ev }, { data: rooms }, { data: slots }, { data: bands }] = await Promise.all([
    supabase.from("events").select("status, room_schedule_version, room_interval_minutes, performance_order_published").eq("id", eventId).single(),
    supabase.from("rooms").select("id, name, note, path_order, minutes").eq("event_id", eventId),
    supabase.from("room_slots").select("band_id").eq("event_id", eventId),
    supabase.from("bands").select("id").eq("event_id", eventId).is("scratched_at", null),
  ]);
  if (!ev) return { error: "This festival couldn't be loaded. Reload the page." };
  if (ev.status !== "published") return { error: "Publish the festival first. Then you can post its schedule." };
  if (ev.performance_order_published) return { ok: true, version: Number(ev.room_schedule_version), emailed: 0, message: "The schedule is already posted." };
  if (Number(ev.room_schedule_version) !== input.expectedVersion) return conflict(supabase, eventId, input.expectedVersion);
  const long = tooLongRooms((rooms ?? []) as Room[], ev.room_interval_minutes);
  if (long.length) return { error: `${long[0].name} is longer than the time between groups, so it would have two groups at once. Fix that first.` };
  const timed = new Set((slots ?? []).map((s) => s.band_id as string));
  const withTimes = (bands ?? []).map((b) => b.id as string).filter((id) => timed.has(id));
  if (!withTimes.length) return { error: "Give at least one group times first." };
  const { data: flipped, error } = await supabase
    .from("events")
    .update({ performance_order_published: true, schedule_updated_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("performance_order_published", false)
    .select("id");
  if (error) return { error: friendlyDbError(error) };
  // Someone else posted it a moment ago: they sent the emails.
  const emailed = flipped?.length ? await queue(supabase, eventId, "posted", withTimes) : 0;
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true, version: input.expectedVersion, emailed, message: emailed ? `Posted. Emailing ${plural(emailed, "director", "directors")} their group's times.` : "Posted" };
}

/**
 * Running behind: the chosen group and every group after it that day move later (the minutes go on that group's
 * break, so the group times show them too). Hosts and co-hosts only (the database checks).
 */
export async function pushBack(
  eventId: string,
  input: { bandId: string; minutes: number; email: boolean; expectedVersion: number | null },
): Promise<SaveResult> {
  await requireUser();
  if (!whole(input.minutes, 1, 240)) return { error: "Push back 1 to 240 minutes." };
  const supabase = await createClient();
  const snap = await snapshot(supabase, eventId);
  if (!snap) return { error: "This festival couldn't be loaded. Reload the page." };
  const item = snap.order.find((o) => o.bandId === input.bandId);
  if (!item) return { error: "Pick a group that has times." };
  if (item.extraMinutes + input.minutes > 600) return { error: "That group's break would go over 600 minutes." };
  const { data: band } = await supabase.from("bands").select("band_name").eq("id", input.bandId).maybeSingle();
  const sameDay = snap.order.filter((o) => o.day === item.day);
  const after = sameDay.length - sameDay.findIndex((o) => o.bandId === input.bandId) - 1;
  const { data: ev } = await supabase.from("events").select("starts_on, ends_on").eq("id", eventId).single();
  const dayWord = ev && ev.starts_on !== ev.ends_on ? ` on ${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(`${item.day}T12:00:00Z`))}` : "";
  const summary = `Pushed back ${band?.band_name ?? "a group"}${after ? ` and the ${plural(after, "group", "groups")} after them` : ""}${dayWord} ${input.minutes} minutes`;
  const order = snap.order.map((o) => (o.bandId === input.bandId ? { ...o, extraMinutes: o.extraMinutes + input.minutes } : o));
  const r = await saveOrder(supabase, eventId, snap, snap.starts, order, input.expectedVersion ?? snap.version, summary, input.email);
  if ("ok" in r) {
    const moved = after + 1;
    return { ...r, message: `Moved ${plural(moved, "group", "groups")} ${input.minutes} minutes later.${r.emailed ? ` Emailing ${plural(r.emailed, "director", "directors")} their new times.` : ""}` };
  }
  return r;
}

/** Sending stopped partway or some failed: try the rest of the latest list again. */
export async function sendTheRest(eventId: string, batch: string): Promise<SaveResult> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("retry_room_schedule_emails", { p_event: eventId, p_batch: batch });
  if (error) return { error: friendlyDbError(error) };
  const origin = await getOrigin();
  after(() => sendScheduleBatch(batch, origin));
  revalidatePath(`/dashboard/events/${eventId}/rooms`);
  return { ok: true, version: 0, message: data ? "Sending the rest" : "Sending" };
}

/** What the "Post the schedule?" window says (board 11), worked out from what's saved now. */
export type PostPreview = {
  version: number;
  /** Groups with times (their directors are emailed). */
  emailed: number;
  noTimes: string[];
  days: { label: string; groups: number; from: string; to: string }[];
  broken: { name: string; text: string }[];
  /** A room longer than the time between groups: posting waits for the fix. */
  long: { room: string; minutes: number; interval: number } | null;
  regOpen: boolean;
  deadline: string | null;
  /** A group to preview the email with. */
  previewBand: string | null;
};

export async function postPreview(eventId: string): Promise<PostPreview | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const [{ data: ev }, { data: rooms }, { data: slots }, { data: bands }] = await Promise.all([
    supabase
      .from("events")
      .select("status, timezone, starts_on, ends_on, room_schedule_version, room_interval_minutes, band_registration_open, band_registration_deadline, band_registration_opens_on")
      .eq("id", eventId)
      .single(),
    supabase.from("rooms").select("id, name, note, path_order, minutes").eq("event_id", eventId),
    supabase.from("room_slots").select("room_id, band_id, starts_at, ends_at").eq("event_id", eventId),
    supabase.from("bands").select("id, band_name, available_day, earliest_start, latest_finish, created_at").eq("event_id", eventId).is("scratched_at", null).order("created_at"),
  ]);
  if (!ev) return { error: "This festival couldn't be loaded. Reload the page." };
  const tz = ev.timezone;
  const multi = ev.starts_on !== ev.ends_on;
  const all = (rooms ?? []) as Room[];
  const pathOrder = new Map(all.map((r) => [r.id, r.path_order ?? 999]));
  const times = slotsToTimes((slots ?? []) as Slot[], pathOrder);
  const names = new Map(all.map((r) => [r.id, r.name]));
  const list = (bands ?? []) as { id: string; band_name: string; available_day: string | null; earliest_start: string | null; latest_finish: string | null }[];
  const timed = list.filter((b) => (times.get(b.id) ?? []).length > 0);
  const byDay = new Map<string, { groups: number; from: Date; to: Date }>();
  for (const b of timed) {
    const t = times.get(b.id)!;
    const d = utcToZonedDate(t[0].startsAt.toISOString(), tz);
    const end = t.reduce((x, y) => (y.endsAt > x ? y.endsAt : x), t[0].endsAt);
    const cur = byDay.get(d);
    byDay.set(d, cur ? { groups: cur.groups + 1, from: t[0].startsAt < cur.from ? t[0].startsAt : cur.from, to: end > cur.to ? end : cur.to } : { groups: 1, from: t[0].startsAt, to: end });
  }
  const long = tooLongRooms(all, ev.room_interval_minutes)[0];
  return {
    version: Number(ev.room_schedule_version),
    emailed: timed.length,
    noTimes: list.filter((b) => !(times.get(b.id) ?? []).length).map((b) => b.band_name),
    days: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({ label: longDay(d), groups: v.groups, from: formatTime(v.from.toISOString(), tz), to: formatTime(v.to.toISOString(), tz) })),
    broken: timed.flatMap((b) => {
      const c = checkRequest(
        { day: b.available_day, earliest: b.earliest_start?.slice(0, 5) ?? null, latest: b.latest_finish?.slice(0, 5) ?? null },
        times.get(b.id)!,
        names,
        tz,
        multi,
      );
      return c && !c.ok ? [{ name: b.band_name, text: c.text }] : [];
    }),
    long: long ? { room: long.name, minutes: long.minutes, interval: ev.room_interval_minutes } : null,
    regOpen: registrationIsOpen(ev) || (ev.band_registration_open && opensLater(ev)),
    deadline: ev.band_registration_deadline,
    previewBand: timed[0]?.id ?? null,
  };
}

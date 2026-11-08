import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailLayout, pause, sendEmail } from "@/lib/email";
import { ALL_DIGEST, DIGEST_PARTS, type DigestPart, type DigestPrefs } from "@/lib/notify-kinds";
import { notificationPeople } from "@/lib/notify-recipients";
import { isSchemaError } from "@/lib/schema-check";
import { formatDate, formatTimeRange, utcToZonedDate } from "@/lib/time";

type ShiftInfo = { id: string; starts_at: string; ends_at: string; max_capacity: number; registered_count: number; stations: { name: string } | null };
type Change = { title: string; detail: string };

/**
 * The daily job: for each event whose hosts picked people for "Volunteer
 * sign-ups" (Edit details → Email settings), one email listing the last day's
 * new sign-ups, changes (switched shifts), and cancellations, and how full the
 * shifts are. Each team member's summary has only the parts they picked;
 * other addresses get everything. Nothing on days without changes for them,
 * or once the event is over. Returns how many went out.
 */
export async function sendVolunteerDigests(admin: SupabaseClient, origin: string, now: number) {
  const { data: picked, error } = await admin.from("event_notification_recipients").select("event_id").eq("kind", "volunteer_digest");
  if (error) {
    if (!isSchemaError(error)) console.error("Daily job: volunteer summary lookup failed", error);
    return 0;
  }
  const since = new Date(now - 86_400_000).toISOString();
  let sent = 0;
  for (const { event_id: eventId } of picked ?? []) {
    const { data: event } = await admin.from("events").select("id, name, timezone, ends_on").eq("id", eventId).maybeSingle();
    if (!event || event.ends_on < utcToZonedDate(new Date(now).toISOString(), event.timezone)) continue;

    const [{ data: added }, { data: dropped }, { data: switched }, { data: shiftRows }, { data: itemsAdded }, { data: itemRows }] = await Promise.all([
      admin
        .from("volunteer_assignments")
        .select("shift_id, volunteers(full_name, contact:volunteers!contact_id(full_name)), shifts!inner(event_id)")
        .eq("shifts.event_id", eventId)
        .gte("created_at", since),
      admin.from("volunteer_dropped_shifts").select("*").eq("event_id", eventId).gte("dropped_at", since),
      // Switched shifts (none before 20270102000000_group_signup.sql).
      admin.from("volunteer_changes").select("full_name, from_shift_id, to_shift_id").eq("event_id", eventId).gte("changed_at", since),
      // stations(*): showing arrives with the 20270105000000 update (hidden jobs' spots aren't counted).
      admin.from("shifts").select("id, starts_at, ends_at, max_capacity, registered_count, stations(*)").eq("event_id", eventId),
      // Items to bring (before 20261231000000_items_to_bring.sql these come back empty).
      admin.from("item_signups").select("item_id, note, volunteers(full_name)").eq("event_id", eventId).gte("created_at", since),
      admin.from("station_items").select("id, name, needed, claimed_count, stations(*)").eq("event_id", eventId),
    ]);
    const signedUp = (added ?? []) as unknown as {
      shift_id: string;
      volunteers: { full_name: string; contact: { full_name: string } | null } | null;
    }[];
    const left = (dropped ?? []) as { shift_id: string | null; item_id?: string | null; full_name: string }[];
    const moved = (switched ?? []) as { full_name: string; from_shift_id: string; to_shift_id: string }[];
    const bringing = (itemsAdded ?? []) as unknown as { item_id: string; note: string | null; volunteers: { full_name: string } | null }[];
    if (!signedUp.length && !left.length && !moved.length && !bringing.length) continue;
    const people = await notificationPeople(eventId, "volunteer_digest");
    if (!people?.length) continue;

    const shifts = new Map(((shiftRows ?? []) as unknown as ShiftInfo[]).map((s) => [s.id, s]));
    const where = (shiftId: string) => {
      const s = shifts.get(shiftId);
      if (!s) return "a shift that was removed";
      const day = formatDate(utcToZonedDate(s.starts_at, event.timezone), { year: undefined });
      return `${s.stations?.name ?? "Shift"}, ${day}, ${formatTimeRange(s.starts_at, s.ends_at, event.timezone)}`;
    };
    const items = new Map(
      ((itemRows ?? []) as unknown as { id: string; name: string; needed: number; claimed_count: number; stations: { name: string } | null }[]).map(
        (i) => [i.id, i],
      ),
    );
    const what = (itemId: string, note?: string | null) => {
      const i = items.get(itemId);
      if (!i) return "an item that was removed";
      return [`${i.stations?.name ?? "Items"}: ${i.name}`, note].filter(Boolean).join(" · ");
    };
    // Each part of the summary; a group sign-up shows who booked each person.
    const parts: Record<DigestPart, Change[]> = {
      new_bookings: [
        ...signedUp.map((a) => ({
          title: `${a.volunteers?.full_name ?? "A volunteer"} signed up${a.volunteers?.contact ? ` (booked by ${a.volunteers.contact.full_name})` : ""}`,
          detail: where(a.shift_id),
        })),
        ...bringing.map((b) => ({ title: `${b.volunteers?.full_name ?? "A volunteer"} is bringing something`, detail: what(b.item_id, b.note) })),
      ],
      changes: moved.map((m) => ({ title: `${m.full_name} switched shifts`, detail: `From ${where(m.from_shift_id)} to ${where(m.to_shift_id)}` })),
      cancellations: left.map((d) => ({
        title: `${d.full_name} is no longer signed up`,
        detail: d.item_id ? what(d.item_id) : d.shift_id ? where(d.shift_id) : "a shift that was removed",
      })),
    };
    const open = [...shifts.values()].filter((s) => (s.stations as { showing?: boolean } | null)?.showing !== false);
    const filled = open.reduce((n, s) => n + s.registered_count, 0);
    const spots = open.reduce((n, s) => n + s.max_capacity, 0);
    const openItems = [...items.values()].filter((i) => (i.stations as { showing?: boolean } | null)?.showing !== false);
    const covered = openItems.reduce((n, i) => n + i.claimed_count, 0);
    const needed = openItems.reduce((n, i) => n + i.needed, 0);
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const counts: Record<DigestPart, string> = {
      new_bookings: plural(parts.new_bookings.length, "new sign-up", "new sign-ups"),
      changes: plural(parts.changes.length, "change", "changes"),
      cancellations: plural(parts.cancellations.length, "cancellation", "cancellations"),
    };

    // What each team member picked (no choice saved: everything).
    const { data: prefRows, error: prefError } = await admin
      .from("volunteer_digest_prefs")
      .select("user_id, new_bookings, changes, cancellations")
      .eq("event_id", eventId);
    if (prefError && !isSchemaError(prefError)) console.error("Daily job: summary choices lookup failed", prefError);
    const prefs = new Map(((prefRows ?? []) as ({ user_id: string } & DigestPrefs)[]).map((p) => [p.user_id, p]));

    for (const person of people) {
      const mine = (person.userId && prefs.get(person.userId)) || ALL_DIGEST;
      const chosen = DIGEST_PARTS.map((p) => p.key).filter((k) => mine[k]);
      const changes = chosen.flatMap((k) => parts[k]);
      if (!changes.length) continue;
      const { html, text } = emailLayout({
        heading: `Volunteer sign-ups for ${event.name}`,
        paragraphs: [
          `In the last day: ${listOf(chosen.map((k) => counts[k]))}.${spots ? ` ${filled} of ${spots} spots are filled.` : ""}${needed ? ` ${covered} of ${needed} items are covered.` : ""}`,
          ...(changes.length > 30 ? [`Here are the first 30. The other ${changes.length - 30} are on your Volunteers page.`] : []),
        ],
        // One row per change, up to 30; the rest are on the Volunteers page.
        rows: changes.slice(0, 30),
        button: { label: "See all volunteers", url: `${origin}/dashboard/events/${eventId}/volunteers` },
        footer: person.userId
          ? `You get this once a day, on days with changes you picked: ${listOf(chosen.map((k) => DIGEST_PARTS.find((p) => p.key === k)!.label.toLowerCase()))}. Change what it includes on the event's volunteer page.`
          : "You get this once a day, on days with changes, because the event's hosts added this address. They can change it in Event settings → Email settings.",
      });
      if (await sendEmail({ to: person.email, subject: `Volunteer sign-ups: ${event.name}`, html, text, eventId })) sent++;
      await pause();
    }
  }
  return sent;
}

/** "a, b, and c" */
function listOf(parts: string[]) {
  return parts.length <= 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

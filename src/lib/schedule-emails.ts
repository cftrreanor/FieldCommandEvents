import "server-only";
import { brand } from "@/lib/brand";
import { emailButton, emailShell } from "@/lib/email-format";
import { emailLogoUrl, pause, sendEmail } from "@/lib/email";
import { eventSender } from "@/lib/event-sender";
import { dayOf, longDay, span, type RoomTime } from "@/lib/rooms";
import { createAdminClient, type createClient } from "@/lib/supabase/server";
import { customWords, loadSystemEmail } from "@/lib/system-email-overrides";
import { zoneName } from "@/lib/time";

// A festival's schedule emails (board 19, 2026-11-11): each group's times, from the organizer by name, with the
// address, the organizer's information for directors, and the way to their group's page and calendar. Sent from
// a send list (room_schedule_emails, 20270130000000), each email claimed before it goes, so a long list never
// stops partway without a record, and two senders never double up.

type EventRow = {
  id: string;
  name: string;
  timezone: string;
  venue_name: string | null;
  venue_address: string | null;
  director_info: string | null;
  payment_link: string | null;
};
type RoomRow = { id: string; name: string; note: string | null; path_order: number | null };

export type ScheduleEmailInput = {
  kind: "posted" | "changed";
  event: EventRow;
  rooms: RoomRow[];
  band: { id: string; band_name: string };
  times: RoomTime[];
  greet: string | null;
  /** Who posted or changed it ("Dana Whitfield"). */
  by: string | null;
  whatChanged: string | null;
  origin: string;
  /** Replies reach this person, when the event's replies are on. */
  replyName: string | null;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** "Lakeview Chamber Singers'" or "Summit Treble Choir's". */
const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
const P = "font-size:16px;line-height:24px;margin:0 0 16px";

/** The email's subject, words, and links. */
export async function composeScheduleEmail(m: ScheduleEmailInput) {
  const tz = m.event.timezone;
  const byId = new Map(m.rooms.map((r) => [r.id, r]));
  const group = m.band.band_name;
  const days = [...new Set(m.times.map((t) => dayOf(t.startsAt, tz)))];
  const when = days.length ? `${days.map(longDay).join(" and ")} (${zoneName(tz)})` : zoneName(tz);
  const organizer = m.by?.trim() || "The organizer";

  // An admin's own wording (/admin/emails), if they saved one: its subject and opening.
  const key = m.kind === "changed" ? "director_rooms_changed" : "director_rooms_posted";
  const custom = customWords(key, await loadSystemEmail(key), { band_name: group, school: "", event_name: m.event.name });
  const subject = custom?.subject || (m.kind === "changed" ? `New times for ${group} at ${m.event.name}` : `${possessive(group)} times at ${m.event.name}`);

  const opening =
    m.kind === "changed"
      ? [`${organizer} changed the schedule for ${m.event.name}. What changed for ${group}: ${m.whatChanged ?? "new times"}.`, `${possessive(group)} times now, on ${when}:`]
      : [`${organizer} posted the schedule for ${m.event.name}. ${possessive(group)} times on ${when}:`];
  const paragraphs = custom?.paragraphs?.length ? [...custom.paragraphs, `${possessive(group)} times on ${when}:`] : opening;

  const lines = m.times.map((t) => {
    const r = byId.get(t.roomId);
    return `${span(t.startsAt, t.endsAt, tz, " to ")}, ${r?.name ?? "A room"}${r?.note ? ` (${r.note})` : ""}`;
  });
  const where = [m.event.venue_name, m.event.venue_address].filter(Boolean).join(", ");
  const groupPage = `${m.origin}/dashboard/bands/${m.band.id}`;
  const calendar = `${m.origin}/dashboard/bands/${m.band.id}/calendar?round=rooms`;

  const html = emailShell({
    content: [
      `<p style="${P}">${esc(m.greet ? `Hi ${m.greet},` : "Hi,")}</p>`,
      ...paragraphs.map((p) => `<p style="${P}">${esc(p)}</p>`),
      lines.length
        ? `<ul style="font-size:16px;line-height:26px;margin:0 0 16px;padding-left:22px">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
        : `<p style="${P}">No times right now. The organizer will email you when there are.</p>`,
      where ? `<p style="${P}"><strong>Where:</strong> ${esc(where)}</p>` : "",
      m.event.director_info?.trim()
        ? `<p style="${P}"><strong>From the organizer:</strong> ${esc(m.event.director_info.trim()).replace(/\n/g, "<br>")}</p>`
        : "",
      m.event.payment_link ? `<p style="${P}"><a href="${esc(m.event.payment_link)}" style="color:#0b3558;font-weight:bold">Pay the entry fee</a></p>` : "",
      emailButton("See your group's page", groupPage),
      lines.length ? `<p style="font-size:15px;line-height:22px;margin:-8px 0 24px"><a href="${esc(calendar)}" style="color:#0b3558;font-weight:bold">Add to calendar</a></p>` : "",
      m.replyName ? `<p style="${P}">Questions? Reply to this email to reach ${esc(m.replyName)}.</p>` : "",
    ].join(""),
    logoUrl: emailLogoUrl(m.origin),
    preheader: paragraphs[0],
  });
  const text = [
    m.greet ? `Hi ${m.greet},` : "Hi,",
    "",
    ...paragraphs,
    "",
    ...(lines.length ? lines.map((l) => `- ${l}`) : ["No times right now. The organizer will email you when there are."]),
    "",
    ...(where ? [`Where: ${where}`, ""] : []),
    ...(m.event.director_info?.trim() ? [`From the organizer: ${m.event.director_info.trim()}`, ""] : []),
    ...(m.event.payment_link ? [`Pay the entry fee: ${m.event.payment_link}`, ""] : []),
    `See your group's page: ${groupPage}`,
    ...(lines.length ? [`Add to calendar: ${calendar}`] : []),
    ...(m.replyName ? ["", `Questions? Reply to this email to reach ${m.replyName}.`] : []),
    "",
    `${brand.name} · ${brand.tagline}`,
  ].join("\n");
  return { subject, html, text };
}

/** "Dana" for "Reply to this email to reach Dana", when replies are on; null when they're off. */
export async function replyName(eventId: string) {
  const sender = await eventSender(eventId);
  if (!sender?.replyTo) return null;
  return sender.person?.split(/\s+/)[0] || "the organizer";
}

/**
 * What the page shows about the send lists (counted by group: a group is emailed once all its directors' emails
 * went): the latest list, anything still sending, and every list (not only the latest) with emails that failed or
 * stopped partway, so "Send the rest again" reaches them.
 */
export type SendStatus = {
  /** The latest list: posting, or a change. */
  latest: { kind: "posted" | "changed"; groups: number; sent: number };
  /** Lists still going, added up. */
  going: { groups: number; sent: number } | null;
  /** Lists with emails that failed or stopped partway, added up, and the groups that couldn't be reached. */
  rest: { groups: number; sent: number; failed: string[] } | null;
};

type EmailRow = { batch: string; kind: string; band_id: string; status: string; created_at: string; claimed_at: string | null };

/** Loads the send lists' state for the page (as the signed-in host). */
export async function sendStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  names: Map<string, string>,
): Promise<SendStatus | null> {
  const { data } = await supabase
    .from("room_schedule_emails")
    .select("batch, kind, band_id, status, created_at, claimed_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(5000);
  const rows = (data ?? []) as EmailRow[];
  if (!rows.length) return null;
  const now = Date.now();
  const stuck = (r: EmailRow) =>
    (r.status === "waiting" || r.status === "sending") && now - new Date(r.claimed_at ?? r.created_at).getTime() > (r.status === "sending" ? 10 : 2) * 60_000;
  const open = (r: EmailRow) => (r.status === "waiting" || r.status === "sending") && !stuck(r);
  const batches = [...new Set(rows.map((r) => r.batch))];
  const of = (batch: string) => rows.filter((r) => r.batch === batch);
  /** Groups in a list, and those with every email sent. */
  const count = (list: EmailRow[]) => {
    const bands = [...new Set(list.map((r) => r.band_id))];
    return { groups: bands.length, sent: bands.filter((b) => list.every((r) => r.band_id !== b || r.status === "sent")).length, bands };
  };
  const add = (lists: string[]) =>
    lists.reduce((t, b) => {
      const c = count(of(b));
      return { groups: t.groups + c.groups, sent: t.sent + c.sent };
    }, { groups: 0, sent: 0 });
  const goingLists = batches.filter((b) => of(b).some(open));
  const restLists = batches.filter((b) => !goingLists.includes(b) && of(b).some((r) => r.status === "failed" || stuck(r)));
  const failed = [...new Set(restLists.flatMap((b) => of(b).filter((r) => r.status === "failed" || stuck(r)).map((r) => names.get(r.band_id) ?? "A group")))];
  const last = count(of(batches[0]));
  return {
    latest: { kind: rows[0].kind as "posted" | "changed", groups: last.groups, sent: last.sent },
    going: goingLists.length ? add(goingLists) : null,
    rest: restLists.length ? { ...add(restLists), failed } : null,
  };
}

/**
 * Sends a batch from the send list, one email at a time (Resend allows about two a second). Stops a little before
 * the page's time limit; whatever's left stays on the list as waiting, and the page offers to send the rest.
 */
export async function sendScheduleBatch(batch: string, origin: string, deadlineMs = 270_000) {
  const started = Date.now();
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("room_schedule_emails")
    .select("id, event_id, kind, band_id, to_email, greet_name, what_changed, tries, created_by")
    .eq("batch", batch)
    .eq("status", "waiting")
    .order("created_at");
  if (!rows?.length) return;
  const eventId = rows[0].event_id as string;
  const [{ data: event }, { data: rooms }, { data: slots }, { data: bands }, reply] = await Promise.all([
    admin.from("events").select("id, name, timezone, venue_name, venue_address, director_info, payment_link").eq("id", eventId).single(),
    admin.from("rooms").select("id, name, note, path_order").eq("event_id", eventId),
    admin.from("room_slots").select("room_id, band_id, starts_at, ends_at").eq("event_id", eventId).order("starts_at"),
    admin.from("bands").select("id, band_name").eq("event_id", eventId),
    replyName(eventId),
  ]);
  if (!event) return;
  const byIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[];
  const { data: people } = byIds.length ? await admin.from("profiles").select("id, full_name").in("id", byIds) : { data: [] };
  const personName = new Map((people ?? []).map((p) => [p.id as string, (p.full_name as string)?.trim() || null]));
  const bandById = new Map((bands ?? []).map((b) => [b.id as string, b as { id: string; band_name: string }]));

  for (const row of rows) {
    if (Date.now() - started > deadlineMs) break;
    // Claim it first: another sender (a retry) that got here first keeps it.
    const { data: claimed } = await admin
      .from("room_schedule_emails")
      .update({ status: "sending", claimed_at: new Date().toISOString(), tries: (row.tries as number) + 1 })
      .eq("id", row.id)
      .eq("status", "waiting")
      .select("id");
    if (!claimed?.length) continue;
    const band = bandById.get(row.band_id as string);
    let ok = false;
    let error: string | null = null;
    try {
      if (!band) throw new Error("The group isn't registered anymore");
      const times = (slots ?? [])
        .filter((s) => s.band_id === band.id)
        .map((s) => ({ roomId: s.room_id as string, startsAt: new Date(s.starts_at as string), endsAt: new Date(s.ends_at as string) }));
      const email = await composeScheduleEmail({
        kind: row.kind as "posted" | "changed",
        event: event as EventRow,
        rooms: (rooms ?? []) as RoomRow[],
        band,
        times,
        greet: (row.greet_name as string | null) ?? null,
        by: personName.get(row.created_by as string) ?? null,
        whatChanged: (row.what_changed as string | null) ?? null,
        origin,
        replyName: reply,
      });
      ok = await sendEmail({ to: row.to_email as string, ...email, eventId });
      if (!ok) error = "The email service didn't take it";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await admin
      .from("room_schedule_emails")
      .update(ok ? { status: "sent", sent_at: new Date().toISOString(), error: null } : { status: "failed", error: (error ?? "").slice(0, 500) })
      .eq("id", row.id);
    await pause();
  }
}

/**
 * The festival's dates or time zone moved its posted times (the latest change in the log, written by the
 * database), and nobody has been emailed since: what moved and when, for "Email directors their new times".
 * Null otherwise.
 */
export async function datesMoved(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
): Promise<{ summary: string; at: string; line: string } | null> {
  const [{ data: ev }, { data: last }, { data: mail }] = await Promise.all([
    supabase.from("events").select("status, performance_order_published").eq("id", eventId).maybeSingle(),
    supabase.from("room_schedule_changes").select("summary, saved_at").eq("event_id", eventId).order("version", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("room_schedule_emails").select("created_at").eq("event_id", eventId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!ev?.performance_order_published || ev.status !== "published" || !last?.summary) return null;
  if (!/^The festival's (dates|time zone)/.test(last.summary as string)) return null;
  if (mail && (mail.created_at as string) > (last.saved_at as string)) return null;
  const summary = last.summary as string;
  // A new time zone keeps every group's clock times (the database converts them); new dates move them.
  const line = /dates/.test(summary) ? `${summary}, so every group's times moved with it.` : `${summary}. Every group keeps its clock times in the new time zone.`;
  return { summary, at: last.saved_at as string, line };
}

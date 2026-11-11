import "server-only";
import type { NotifyKind } from "@/lib/notify-kinds";
import { isSchemaError } from "@/lib/schema-check";
import { createAdminClient } from "@/lib/supabase/server";

export type NotifyRecipients = { memberIds: string[]; extraEmails: string[] };

/** Each kind's saved choice of who gets it (kinds with no row aren't in the map; empty before the 20261230000000 update). */
export async function loadNotifyRecipients(eventId: string): Promise<Map<NotifyKind, NotifyRecipients>> {
  const { data, error } = await createAdminClient()
    .from("event_notification_recipients")
    .select("kind, member_ids, extra_emails")
    .eq("event_id", eventId);
  if (error && !isSchemaError(error)) console.error("Loading notification recipients failed", error);
  return new Map((data ?? []).map((r) => [r.kind as NotifyKind, { memberIds: r.member_ids ?? [], extraEmails: r.extra_emails ?? [] }]));
}

/**
 * Who gets one kind of email about an event (bookings, registrations,
 * withdrawals, the volunteer summary): the people its hosts picked, or
 * `fallback` when they haven't picked anyone for that kind. People who have
 * left the account or the event's team are skipped.
 */
export async function notificationEmails(
  eventId: string,
  kind: NotifyKind,
  fallback: () => Promise<string[]> | string[] = () => [],
): Promise<string[]> {
  const people = await notificationPeople(eventId, kind);
  if (!people) return dedupe(await fallback());
  return people.map((p) => p.email);
}

/**
 * Who gets one kind of email, as people: team members (with their user id,
 * for their own choices) and other addresses (no user id). Null when the
 * hosts haven't picked anyone for that kind yet.
 */
export async function notificationPeople(eventId: string, kind: NotifyKind): Promise<{ userId: string | null; email: string }[] | null> {
  const saved = (await loadNotifyRecipients(eventId)).get(kind);
  if (!saved) return null;
  const admin = createAdminClient();
  const { data: event } = await admin.from("events").select("organization_id").eq("id", eventId).maybeSingle();
  const ids = saved.memberIds;
  const [{ data: hosts }, { data: leads }] =
    event && ids.length
      ? await Promise.all([
          admin.from("organization_members").select("user_id, profiles(email)").eq("organization_id", event.organization_id).in("user_id", ids),
          admin.from("event_staff").select("user_id, profiles(email)").eq("event_id", eventId).in("role", ["volunteer_director", "co_host"]).in("user_id", ids),
        ])
      : [{ data: [] }, { data: [] }];
  type Member = { user_id: string; profiles: { email: string | null } | null };
  const team = ([...(hosts ?? []), ...(leads ?? [])] as unknown as Member[]).map((m) => ({ userId: m.user_id, email: m.profiles?.email }));
  const seen = new Set<string>();
  return [...team, ...saved.extraEmails.map((email) => ({ userId: null, email }))].filter((p): p is { userId: string | null; email: string } => {
    const key = p.email?.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupe(emails: (string | null | undefined)[]) {
  const seen = new Set<string>();
  return emails.filter((e): e is string => {
    const key = e?.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { isSchemaError } from "@/lib/schema-check";
import { senderName } from "@/lib/sender-name";

/**
 * Who an event's emails are from, as people see it: the person sending and
 * who they're with ("Becca Smith, Lone Star Band Boosters via Field Command
 * Events", lib/sender-name.ts), and where a reply goes.
 * The address itself is always ours (supabase/migrations/20261212000000_event_email_settings.sql).
 */
export type EventSender = {
  name: string;
  replyTo: string | null;
  /** The person's own name, when there is one ("Dana Whitfield"), for "Reply to this email to reach Dana". */
  person?: string | null;
};

/** What the Replies setting looks like, before falling back to the defaults. */
export type ReplySetting = { replies: boolean; replyTo: string | null };

const cache = new Map<string, { at: number; sender: EventSender | null }>();
const CACHE_MS = 60_000;

/**
 * The sender for an event's emails (cached for a minute, since reminders and
 * bulk emails send many at once). Null if the event can't be read.
 */
export async function eventSender(eventId: string): Promise<EventSender | null> {
  const hit = cache.get(eventId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.sender;
  const sender = await loadSender(eventId).catch((err) => {
    console.error("Loading the event's sender failed", err);
    return null;
  });
  cache.set(eventId, { at: Date.now(), sender });
  return sender;
}

/** After the Replies setting changes, so the next email uses it. */
export function forgetEventSender(eventId: string) {
  cache.delete(eventId);
}

async function loadSender(eventId: string): Promise<EventSender | null> {
  const admin = createAdminClient();
  const { data: event, error: eventError } = await admin
    .from("events")
    .select("created_by, organizations(name, account_kind, school)")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) console.error("Loading the event's sender failed", eventError.message);
  if (!event) return null;
  const org = event.organizations as unknown as { name: string; account_kind?: string; school?: string | null } | null;

  // Email settings: who emails come from (sender_id, after the 20270101000000 update) and where replies go.
  let { data: row, error } = await admin.from("event_email_settings").select("replies, reply_to, sender_id").eq("event_id", eventId).maybeSingle();
  if (isSchemaError(error)) {
    ({ data: row, error } = await admin.from("event_email_settings").select("replies, reply_to").eq("event_id", eventId).maybeSingle());
  }
  if (error && !isSchemaError(error)) console.error("Loading the event's email settings failed", error.message);
  const settings = row as { replies: boolean; reply_to: string | null; sender_id?: string | null } | null;

  // The person chosen in Email settings, or else whoever created the event.
  const personId = settings?.sender_id ?? event.created_by;
  const { data: person } = personId
    ? await admin.from("profiles").select("full_name, email").eq("id", personId).maybeSingle()
    : { data: null };
  const name = senderName({
    person: person?.full_name,
    organization: org?.name,
    school: org?.account_kind === "teacher" ? org.school : null,
  });

  // No setting yet: replies go to that person.
  const replies = settings ? settings.replies : true;
  return { name, replyTo: replies ? settings?.reply_to || person?.email || null : null, person: person?.full_name?.trim() || null };
}

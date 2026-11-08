import "server-only";
import { DEFAULT_SETTINGS, LEGACY_SETTINGS_COLUMNS, MODES_SETTINGS_COLUMNS, PASSCODE_SETTINGS_COLUMNS, SETTINGS_COLUMNS, WEEKLY_SETTINGS_COLUMNS, type ConferenceSettings } from "@/lib/conferences";
import { isSchemaError } from "@/lib/schema-check";
import type { createAdminClient, createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

/**
 * A conference's saved settings (null if none yet), with defaults for
 * anything missing. Before the weekly hours (20261211000000) and several
 * ways to meet (20261213000000) updates have been run, reads the older
 * columns, so existing conferences keep working.
 */
export async function loadConferenceSettings(client: Client, eventId: string) {
  const read = (columns: string) => client.from("conference_settings").select(columns).eq("event_id", eventId).maybeSingle();
  let { data, error } = await read(SETTINGS_COLUMNS);
  // Before the contact email update (20270124000000).
  if (isSchemaError(error)) ({ data, error } = await read(PASSCODE_SETTINGS_COLUMNS));
  // Before the passcode update (20261229000000).
  if (isSchemaError(error)) ({ data, error } = await read(MODES_SETTINGS_COLUMNS));
  const modesColumn = !isSchemaError(error);
  // Before the several-ways-to-meet update (20261213000000): the weekly columns, then before those.
  if (isSchemaError(error)) ({ data, error } = await read(WEEKLY_SETTINGS_COLUMNS));
  const legacy = isSchemaError(error);
  if (legacy) ({ data, error } = await read(LEGACY_SETTINGS_COLUMNS));
  const saved = (data ?? null) as Partial<ConferenceSettings> | null;
  const settings: ConferenceSettings = { ...DEFAULT_SETTINGS, ...(saved ?? {}), breaks: saved?.breaks ?? [] };
  return { saved: saved ? settings : null, settings, error, legacy, modesColumn };
}

/**
 * Whether the conference asks families for their child's name (Edit event
 * details). Meetings never do. True until the 20261219000000 update adds the setting.
 */
export async function asksChildName(supabase: Client, eventId: string) {
  const { data, error } = await supabase.from("events").select("event_type, ask_child_name").eq("id", eventId).maybeSingle();
  if (error) return true;
  const event = data as { event_type?: string; ask_child_name?: boolean } | null;
  return event?.event_type !== "meeting" && event?.ask_child_name !== false;
}

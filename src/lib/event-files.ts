import "server-only";
import { getUser } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { formatDate, formatTime, utcToZonedDate, zoneAbbreviation } from "@/lib/time";
import { hasPass, readPass } from "@/lib/volunteer-pass";

// Maps and documents a host shares. Files sit in a private bucket; people open
// them through /files/<id>, which checks they're allowed and hands out a
// short-lived link. Lists for each page are loaded with the server's key,
// filtered by who the page is for.

export const FILES_BUCKET = "event-files";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

export const AUDIENCES = [
  { value: "public", label: "Everyone", hint: "On the public event page" },
  { value: "directors", label: "Directors", hint: "Directors of registered bands or groups" },
  { value: "volunteers", label: "Volunteers", hint: "People signed up for shifts" },
  { value: "team", label: "The team", hint: "Co-hosts, Volunteer Leads, and Coordinators" },
] as const;
export type Audience = (typeof AUDIENCES)[number]["value"];

export type EventFile = {
  id: string;
  event_id: string;
  label: string;
  path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  audiences: Audience[];
  visible_from: string | null;
  /** Only loaded for hosts. */
  uploaded_by?: string | null;
  uploaded_at?: string | null;
  /** "Uploaded Wed, Oct 7, 9:52 AM CDT", for everyone but hosts (who also see who). */
  uploaded_when?: string;
};

const COLUMNS = "id, event_id, label, path, file_name, content_type, size_bytes, audiences, visible_from, uploaded_at";

export const fileHref = (id: string) => `/files/${id}`;

/** "PDF · 2.4 MB" */
export function fileMeta(f: { content_type: string; size_bytes: number }) {
  const kind = f.content_type === "application/pdf" ? "PDF" : "Image";
  const mb = f.size_bytes / (1024 * 1024);
  return `${kind} · ${mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(f.size_bytes / 1024))} KB`}`;
}

/** Has its "show from" day arrived (in the event's time zone)? */
export function isShowing(f: { visible_from: string | null }, timezone: string) {
  return !f.visible_from || f.visible_from <= utcToZonedDate(new Date().toISOString(), timezone);
}

/** Files of these events that are shared with any of these audiences and showing now. */
export async function filesFor(eventIds: string[], audiences: Audience[], timezone: (eventId: string) => string) {
  if (eventIds.length === 0 || audiences.length === 0) return [];
  const { data } = await createAdminClient()
    .from("event_files")
    .select(COLUMNS)
    .in("event_id", eventIds)
    .overlaps("audiences", audiences)
    .order("created_at");
  return ((data ?? []) as EventFile[])
    .filter((f) => isShowing(f, timezone(f.event_id)))
    .map((f) => ({ ...f, uploaded_when: f.uploaded_at ? `Uploaded ${uploadedAt(f.uploaded_at, timezone(f.event_id))}` : undefined }));
}

/** Events this browser's volunteer pass or signed-in account has shifts at. */
export async function volunteerEventIds(): Promise<Set<string>> {
  const [user, pass] = await Promise.all([getUser(), readPass()]);
  const [fromPass, fromAccount] = await Promise.all([
    hasPass(pass)
      ? createAdminClient().rpc("pass_agenda", { p_volunteer_tokens: pass.v, p_assignment_tokens: pass.a })
      : Promise.resolve({ data: [] }),
    user ? (await createClient()).rpc("my_agenda") : Promise.resolve({ data: [] }),
  ]);
  return new Set(
    [...((fromPass.data ?? []) as { event_id: string }[]), ...((fromAccount.data ?? []) as { event_id: string }[])].map(
      (r) => r.event_id,
    ),
  );
}

/** May whoever is asking open this file? */
export async function canOpen(file: EventFile, event: { id: string; status: string; timezone: string }) {
  const user = await getUser();
  const supabase = await createClient();
  // Hosts always (even before its "show from" day).
  if (user && (await supabase.rpc("is_event_admin", { ev: event.id })).data) return true;
  if (!isShowing(file, event.timezone)) return false;
  const has = (a: Audience) => file.audiences.includes(a);
  if (has("public") && event.status === "published") return true;
  if (user && has("team") && (await supabase.rpc("is_event_staff", { ev: event.id })).data) return true;
  if (user && has("directors")) {
    const { count } = await supabase
      .from("bands")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event.id)
      .eq("director_user_id", user.id);
    if (count) return true;
  }
  if (has("volunteers") && (await volunteerEventIds()).has(event.id)) return true;
  return false;
}

/** "Wed, Oct 7, 9:52 AM CDT" */
function uploadedAt(at: string, timezone: string) {
  return `${formatDate(utcToZonedDate(at, timezone), { year: undefined })}, ${formatTime(at, timezone)} ${zoneAbbreviation(at, timezone)}`;
}

/** For hosts: "Uploaded by Hana Host · Tue, Oct 7, 9:52 AM CDT", for each file id. */
export async function uploadedLines(
  files: { id: string; uploaded_by?: string | null; uploaded_at?: string | null }[],
  timezone: string,
): Promise<Map<string, string>> {
  const ids = [...new Set(files.map((f) => f.uploaded_by).filter((id): id is string => Boolean(id)))];
  const { data } = ids.length
    ? await createAdminClient().from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] };
  const names = new Map((data ?? []).map((p) => [p.id as string, (p.full_name as string) || (p.email as string)]));
  return new Map(
    files
      .filter((f) => f.uploaded_at)
      .map((f) => {
        const when = uploadedAt(f.uploaded_at!, timezone);
        const who = f.uploaded_by ? names.get(f.uploaded_by) : null;
        return [f.id, `Uploaded ${who ? `by ${who} ` : ""}· ${when}`];
      }),
  );
}

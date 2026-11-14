import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { type CsvValue } from "@/lib/csv";
import { formatPhone } from "@/lib/phone";
import { type Child } from "@/lib/parents";
import { formatDate, formatTime, utcToZonedDate } from "@/lib/time";

// Visitor registration (school visits): the downloads and the visitor check-in
// report, built on the server from Host/Co-host-only database functions
// (20270206000000_visitor_adults.sql), never from table rows in the browser.
// Each function throws when the signed-in person isn't a Host or Co-host.

type Db = Awaited<ReturnType<typeof createClient>>;

export type ListKind = "visitor_list" | "class_list" | "report_download" | "report_print";

/** One row of the visitor list: one per adult per child. */
export type VisitorListRow = {
  adult_id: string;
  registration_id: string;
  adult_position: number;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  registered_by: string;
  child_name: string;
  grade: string;
  teacher: string;
  name_needs_check: boolean;
  is_new: boolean;
  name_changed: boolean;
};

/** The top card: the last visitor list download, and what's new or corrected since. */
export type VisitorListStatus = {
  last_at: string | null;
  last_by_name: string | null;
  last_rows: number | null;
  adults: number;
  new_adults: number;
  changed_adults: number;
  names_to_check: number;
};

export type ReportStatus = "not_yet" | "front_office" | "checked_in";

/** One adult on the visitor check-in report. */
export type ReportRow = {
  adult_id: string;
  registration_id: string;
  adult_position: number;
  first_name: string;
  last_name: string;
  full_name: string;
  /** The name as typed, while it still needs checking. */
  typed_name: string | null;
  name_needs_check: boolean;
  registered_by: string;
  children: Child[];
  status: ReportStatus;
  checked_in_at: string | null;
  checked_in_by_name: string | null;
  sent_to_office_at: string | null;
};

/** The report's numbers and state: live, final, or deleted (names-free totals). */
export type ReportSummary = {
  families: number | null;
  adults: number | null;
  children: number | null;
  checked_in: number | null;
  sent_to_office: number | null;
  not_checked_in: number | null;
  today: string;
  is_event_day: boolean;
  is_final: boolean;
  kept: boolean;
  deleted: boolean;
  /** The day families' details and the report are deleted (event's time zone). */
  delete_on: string;
  deleted_at: string | null;
  /** The last time someone printed or downloaded the report. */
  saved_at: string | null;
  saved_by_name: string | null;
  saved_kind: "report_download" | "report_print" | null;
};

async function rpc<T>(supabase: Db, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data as T;
}

export const visitorList = (supabase: Db, eventId: string) => rpc<VisitorListRow[]>(supabase, "parent_visitor_list", { p_event: eventId });

export const visitorListStatus = async (supabase: Db, eventId: string) =>
  (await rpc<VisitorListStatus[]>(supabase, "parent_visitor_list_status", { p_event: eventId }))[0];

export const checkInReport = (supabase: Db, eventId: string) => rpc<ReportRow[]>(supabase, "parent_check_in_report", { p_event: eventId });

export const checkInSummary = async (supabase: Db, eventId: string) =>
  (await rpc<ReportSummary[]>(supabase, "parent_check_in_summary", { p_event: eventId }))[0];

/** Notes a download or print in the event's log (who, when, which, how many rows; no family names). */
export const recordDownload = (supabase: Db, eventId: string, kind: ListKind, rows: number) =>
  rpc<null>(supabase, "record_parent_download", { p_event: eventId, p_kind: kind, p_rows: rows });

/** Families' email addresses (Hosts and Co-hosts only), by registration. */
export async function familyEmails(supabase: Db, eventId: string) {
  const rows = await rpc<{ registration_id: string; email: string }[]>(supabase, "parent_registration_emails", { p_event: eventId });
  return new Map(rows.map((r) => [r.registration_id, r.email]));
}

/** The visitor list file, for the school's visitor system: one row per adult per child. */
export function visitorListCsvRows(rows: VisitorListRow[]): CsvValue[][] {
  return [
    ["First name", "Last name", "Phone", "Email", "Registered by", "Child name", "Grade", "Teacher", "Name needs checking", "Changed since last download"],
    ...rows.map((r) => [
      r.first_name,
      r.last_name,
      formatPhone(r.phone),
      r.email ?? "",
      r.registered_by,
      r.child_name,
      r.grade,
      r.teacher,
      r.name_needs_check ? "Check first and last name" : "",
      r.is_new ? "New" : r.name_changed ? "Name corrected" : "",
    ]),
  ];
}

/** The class list (one row per child), the download Parent Registration has always had. */
export async function classListCsvRows(supabase: Db, eventId: string, timezone: string): Promise<CsvValue[][]> {
  const emails = await familyEmails(supabase, eventId);
  const { data, error } = await supabase
    .from("parent_registrations")
    .select("id, phone, children, created_at, adults:parent_registration_adults(position, full_name)")
    .eq("event_id", eventId)
    .order("parent_name");
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return [
    ["Adults", "Child", "Grade", "Teacher", "Email", "Phone", "Registered"],
    ...(data ?? []).flatMap((r) => {
      const adults = [...((r.adults ?? []) as { position: number; full_name: string }[])].sort((a, b) => a.position - b.position);
      return ((r.children ?? []) as Child[]).map((c) => [
        adults.map((a) => a.full_name).join("; "),
        c.name,
        c.grade,
        c.teacher,
        emails.get(r.id) ?? "",
        formatPhone(r.phone),
        utcToZonedDate(r.created_at, timezone),
      ]);
    }),
  ];
}

const STATUS_WORDS = (final: boolean): Record<ReportStatus, string> => ({
  not_yet: final ? "Not checked in" : "Not yet",
  front_office: "Sent to the front office",
  checked_in: "Checked in",
});

/** The visitor check-in report as a spreadsheet: one row per adult. */
export function reportCsvRows(rows: ReportRow[], summary: Pick<ReportSummary, "is_final">, timezone: string): CsvValue[][] {
  const words = STATUS_WORDS(summary.is_final);
  return [
    ["First name", "Last name", "Registered by", "Children", "Status", "Checked in", "Checked in by"],
    ...rows.map((r) => [
      r.first_name,
      r.last_name,
      r.registered_by,
      r.children.map((c) => `${c.name} (${c.grade}, ${c.teacher})`).join("; "),
      words[r.status],
      r.checked_in_at ? `${formatDate(utcToZonedDate(r.checked_in_at, timezone), { year: undefined })} ${formatTime(r.checked_in_at, timezone)}` : "",
      r.checked_in_by_name ?? "",
    ]),
  ];
}

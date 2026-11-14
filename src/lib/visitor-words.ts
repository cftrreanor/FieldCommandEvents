import { brand } from "@/lib/brand";
import { formatDate } from "@/lib/time";

// The words Parent Registration and the visitor check-in report share, written once so every screen says the same
// thing (docs/design-decisions/2026-11-14-visitor-attendance.md). Works on the server and in the browser.

/** The report's one name, on every button and heading that opens it. */
export const REPORT_NAME = "Visitor check-in report";

/** Who sees what, said once on Parent Registration. True of the database's read rules (20270206000000_visitor_adults.sql). */
export const WHO_SEES =
  "Only this event's Hosts and Co-hosts can download these lists or open the visitor check-in report. Your check-in team sees families' names, children, and phone numbers at the door, from the day before the event through the event day, and never their email addresses.";

/** What the report counts, on screen and on paper. */
export const REPORT_SCOPE =
  "Counts check-ins at the event door only. People who went through the school's own visitor process at the front office aren't counted here.";

/** The report's groups, in order on screen and on paper: the people to act on first. */
export const REPORT_GROUPS: { key: "front_office" | "checked_in" | "not_yet"; title: string }[] = [
  { key: "front_office", title: "Sent to the front office" },
  { key: "checked_in", title: "Checked in" },
  { key: "not_yet", title: "Not checked in" },
];

/** "Sat, Nov 28" */
export const shortDate = (date: string) => formatDate(date, { year: undefined });

/** The deletion warning, date first (Parent Registration's top card and the report). */
export const saveBefore = (deleteOn: string) =>
  `Save the visitor check-in report before ${formatDate(deleteOn)}. That day ${brand.name} deletes it, along with families' and children's details.`;

/** The front-office mark: one name for the action, one for the state, and the way back. */
export const SEND_TO_OFFICE = "Send to the front office";
export const SENT_TO_OFFICE = "Sent to the front office";
export const letCheckIn = (first: string) => `Let ${first} check in`;

/**
 * The last time someone printed or downloaded the report, saying which: "Pat Morgan printed this report on Sat, Nov 14"
 * (on the report) or "...printed the report..." (elsewhere).
 */
export const savedLine = (who: string | null, on: string, kind: "report_print" | "report_download" | null, where: "report" | "elsewhere" = "elsewhere") =>
  kind === "report_download"
    ? `${who ?? "Someone"} downloaded the report spreadsheet on ${shortDate(on)}.`
    : `${who ?? "Someone"} printed ${where === "report" ? "this" : "the"} report on ${shortDate(on)}.`;

/** Once a Host or Co-host confirmed the school has its copy: who, when, and the date that still stands. */
export const copyLine = (who: string | null, on: string, deleteOn: string) =>
  `${who ?? "Someone"} confirmed your school has a copy of the report on ${shortDate(on)}. ${brand.name} deletes it, along with families' and children's details, on ${formatDate(deleteOn)}.`;

/** After the clean-up. */
export const deletedLine = (on: string) =>
  `The visitor check-in report was deleted on ${formatDate(on)}, along with families' and children's details, as promised to families. Copies you printed or saved are your school's records.`;

/** Under the report, on screen (paper has the dashboard's printed-records note). */
export const REPORT_RECORDS_NOTE = `Copies you print or download are your school's records, to keep under your school's policies. ${brand.name} deletes only what's stored in the app.`;

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Angela", "Angela and Marcus", "Angela, Marcus, and Sam" */
export function joinNames(names: string[]) {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

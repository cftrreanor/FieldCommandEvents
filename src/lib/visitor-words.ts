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

/** "Sat, Nov 28" */
export const shortDate = (date: string) => formatDate(date, { year: undefined });

/** The deletion warning, date first (Parent Registration's top card and the report). */
export const saveBefore = (deleteOn: string) =>
  `Save the visitor check-in report before ${formatDate(deleteOn)}. That day ${brand.name} deletes it, along with families' and children's details.`;

/** Once someone printed or downloaded the report: what the app knows, and the date that still stands. */
export const savedLine = (who: string | null, on: string, deleteOn: string) =>
  `${who ?? "Someone"} printed or downloaded this report on ${shortDate(on)}. Check that your school has the copy. ${brand.name} deletes it, along with families' and children's details, on ${formatDate(deleteOn)}.`;

/** After the clean-up. */
export const deletedLine = (on: string) =>
  `Families' and children's details were deleted on ${formatDate(on)}, as promised to families, and the visitor check-in report with them. Copies you printed or saved are your school's records.`;

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Angela", "Angela and Marcus", "Angela, Marcus, and Sam" */
export function joinNames(names: string[]) {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

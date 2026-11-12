import { EVENT_TYPES } from "@/lib/event-types";
import { normalizePhone } from "@/lib/phone";
import type { IconName } from "./icons";

/** The pilot ends January 1, 2027 for everyone: the last free day of a pilot account. */
export const PILOT_END = "2027-01-01";
export const PILOT_END_LABEL = "January 1, 2027";

/** Under the first "Join the pilot" button on the website: what joining means, said gently (owner, 2026-11-10). */
export const PILOT_NOTE = `Free for organizers through ${PILOT_END_LABEL}. A person on our team replies within a day to help you get set up.`;

// The order of the event-type cards on the home page, so the form matches them; conferences and meetings last.
const HOME_ORDER = ["volunteer", "band_contest", "group_event", "fair", "school_visit", "conference", "meeting"];

// The website's names for each kind, so the form says what the cards above it say (panel, 2026-11-10).
const WEBSITE_NAMES: Record<string, string> = {
  volunteer: "Volunteers and sign-ups",
  band_contest: "Band contests",
  group_event: "Choir, orchestra, and group festivals",
  fair: "School fairs and fundraisers",
  school_visit: "Visitor registration and check-in",
  conference: "Parent-teacher conferences",
  meeting: "Meetings",
};

/** The event types a pilot request can ask about (every kind, plus "something else"). */
export const PILOT_EVENT_TYPES: { value: string; label: string; icon: IconName }[] = [
  // Teachers ask for parent-teacher conferences here too: every account is set up by us.
  ...EVENT_TYPES.map((t) => ({ value: t.value as string, label: WEBSITE_NAMES[t.value] ?? t.label, icon: t.icon as IconName })).sort(
    (a, b) => HOME_ORDER.indexOf(a.value) - HOME_ORDER.indexOf(b.value),
  ),
  { value: "other", label: "Something else", icon: "sparkle" },
];

export const pilotEventTypeLabels = (values: readonly string[] | null | undefined) =>
  (values ?? []).map((v) => PILOT_EVENT_TYPES.find((t) => t.value === v)?.label ?? v);

/** A pilot request's answers, checked and tidied. */
export type PilotRequest = {
  name: string;
  email: string;
  phone: string;
  organization: string;
  eventTypes: string[];
  notes: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks every answer on the "Join the pilot" form at once, so the
 * browser can point at each problem before sending and the server can
 * check again. `fieldErrors` is keyed by the input's name.
 */
export function checkPilotRequest(form: FormData): { request?: PilotRequest; fieldErrors: Record<string, string> } {
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const name = text("name");
  const email = text("email").toLowerCase();
  const organization = text("organization");
  const notes = text("notes");
  const phone = normalizePhone(text("phone"));
  const known = new Set(PILOT_EVENT_TYPES.map((t) => t.value));
  const eventTypes = [...new Set(form.getAll("eventTypes").map(String))].filter((v) => known.has(v));

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = "Please enter your name.";
  else if (name.length > 200) fieldErrors.name = "Please keep your name under 200 characters.";
  if (!EMAIL.test(email) || email.length > 254) fieldErrors.email = "Please enter a valid email address, like name@example.org.";
  if (!phone) fieldErrors.phone = "Please enter a 10-digit phone number, including the area code.";
  if (organization.length < 2) fieldErrors.organization = "Please enter your school or group.";
  else if (organization.length > 200) fieldErrors.organization = "Please keep this under 200 characters.";
  if (!eventTypes.length) fieldErrors.eventTypes = "Please pick at least one kind of event.";
  if (notes.length > 2000) fieldErrors.notes = "Please keep your answer under 2,000 characters.";

  if (Object.keys(fieldErrors).length || !phone) return { fieldErrors };
  return { request: { name, email, phone, organization, eventTypes, notes }, fieldErrors };
}

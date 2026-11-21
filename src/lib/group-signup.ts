/**
 * Signing up a group (20270102000000_group_signup.sql): the rules the sign-up
 * page shows, matching what the database enforces.
 */

/** How many people one booker can add besides themselves. */
export const MAX_OTHERS = 6;

/** The guardian checkbox, word for word. It's saved as shown with each minor's record. */
export const GUARDIAN_CONSENT =
  "I confirm I am this volunteer's parent or legal guardian, or have their permission to sign them up.";

/** Why someone can't take a shift ("Adults only", "Ages 16 and up"), or null when they can (shift_ineligible() in the database). */
export function ineligibleReason(
  person: { minor: boolean; age: number | null },
  shift: { adultsOnly: boolean; minAge: number | null },
): string | null {
  if (!person.minor) return null;
  if (shift.adultsOnly) return "Adults only";
  if (shift.minAge != null && (person.age == null || person.age < shift.minAge)) return `Ages ${shift.minAge} and up`;
  return null;
}

/** Whether two shifts' times overlap. Back-to-back shifts (one ends at 11:00, the next starts at 11:00) don't. */
export function shiftsOverlap(a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }) {
  return Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);
}

/** "You + 2 others · 4 spots left", or "You + 6 others · Group full". */
export function groupProgress(others: number) {
  const who = others === 0 ? "Just you" : `You + ${others} other${others === 1 ? "" : "s"}`;
  const left = MAX_OTHERS - others;
  return `${who} · ${left <= 0 ? "Group full" : `${left} spot${left === 1 ? "" : "s"} left`}`;
}

/**
 * Sent as the booker's phone when the form uses the number this device's earlier sign-up gave ("Phone ending 0142"):
 * the server reads the real number again (pass_contact) and never takes it from the page.
 */
export const PHONE_ON_FILE = "on-file";

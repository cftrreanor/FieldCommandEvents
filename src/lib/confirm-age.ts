// The confirm step's age rule (built-page review, 2026-11-21): a shift tapped from "More ways to help" or the
// organization page is booked for one adult. The age comes from the remembered booker (pass_contact, read on the
// server), or, with no details on this device, from a required "I'm 18 or older" box. Anyone under 18 uses the full
// sign-up form, which asks their age, checks Adults only and minimum ages, and asks for a guardian's consent. Pure,
// so `npm test` runs it.

export const CONFIRM_ADULT_LABEL = "I'm 18 or older";
export const CONFIRM_UNDER_18_LINK = "Under 18? Use the full sign-up form";

/** Why the confirm step can't book this person as an adult, or null when it can. */
export function confirmAgeProblem({ remembered, adultTicked }: { remembered: { minor: boolean } | null; adultTicked: boolean }): string | null {
  if (remembered) return remembered.minor ? "Please use the full sign-up form for anyone under 18." : null;
  return adultTicked ? null : "Tick the box to confirm you're 18 or older. If you're under 18, use the full sign-up form.";
}

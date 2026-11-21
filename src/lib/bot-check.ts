import "server-only";
import { headers } from "next/headers";

// Cloudflare Turnstile: a privacy-friendly "I'm not a robot" check on the
// public forms (volunteer sign-up, parent registration, conference booking,
// the pilot form, and "Email me my link"). Most people never see it.
// Off until both keys are set in Vercel (docs/SETUP-GUIDE.md).

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Both keys are set, so the check runs (the confirm step's first-time path needs it on the live site). */
export const botCheckConfigured = () => Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

/** What a person sees if the check didn't pass (or hadn't finished yet). */
export const BOT_CHECK_FAILED = "Please wait a moment for the security check to finish, then try again. If it keeps happening, reload the page.";

/**
 * True if this form submission passed the check. A missing or rejected token
 * fails. If Cloudflare itself can't be reached, it passes (and is logged, so
 * Sentry sends an alert) rather than stopping families from signing up.
 */
export async function passesBotCheck(formData: FormData): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  // Both keys are needed: without the site key the page shows no check, so nothing could pass.
  if (!secret || !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return true;
  const token = String(formData.get("cf-turnstile-response") ?? "");
  if (!token) return false;
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Turnstile siteverify returned ${res.status}`);
    const result = (await res.json()) as { success?: boolean };
    return result.success === true;
  } catch (err) {
    console.error("Bot check unavailable; letting the form through", err);
    return true;
  }
}

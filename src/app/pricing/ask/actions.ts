"use server";

import type { ActionState } from "@/lib/action-state";
import { getUser } from "@/lib/auth";
import { brand } from "@/lib/brand";
import { getMyOrganization, getOrigin } from "@/lib/data";
import { emailLayout, sendEmail } from "@/lib/email";
import { loadTiers } from "@/lib/package-names";
import { loadAccountHost } from "@/lib/plan";
import { passLabel } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/server";

const PLAN_CODE = /^[a-z0-9_]{1,60}$/;
/** The longest note for the Account Host (the box says so too). */
const NOTE_MAX = 500;

/**
 * "Ask [name] to choose [Package]": a team member who isn't the Account Host asks them, and the app sends the email
 * (UX F13). Only to the Account Host of the person's own account, looked up here (account_host()), never an
 * address from the form; replies go to the person asking.
 *
 * The form sends `plan` (a package or pass the pricing page shows, or "" for packages in general) and an optional
 * `note` (up to 500 characters). record_account_host_ask() checks the page is live (admins can try it in the
 * preview) and the plan is shown, and allows one ask per person per package per day. The result's `message` says
 * what was sent ("Sent to Dana: a request to choose Event Command. …"), for the screen to show.
 */
export async function askAccountHost(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: "Please sign in again, then try once more." };
  const note = String(formData.get("note") ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (note.length > NOTE_MAX) {
    const msg = `Please keep your note under ${NOTE_MAX} characters.`;
    return { error: msg, fieldErrors: { note: msg } };
  }
  const code = String(formData.get("plan") ?? "").trim();
  if (code && !PLAN_CODE.test(code)) return { error: "That package isn't offered. Pick another, or ask about packages in general." };

  const supabase = await createClient();
  const org = await getMyOrganization();
  if (!org) return { error: `We couldn't find your account. Please email us at ${brand.supportEmail}.` };
  const host = await loadAccountHost(supabase, org.id, user.id);
  if (host.isMe) return { error: "You're the Account Host, so you can ask us about a package yourself." };
  if (!host.email) return { error: `We couldn't find your Account Host's email. Please ask them, or email us at ${brand.supportEmail}.` };
  const first = host.name.split(" ")[0] || host.name;

  // The package's name as the pricing page says it (a pass by its kind of event).
  const tier = code ? (await loadTiers()).find((t) => t.code === code) : undefined;
  const planName = tier ? (tier.kind === "pass" ? passLabel(tier.event_types[0] ?? "") : tier.name) : null;
  const what = planName ? `choose ${planName}` : "look at packages";

  // Checked and counted before anything is sent: only while the page is live, only shown packages, once a day.
  const { data: recorded, error: recordError } = await supabase.rpc("record_account_host_ask", { p_plan_code: code || null });
  if (recordError) {
    if (recordError.code === "P0001") return { error: recordError.message };
    if (recordError.code === "42501") {
      // The page switched off (it isn't open to everyone yet), or not on a team / signed out (the message says which).
      return { error: recordError.message.startsWith("The pricing page") ? `Requests aren't open yet. Please email us at ${brand.supportEmail}.` : recordError.message };
    }
    console.error("Recording an Account Host ask failed", recordError);
    return { error: `We couldn't send that just now. Please try again, or email ${host.name} yourself.` };
  }
  if (recorded === "already") {
    return { ok: true, message: `You already asked ${first} ${planName ? `about ${planName}` : "about packages"} today, so we didn't send it again.` };
  }

  const { data: me } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle<{ full_name: string | null }>();
  const myName = me?.full_name?.trim() || user.email;
  const origin = await getOrigin();
  const subject = planName ? `${myName} asked you to choose ${planName}` : `${myName} asked you to look at packages`;
  const { html, text } = emailLayout({
    heading: subject,
    paragraphs: [
      `${myName} (${user.email}), on your ${org.name} team, asked you to ${what} for the account on the ${brand.name} packages and prices page. Only the Account Host can choose a package.`,
      `Ask us about it from the packages and prices page, and a real person will reply within a day. Nothing is charged unless you choose a package. Reply to this email to reach ${myName}.`,
    ],
    // What they typed, escaped by emailLayout like every row.
    rows: note ? [{ title: "Their note", detail: note }] : undefined,
    button: { label: planName ? `Ask about ${planName}` : "See packages and prices", url: `${origin}/pricing${planName ? `/ask?plan=${code}` : ""}` },
  });
  const ok = await sendEmail({ to: host.email, subject, html, text, replyTo: user.email, fromApp: true });
  if (!ok) {
    // Not sent, so it doesn't count toward today's ask.
    await supabase.rpc("forget_account_host_ask", { p_plan_code: code || null });
    return { error: `We couldn't send that just now. Please try again, or email ${host.name} yourself.` };
  }
  return { ok: true, message: `Sent to ${first}: a request to ${what}. ${first} will see it in their email.` };
}

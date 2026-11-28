"use server";

import { BOT_CHECK_FAILED, passesBotCheck } from "@/lib/bot-check";
import { fieldErrorState, friendlyDbError, type ActionState } from "@/lib/action-state";
import { brand } from "@/lib/brand";
import { getOrigin } from "@/lib/data";
import { notifyAdmins } from "@/lib/admin-alerts";
import { emailLayout } from "@/lib/email";
import { tierNames } from "@/lib/package-names";
import { listWords } from "@/lib/plan";
import { checkPricingRequest } from "@/lib/pricing";
import { pilotEventTypeLabels } from "@/lib/pilot";
import { createClient } from "@/lib/supabase/server";

/**
 * "Ask about [package]" and "Get a [kind] pass" from the pricing page. Saved through submit_pricing_request() as
 * the visitor (signed in or not), which checks it again, attaches their own account when they're signed in, and
 * limits how many come in; the table itself can't be written from a browser. Then it emails the request to every
 * admin (replies go to the person who asked).
 *
 * The form sends: name, email, organization, eventTypes (any number), plan (a package or pass code, or empty),
 * also (more pass codes, any number), teacherRate ("1"), payByInvoice ("1"), message, organizationId (the signed-in person's account, optional), and
 * the same bot traps as the pilot form: website (hidden, left empty), startedAt, touched, and the Turnstile token.
 */
/** What submit_pricing_request() returns (see the migration for each status). */
type SubmitResult = { id: string | null; status: "saved" | "duplicate" | "limit" | "quiet"; alert: boolean };

export async function requestPricing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // Bot traps: a hidden field people never fill in, a minimum time on the page,
  // and a real tap, click or key press in the form (scripts filling it in don't make one).
  const startedAt = Number(formData.get("startedAt"));
  const touched = formData.get("touched") === "1";
  if (String(formData.get("website") ?? "") || !touched || !startedAt || Date.now() - startedAt < 2500) {
    // A real person who autofills and sends very fast can land here too; trying again works.
    return { error: "Please wait a moment, then press Send request again." };
  }

  // The browser checks these first; this is the backstop. Every problem comes back at once.
  const { request: d, fieldErrors } = checkPricingRequest(formData);
  if (!d) return fieldErrorState(fieldErrors);
  if (!(await passesBotCheck(formData))) return { error: BOT_CHECK_FAILED };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_pricing_request", {
    p_name: d.name,
    p_email: d.email,
    p_organization: d.organization,
    p_event_types: d.eventTypes,
    p_plan_code: d.plan,
    p_teacher_rate: d.teacherRate,
    p_pay_by_invoice: d.payByInvoice,
    p_message: d.message || null,
    p_organization_id: d.organizationId,
    p_also_codes: d.also,
  });
  if (error) {
    // The database's own checks (a package no longer offered, the page switched off) come back in plain words.
    if (error.code === "P0001") return { error: friendlyDbError(error) };
    if (error.code === "42501") return { error: `Requests aren't open yet. Please email us at ${brand.supportEmail}.` };
    console.error("Saving pricing request failed", error);
    return { error: `We couldn't send that. Please try again, or email us at ${brand.supportEmail}.` };
  }
  const result = data as SubmitResult;
  // Sent twice (double tap, back button): we already have it.
  if (result.status === "duplicate") return { ok: true, message: "We already had this request, so we didn't send it twice." };
  if (result.status === "limit") {
    return { error: `You've sent 3 requests in the last hour. We'll answer those first, or email us at ${brand.supportEmail}.` };
  }
  const origin = await getOrigin();
  if (result.status === "quiet") {
    // Saved, but too many came in this hour to email each one: the admins get one warning, and the list has them all.
    if (result.alert) {
      const { html, text } = emailLayout({
        heading: "Lots of pricing requests this hour",
        paragraphs: [
          "More than 30 pricing requests came in during the last hour. They're all saved, but we've stopped emailing each one until it slows down. Check the list for anything that looks automated.",
        ],
        button: { label: "Open pricing requests", url: `${origin}/admin/pricing-requests` },
      });
      await notifyAdmins({ subject: "Lots of pricing requests this hour", html, text });
    }
    return { ok: true };
  }

  const names = await tierNames();
  // Every package and pass asked about, the first and any more passes with it.
  const planName = d.plan ? listWords([d.plan, ...d.also].map((c) => names[c] ?? c)) : "No package picked";
  const rows = [
    { title: "Name", detail: d.name },
    { title: "Email", detail: d.email },
    { title: "School or group", detail: d.organization },
    { title: "Asked about", detail: planName },
    ...(d.eventTypes.length ? [{ title: "Kinds of event", detail: pilotEventTypeLabels(d.eventTypes).join(", ") }] : []),
    ...(d.teacherRate ? [{ title: "Teacher rate", detail: "Says they're a classroom teacher (check before applying it)" }] : []),
    ...(d.payByInvoice ? [{ title: "Paying", detail: "By invoice or purchase order" }] : []),
    ...(d.message ? [{ title: "Message", detail: d.message }] : []),
  ];
  const { html, text } = emailLayout({
    heading: `Pricing request: ${d.organization}`,
    paragraphs: [`${d.name} asked about ${planName === "No package picked" ? "pricing" : planName}. Reply to this email to reach them.`],
    rows,
    button: { label: "Open pricing requests", url: `${origin}/admin/pricing-requests` },
  });
  await notifyAdmins({ subject: `Pricing request: ${d.organization}`, html, text, replyTo: d.email });

  // The form shows its own "Request sent" panel, so no toast message here.
  return { ok: true };
}

"use server";

import { BOT_CHECK_FAILED, passesBotCheck } from "@/lib/bot-check";
import { fieldErrorState, friendlyDbError, type ActionState } from "@/lib/action-state";
import { brand } from "@/lib/brand";
import { getOrigin } from "@/lib/data";
import { notifyAdmins } from "@/lib/admin-alerts";
import { emailLayout } from "@/lib/email";
import { tierNames } from "@/lib/package-names";
import { checkPricingRequest, type PricingRequestResult } from "@/lib/pricing";
import { pilotEventTypeLabels } from "@/lib/pilot";
import { createClient } from "@/lib/supabase/server";

/**
 * "Ask about [package]" and "Get a [kind] pass" from the pricing page. Saved through submit_pricing_request() as
 * the visitor (signed in or not), which checks it again, attaches their own account when they're signed in, and
 * limits how many come in; the table itself can't be written from a browser. Then it emails the request to every
 * admin (replies go to the person who asked).
 *
 * The form sends: name, email, organization, eventTypes (any number), plan (a package or pass code, or empty),
 * teacherRate ("1"), payByInvoice ("1"), message, organizationId (the signed-in person's account, optional), and
 * the same bot traps as the pilot form: website (hidden, left empty), startedAt, touched, and the Turnstile token.
 */
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
  });
  if (error) {
    // The database's own checks (a package no longer offered, the page switched off) come back in plain words.
    if (error.code === "P0001") return { error: friendlyDbError(error) };
    if (error.code === "42501") return { error: `Requests aren't open yet. Please email us at ${brand.supportEmail}.` };
    console.error("Saving pricing request failed", error);
    return { error: `We couldn't send that. Please try again, or email us at ${brand.supportEmail}.` };
  }
  const result = data as PricingRequestResult;
  // Sent twice (double tap, back button): we already have it.
  if (result.status === "duplicate") return { ok: true, message: "We already had this request, so we didn't send it twice." };
  if (result.status === "busy") {
    return { error: `We're getting a lot of requests right now. Please email us at ${brand.supportEmail} instead.` };
  }

  const names = await tierNames();
  const planName = d.plan ? (names[d.plan] ?? d.plan) : "No package picked";
  const origin = await getOrigin();
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

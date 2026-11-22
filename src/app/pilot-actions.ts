"use server";

import { BOT_CHECK_FAILED, passesBotCheck } from "@/lib/bot-check";
import { fieldErrorState, type ActionState } from "@/lib/action-state";
import { brand } from "@/lib/brand";
import { getOrigin } from "@/lib/data";
import { notifyAdmins } from "@/lib/admin-alerts";
import { recordSiteMetric } from "@/lib/site-metrics-server";
import { emailLayout } from "@/lib/email";
import { checkPilotRequest, pilotEventTypeLabels } from "@/lib/pilot";
import { isSchemaError } from "@/lib/schema-check";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * "Join the pilot" from the home page. Visitors aren't signed in, so this
 * saves with the server's private key; the table itself can't be written
 * from a browser. Then it emails the request to us and every admin (replies go to them).
 */
export async function requestPilot(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // Bot traps: a hidden field people never fill in, a minimum time on the page,
  // and a real tap, click or key press in the form (scripts filling it in don't make one).
  const startedAt = Number(formData.get("startedAt"));
  const touched = formData.get("touched") === "1";
  if (String(formData.get("website") ?? "") || !touched || !startedAt || Date.now() - startedAt < 2500) {
    // A real person who autofills and sends very fast can land here too; trying again works.
    return { error: "Please wait a moment, then send it again." };
  }

  // The browser checks these first; this is the backstop. Every problem comes back at once.
  const { request: d, fieldErrors } = checkPilotRequest(formData);
  if (!d) return fieldErrorState(fieldErrors);
  if (!(await passesBotCheck(formData))) return { error: BOT_CHECK_FAILED };
  const { phone, eventTypes } = d;

  const admin = createAdminClient();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [{ count: mine }, { count: everyone }] = await Promise.all([
    admin.from("pilot_requests").select("id", { count: "exact", head: true }).eq("email", d.email).gte("created_at", hourAgo),
    admin.from("pilot_requests").select("id", { count: "exact", head: true }).gte("created_at", hourAgo),
  ]);
  // Sent twice (double tap, back button): we already have it.
  if (mine) return { ok: true };
  if ((everyone ?? 0) >= 30) {
    return { error: `We're getting a lot of requests right now. Please email us at ${brand.supportEmail} instead.` };
  }

  const base = { name: d.name, email: d.email, phone, organization: d.organization };
  let { error } = await admin.from("pilot_requests").insert({ ...base, event_types: eventTypes, notes: d.notes || null });
  if (error && isSchemaError(error)) {
    // Before 20261115000000_pilot_event_types.sql: keep the event types in the notes.
    const typesLine = `Event types: ${pilotEventTypeLabels(eventTypes).join(", ")}`;
    ({ error } = await admin.from("pilot_requests").insert({ ...base, notes: [typesLine, d.notes].filter(Boolean).join("\n\n") }));
  }
  if (error) {
    console.error("Saving pilot request failed", error);
    return { error: `We couldn't send that. Please try again, or email us at ${brand.supportEmail}.` };
  }

  const origin = await getOrigin();
  const rows = [
    { title: "Name", detail: d.name },
    { title: "Email", detail: d.email },
    { title: "Phone", detail: phone },
    { title: "Organization", detail: d.organization },
    { title: "Event types", detail: pilotEventTypeLabels(eventTypes).join(", ") },
    ...(d.notes ? [{ title: "Hardest part today", detail: d.notes }] : []),
  ];
  const { html, text } = emailLayout({
    heading: `Pilot request: ${d.organization}`,
    paragraphs: [`${d.name} asked to join the pilot. Reply to this email to reach them.`],
    rows,
    button: { label: "Open the pilot pipeline", url: `${origin}/admin/pipeline` },
  });
  await notifyAdmins({ subject: `Pilot request: ${d.organization}`, html, text, replyTo: d.email });
  await recordSiteMetric("pilot_sent", String(formData.get("page") ?? ""), String(formData.get("source") ?? ""));

  // The form shows its own "Request sent" panel, so no toast message here.
  return { ok: true };
}

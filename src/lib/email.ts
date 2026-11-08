import "server-only";
import nodemailer from "nodemailer";
import { brand } from "@/lib/brand";
import { isDemoEmail } from "@/lib/demo-email";
import { emailButton, emailShell } from "@/lib/email-format";
import { eventSender } from "@/lib/event-sender";
import { isQa } from "@/lib/qa";
import { withOrganizerEmail } from "@/lib/ics";
import { isSchemaError } from "@/lib/schema-check";
import { createAdminClient } from "@/lib/supabase/server";

// Transactional email through Resend's REST API (https://resend.com/docs/api-reference/emails/send-email).
// Without RESEND_API_KEY, emails are skipped and logged, so the app still works.

const FROM = process.env.EMAIL_FROM ?? `${brand.name} <no-reply@fieldcommandevents.com>`;
const FROM_ADDRESS = FROM.match(/<([^>]+)>/)?.[1] ?? FROM;

/**
 * "Becca Smith, Lone Star Band Boosters via Field Command Events" <no-reply@…>:
 * the organizer's name (lib/sender-name.ts) on our own address (email apps reject mail that claims
 * someone else's domain). Quotes, angle brackets and line breaks are dropped.
 */
function fromWithName(name: string | null | undefined) {
  const clean = (name ?? "").replace(/["\\<>\r\n]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  // An organization named like us (our own test accounts) just sends as us, not "Field Command Events via Field Command Events".
  return clean && clean.toLowerCase() !== brand.name.toLowerCase() ? `"${clean} via ${brand.name}" <${FROM_ADDRESS}>` : FROM;
}

/** The From and Reply-To for an email: the event's organizer when there's an event. */
async function senderFor(eventId: string | undefined, replyTo: string | undefined) {
  const sender = eventId ? await eventSender(eventId) : null;
  return { from: fromWithName(sender?.name), replyTo: replyTo ?? sender?.replyTo ?? undefined };
}

/** Whether an event is a "try it" event, kept for a minute so a loop of emails checks once. */
const trialCache = new Map<string, { trial: boolean | null; at: number }>();

/**
 * Is this a "try it" event (a draft of a kind its plan doesn't include)? Published
 * events never are. Null when it couldn't be checked, even after a retry.
 */
async function isTrialEvent(eventId: string): Promise<boolean | null> {
  const hit = trialCache.get(eventId);
  if (hit && Date.now() - hit.at < 60_000) return hit.trial;
  const admin = createAdminClient();
  let trial: boolean | null = null;
  for (let attempt = 0; attempt < 2 && trial === null; attempt++) {
    const { data: event, error } = await admin.from("events").select("status").eq("id", eventId).maybeSingle();
    if (error) continue;
    if (!event || event.status === "published") {
      trial = false;
      break;
    }
    const res = await admin.rpc("event_is_trial", { p_event: eventId });
    if (res.error && isSchemaError(res.error)) trial = false; // Before the database update: nothing is held back.
    else if (!res.error) trial = res.data === true;
  }
  if (trial !== null) trialCache.set(eventId, { trial, at: Date.now() });
  return trial;
}

/**
 * Of these addresses, the ones an event's email must not go to, and why: a "try
 * it" event emails only the account's own people (event_email_blocked,
 * 20270104000000_drafts_any_type.sql). Published events always send. A draft
 * whose check fails twice holds its email back.
 */
async function heldBack(eventId: string | undefined, to: string[]): Promise<{ held: Set<string>; reason: string }> {
  const none = { held: new Set<string>(), reason: "" };
  if (!eventId || to.length === 0) return none;
  const trial = await isTrialEvent(eventId);
  if (trial === false) return none;
  if (trial === null) {
    console.error("Couldn't check whether this event is a try-it event; holding the draft's email back", eventId);
    return { held: new Set(to.map((t) => t.toLowerCase())), reason: "Couldn't check the plan for this draft event, so it was held back" };
  }
  const { data, error } = await createAdminClient().rpc("event_email_blocked", { p_event: eventId, p_emails: to });
  if (error) {
    console.error("event_email_blocked failed; holding the draft's email back", error.message);
    return { held: new Set(to.map((t) => t.toLowerCase())), reason: "Couldn't check the plan for this draft event, so it was held back" };
  }
  return { held: new Set(((data ?? []) as string[]).map((t) => t.toLowerCase())), reason: "Try-it event: the plan doesn't include this kind of event" };
}

/**
 * Notes each email in email_log, for the admin dashboard's person and account
 * pages ("did they get it?"). Never stops an email from going out.
 */
async function logEmail(to: string, subject: string, status: "sent" | "failed" | "skipped", error?: string, by?: EmailAuthor) {
  try {
    const { error: dbError } = await createAdminClient()
      .from("email_log")
      .insert({
        to_email: to,
        subject: subject.slice(0, 300),
        status,
        error: error ? error.slice(0, 500) : null,
        ...(by ? { sent_by: by.userId, body: by.body.slice(0, 10000) } : {}),
      });
    if (dbError) console.error("email_log insert failed", dbError.message);
  } catch (err) {
    console.error("email_log insert failed", err);
  }
}

/** For emails written by a person (the admin dashboard): who, and what it said. */
export type EmailAuthor = { userId: string; body: string };

/**
 * The logo's web address for emails (email apps fetch it from the site).
 * Uses the site's main address on Vercel; otherwise the given origin, if any.
 * Null means "show the name instead".
 */
export function emailLogoUrl(origin?: string | null) {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}/logo.png`;
  return origin && !origin.includes("localhost") ? `${origin}/logo.png` : null;
}

export type EmailAttachment = { filename: string; content: string; contentType: string };

/**
 * A calendar invitation (iCalendar text). It's embedded the way Google and
 * Outlook send their own invites: as a text/calendar part of the message
 * itself, plus an .ics attachment. Gmail only applies updates and
 * cancellations reliably in that form.
 */
export type CalendarInvite = { method: "REQUEST" | "CANCEL"; content: string };

/** The exact message we send for an invite (also used by tests). */
export function inviteMessage({
  to,
  subject,
  html,
  text,
  invite,
  from = FROM,
  replyTo,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
  invite: CalendarInvite;
  from?: string;
  replyTo?: string;
}) {
  return {
    from,
    ...(replyTo ? { replyTo } : {}),
    to,
    subject,
    html,
    text,
    icalEvent: {
      method: invite.method,
      filename: invite.method === "CANCEL" ? "cancel.ics" : "invite.ics",
      // Yes / No answers go where replies go (the organizer), not to no-reply.
      content: replyTo ? withOrganizerEmail(invite.content, replyTo) : invite.content,
    },
  };
}

/** Invites go through Resend's SMTP service (same API key), which lets us shape the message. */
async function sendInvite(message: Parameters<typeof inviteMessage>[0]): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY not set; skipped email:", message.subject);
    await logEmail(message.to, message.subject, "skipped", "Email isn't set up (RESEND_API_KEY)");
    return false;
  }
  try {
    const transport = nodemailer.createTransport({
      host: "smtp.resend.com",
      port: 465,
      secure: true,
      auth: { user: "resend", pass: key },
    });
    await transport.sendMail(inviteMessage(message));
    await logEmail(message.to, message.subject, "sent");
    return true;
  } catch (err) {
    console.error("Invite email failed", err);
    await logEmail(message.to, message.subject, "failed", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** The QA site (src/lib/qa.ts) keeps every email in its outbox instead of sending it. */
async function toOutbox(m: { from: string; replyTo?: string | null; to: string[]; subject: string; html: string; text: string; invite?: string }) {
  const { error } = await createAdminClient()
    .from("qa_outbox")
    .insert({ sender: m.from, reply_to: m.replyTo ?? null, recipients: m.to, subject: m.subject, html: m.html, text_body: m.text, invite: m.invite ?? null });
  if (error) console.error("Saving to the QA outbox failed", error.message);
  return !error;
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
  attachments,
  invite,
  author,
  eventId,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
  invite?: CalendarInvite;
  author?: EmailAuthor;
  /** An event's email: from its organizer's name, replies per its Replies setting. */
  eventId?: string;
}): Promise<boolean> {
  // Demo people (src/lib/demo.ts) have made-up addresses: never email them
  // (on the QA site everything goes to the outbox, theirs included).
  if (isDemoEmail(to) && !isQa()) return true;
  const check = await heldBack(eventId, [to]);
  if (check.held.has(to.toLowerCase())) {
    await logEmail(to, subject, "skipped", check.reason, author);
    return false;
  }
  const sender = await senderFor(eventId, replyTo);
  if (isQa()) {
    const saved = await toOutbox({ ...sender, to: [to], subject, html, text, invite: invite?.method });
    await logEmail(to, subject, saved ? "sent" : "failed", saved ? undefined : "QA outbox", author);
    return saved;
  }
  if (invite) return sendInvite({ to, subject, html, text, invite, ...sender });
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY not set; skipped email:", subject);
    await logEmail(to, subject, "skipped", "Email isn't set up (RESEND_API_KEY)", author);
    return false;
  }
  const send = (withAttachments: boolean) =>
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sender.from,
        to: [to],
        subject,
        html,
        text,
        ...(sender.replyTo ? { reply_to: sender.replyTo } : {}),
        ...(withAttachments && attachments?.length
          ? {
              attachments: attachments.map((a) => ({
                filename: a.filename,
                content: Buffer.from(a.content, "utf8").toString("base64"),
                content_type: a.contentType,
              })),
            }
          : {}),
      }),
    });
  try {
    let res = await send(true);
    if (!res.ok && res.status === 422 && attachments?.length) {
      // Don't lose the whole email over an attachment problem.
      console.error("Resend rejected attachments; resending without", await res.text());
      res = await send(false);
    }
    if (!res.ok) {
      const body = await res.text();
      console.error("Resend send failed", res.status, body);
      await logEmail(to, subject, "failed", `${res.status} ${body}`, author);
      return false;
    }
    await logEmail(to, subject, "sent", undefined, author);
    return true;
  } catch (err) {
    console.error("Resend send failed", err);
    await logEmail(to, subject, "failed", err instanceof Error ? err.message : String(err), author);
    return false;
  }
}

/**
 * One message to many people, each getting their own copy (nobody sees the
 * other addresses). Uses Resend's batch API, 100 emails per request, so a few
 * hundred go out in seconds: for urgent messages. Returns how many were sent.
 */
export async function sendEmailToMany({
  to,
  subject,
  html,
  text,
  replyTo,
  eventId,
}: {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  eventId?: string;
}): Promise<number> {
  const all = [...new Set(to.map((t) => t.trim().toLowerCase()))].filter((t) => t && (isQa() || !isDemoEmail(t)));
  const { held, reason } = await heldBack(eventId, all);
  const recipients = all.filter((t) => !held.has(t));
  const log = async (emails: string[], status: "sent" | "failed" | "skipped", error?: string) => {
    const { error: dbError } = await createAdminClient()
      .from("email_log")
      .insert(emails.map((e) => ({ to_email: e, subject: subject.slice(0, 300), status, error: error ? error.slice(0, 500) : null })));
    if (dbError) console.error("email_log insert failed", dbError.message);
  };
  if (held.size) await log([...held], "skipped", reason);
  if (recipients.length === 0) return 0;
  if (isQa()) {
    const saved = await toOutbox({ ...(await senderFor(eventId, replyTo)), to: recipients, subject, html, text });
    await log(recipients, saved ? "sent" : "failed", saved ? undefined : "QA outbox");
    return saved ? recipients.length : 0;
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY not set; skipped email:", subject);
    await log(recipients, "skipped", "Email isn't set up (RESEND_API_KEY)");
    return 0;
  }
  const sender = await senderFor(eventId, replyTo);
  let sent = 0;
  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100);
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(chunk.map((e) => ({ from: sender.from, to: [e], subject, html, text, ...(sender.replyTo ? { reply_to: sender.replyTo } : {}) }))),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error("Resend batch send failed", res.status, body);
        await log(chunk, "failed", `${res.status} ${body}`);
      } else {
        sent += chunk.length;
        await log(chunk, "sent");
      }
    } catch (err) {
      console.error("Resend batch send failed", err);
      await log(chunk, "failed", err instanceof Error ? err.message : String(err));
    }
    if (i + 100 < recipients.length) await pause();
  }
  return sent;
}

/** Resend allows about 2 requests per second on the free plan. */
export const pause = (ms = 600) => new Promise((r) => setTimeout(r, ms));

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type EmailRow = {
  title: string;
  detail: string;
  /** Show the detail large and dark: the thing people look for (like when). */
  strong?: boolean;
  /** Show the detail in body color, not grey: something people need, like where to go. */
  plain?: boolean;
  links?: { label: string; url: string }[];
  /** Words before the links, like "Other calendars:". */
  linksLabel?: string;
};

/** A simple, readable layout that works in every email client. */
export function emailLayout({
  heading,
  paragraphs,
  rows,
  button,
  link,
  footer,
  preheader,
}: {
  heading: string;
  paragraphs: string[];
  rows?: EmailRow[];
  button?: { label: string; url: string };
  /** A quieter second choice under the button. */
  link?: { label: string; url: string };
  footer?: string;
  /** The inbox preview line; the first paragraph if not given. */
  preheader?: string;
}) {
  const p = (t: string) => `<p style="font-size:16px;line-height:24px;margin:0 0 16px">${escape(t)}</p>`;
  const a = (l: { label: string; url: string }) => `<a href="${escape(l.url)}" style="color:#0b3558;font-weight:bold">${escape(l.label)}</a>`;
  const list = rows?.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 24px">${rows
        .map(
          (r) =>
            `<tr><td style="padding:12px 0;border-top:1px solid #dfe3e8">${
              r.strong
                ? `<div style="color:#4b5f72;font-size:14px;line-height:20px">${escape(r.title)}</div><div style="font-weight:bold;font-size:17px;line-height:24px">${escape(r.detail)}</div>`
                : `<div style="font-weight:bold;font-size:15px">${escape(r.title)}</div><div style="color:${r.plain ? "#1a1a1a" : "#4b5f72"};font-size:${r.plain ? 15 : 14}px;line-height:${r.plain ? 22 : 20}px">${escape(r.detail).replace(/\n/g, "<br>")}</div>`
            }${
              r.links?.length
                ? `<div style="font-size:14px;line-height:22px;margin-top:4px;color:#4b5f72">${r.linksLabel ? `${escape(r.linksLabel)} ` : ""}${r.links.map(a).join(" &nbsp;·&nbsp; ")}</div>`
                : ""
            }</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const btn = button ? emailButton(button.label, button.url) : "";
  const second = link ? `<p style="font-size:15px;line-height:22px;margin:-8px 0 24px">${a(link)}</p>` : "";
  const html = emailShell({
    content: `<h1 style="font-size:22px;line-height:28px;margin:0 0 16px">${escape(heading)}</h1>
${paragraphs.map(p).join("")}${list}${btn}${second}`,
    footer: footer ? [footer] : [],
    logoUrl: emailLogoUrl(),
    preheader: preheader ?? paragraphs[0],
  });
  const text = [
    heading,
    "",
    ...paragraphs,
    "",
    ...(rows ?? []).flatMap((r) => [`- ${r.title}: ${r.detail}`, ...(r.links ?? []).map((l) => `  ${l.label}: ${l.url}`)]),
    "",
    ...(button ? [`${button.label}: ${button.url}`] : []),
    ...(link ? [`${link.label}: ${link.url}`] : []),
  ].join("\n");
  return { html, text };
}

"use server";

import { revalidatePath } from "next/cache";
import { fieldErrorState, friendlyDbError, type ActionState } from "@/lib/action-state";
import { requirePlatformAdmin } from "@/lib/admin";
import { brand } from "@/lib/brand";
import { getOrigin } from "@/lib/data";
import { emailLayout, emailLogoUrl, sendEmail } from "@/lib/email";
import { renderEmail } from "@/lib/email-format";
import { EMAIL_LINK_DAYS } from "@/lib/email-link-age";
import { hostWelcomeLink } from "@/lib/host-invite-link";
import { invitePackageChoices, loadTiers, tierNames } from "@/lib/package-names";
import { invitePackageLabel, inviteStatusLabel, isInviteStatus } from "@/lib/invitation-plan";
import { fillTemplate, firstName, siteLinks } from "@/lib/merge-fields";
import { normalizePhone } from "@/lib/phone";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { customWords, loadSystemEmail } from "@/lib/system-email-overrides";
import { formatDate } from "@/lib/time";
import { myName } from "../data";

/**
 * The "Invite a host" panel: who they are, the package and free period they'll
 * start on, and the welcome email. "Save and invite later" keeps it all on a
 * card under Lead without inviting them (admin_save_host_lead). admin_send_host_invitation() saves them on a
 * pilot request card (the one the panel was opened from, their open card, or a
 * new one under Invited) and invites them; then the welcome email goes out.
 * "Save without sending" (an invitation already waiting) skips the email.
 * Platform admins only (the database checks too).
 */
export async function sendHostInvitation(pilotRequestId: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePlatformAdmin();
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const email = get("email").toLowerCase();
  const name = get("name");
  const organization = get("organization");
  const phoneInput = get("phone");
  const pkg = get("package");
  const status = get("status");
  const freeUntil = get("freeUntil");
  const templateId = get("template");
  const intent = formData.get("intent");
  const sendNow = intent !== "save" && intent !== "later";

  const fieldErrors: Record<string, string> = {};
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fieldErrors.email = "Enter their email address.";
  if (name.length < 2) fieldErrors.name = "Enter the host's name.";
  const phone = phoneInput ? normalizePhone(phoneInput) : null;
  if (phoneInput && !phone) fieldErrors.phone = "Enter a 10-digit phone number, or leave it blank.";
  // A package retired since this invitation or lead was saved stays allowed for it (it was promised then).
  if (!invitePackageChoices(await loadTiers(), await savedInvitePackage(email, pilotRequestId)).some((p) => p.value === pkg))
    fieldErrors.package = "Pick a package.";
  if (!isInviteStatus(status)) fieldErrors.status = "Pick a free pilot or a trial.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(freeUntil)) fieldErrors.freeUntil = "Pick the last day of the free period.";
  if (Object.keys(fieldErrors).length) return fieldErrorState(fieldErrors);

  const supabase = await createClient();
  if (intent === "later") {
    // Save and invite later: a card under Lead with these choices, and no invitation or email yet.
    const { error } = await supabase.rpc("admin_save_host_lead", {
      p_email: email,
      p_name: name,
      p_organization: organization || null,
      p_phone: phone,
      p_package: pkg,
      p_plan_status: status,
      p_free_until: freeUntil,
      p_template: /^[0-9a-f-]{36}$/i.test(templateId) ? templateId : null,
      p_request: pilotRequestId,
    });
    if (error) return { error: error.code === "P0001" || error.code === "42501" ? error.message : friendlyDbError(error) };
    revalidatePath("/admin", "layout");
    return { ok: true, message: `Saved ${name} as a lead. No email was sent. Invite them from their card when you're ready.` };
  }
  const { error } = await supabase.rpc("admin_send_host_invitation", {
    p_email: email,
    p_name: name,
    p_organization: organization || null,
    p_phone: phone,
    p_package: pkg,
    p_plan_status: status,
    p_free_until: freeUntil,
    p_request: pilotRequestId,
  });
  if (error) return { error: error.code === "P0001" || error.code === "42501" ? error.message : friendlyDbError(error) };
  revalidatePath("/admin", "layout");

  const plan = `${invitePackageLabel(pkg, await tierNames())}, ${inviteStatusLabel(status).toLowerCase()} through ${formatDate(freeUntil, { weekday: undefined })}`;
  if (!sendNow) return { ok: true, message: `Saved: ${plan}. No email was sent.` };

  const origin = await getOrigin();
  // The email's button signs them straight in (a fresh link each send); before the update, normal sign-in.
  const welcome = await hostWelcomeLink(origin, email);
  let message: { subject: string; html: string; text: string; body?: string };
  if (templateId) {
    const { data: template } = await createAdminClient().from("email_templates").select("subject, body").eq("id", templateId).maybeSingle();
    if (!template) return { error: "That email template wasn't found. They're invited, but no email was sent. Pick another template and send again." };
    const vars = {
      name,
      first_name: firstName(name),
      organization,
      plan: `${invitePackageLabel(pkg, await tierNames())} (${inviteStatusLabel(status).toLowerCase()})`,
      free_until: formatDate(freeUntil, { weekday: undefined }),
      my_name: await myName(user.id),
      ...siteLinks(origin, email),
      ...(welcome && {
        login_url: welcome(),
        new_event_url: welcome("/dashboard/events/new"),
        account_url: welcome("/dashboard/account"),
      }),
    };
    const body = fillTemplate(template.body, vars).text;
    message = { subject: fillTemplate(template.subject, vars).text, body, ...renderEmail(body, { logoUrl: emailLogoUrl(origin) }) };
  } else {
    const url = welcome?.() ?? `${origin}/login?${new URLSearchParams({ next: "/dashboard", email })}`;
    const custom = customWords("host_invitation", await loadSystemEmail("host_invitation"), {
      first_name: firstName(name),
      name,
      email,
      organization,
      plan: `${invitePackageLabel(pkg, await tierNames())} (${inviteStatusLabel(status).toLowerCase()})`,
      free_until: formatDate(freeUntil, { weekday: undefined }),
    });
    message = {
      subject: custom?.subject || `Your ${brand.name} host invitation`,
      ...emailLayout({
        heading: custom?.heading || `You're invited to host on ${brand.name}`,
        paragraphs: custom?.paragraphs ?? [
          `Hi ${firstName(name)}. Your pilot spot is ready. Tap the button below to set up your account and create your first event.`,
          `There's no password to remember: the button signs you in as ${email}. It works for ${EMAIL_LINK_DAYS} days. After that, sign in with this email address and we'll email you a sign-in link.`,
        ],
        button: { label: custom?.button || "Set up my account", url },
        footer: `Questions? Reply to this email or write to ${brand.supportEmail}.`,
      }),
    };
  }
  const sent = await sendEmail({
    to: email,
    subject: message.subject,
    html: message.html,
    text: message.text,
    replyTo: brand.supportEmail,
    author: message.body ? { userId: user.id, body: message.body } : undefined,
  });
  return {
    ok: true,
    message: sent
      ? `Invited ${email} on ${plan}. They'll get the email now.`
      : `Invited ${email} on ${plan}, but the email couldn't be sent. Tell them to sign in with that address.`,
  };
}

/** The package already saved on this person's invitation, or on their lead card: kept even if retired since. */
async function savedInvitePackage(email: string, pilotRequestId: string | null): Promise<string | null> {
  const admin = createAdminClient();
  const [{ data: inv }, { data: lead }] = await Promise.all([
    admin.from("host_invitations").select("package").eq("email", email).maybeSingle(),
    pilotRequestId ? admin.from("pilot_requests").select("planned_package").eq("id", pilotRequestId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return (inv?.package as string | null) ?? (lead?.planned_package as string | null) ?? null;
}

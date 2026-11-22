"use server";

import type { ActionState } from "@/lib/action-state";
import { getUser } from "@/lib/auth";
import { brand } from "@/lib/brand";
import { getMyOrganization, getOrigin } from "@/lib/data";
import { emailLayout, sendEmail } from "@/lib/email";
import { tierNames } from "@/lib/package-names";
import { loadAccountHost } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";

const PLAN_CODE = /^[a-z0-9_]{1,60}$/;

/**
 * "Ask [name] to choose [Package]": a team member who isn't the Account Host asks them, and the app sends the email
 * (UX F13). Only to the Account Host of the person's own account, looked up here (account_host()), never an
 * address from the form; replies go to the person asking.
 */
export async function askAccountHost(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: "Please sign in again, then try once more." };
  const supabase = await createClient();
  const org = await getMyOrganization();
  if (!org) return { error: `We couldn't find your account. Please email us at ${brand.supportEmail}.` };
  const host = await loadAccountHost(supabase, org.id, user.id);
  if (host.isMe) return { error: "You're the Account Host, so you can ask us about a package yourself." };
  if (!host.email) return { error: `We couldn't find your Account Host's email. Please ask them, or email us at ${brand.supportEmail}.` };

  const code = String(formData.get("plan") ?? "");
  const names = await tierNames();
  const planName = PLAN_CODE.test(code) ? (names[code] ?? null) : null;
  const { data: me } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle<{ full_name: string | null }>();
  const myName = me?.full_name?.trim() || user.email;
  const origin = await getOrigin();
  const what = planName ?? "a package";
  const { html, text } = emailLayout({
    heading: `${myName} asked you to choose ${what}`,
    paragraphs: [
      `${myName} (${user.email}), on your ${org.name} team, asked you to choose ${what} for the account on the ${brand.name} prices page. Only the Account Host can choose a package.`,
      "Ask us about it from the prices page, and a real person will reply within a day. Nothing is charged unless you choose a package. Reply to this email to reach " + myName + ".",
    ],
    button: { label: planName ? `Ask about ${planName}` : "See packages and prices", url: `${origin}/pricing${planName ? `/ask?plan=${code}` : ""}` },
  });
  const ok = await sendEmail({ to: host.email, subject: `${myName} asked you to choose ${what}`, html, text, replyTo: user.email, fromApp: true });
  if (!ok) return { error: `We couldn't send that just now. Please try again, or email ${host.name} yourself.` };
  return { ok: true };
}

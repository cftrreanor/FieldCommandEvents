import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { brand } from "@/lib/brand";
import { formatPhone } from "@/lib/phone";
import { getMyOrganization } from "@/lib/data";
import { loadOrgPageSummary } from "@/lib/org-page-summary";
import { possessive, WHY_LINE } from "@/lib/org-page-words";
import { includedLines, loadAccountPlan, usageLines } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";
import { PasswordSection, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const org = await getMyOrganization();
  // Hosts see their package; others (and before the packages update) don't.
  const plan = org ? await loadAccountPlan(supabase, org.id) : null;
  // The Account Host and Co-hosts of every event: the organization page's state, and the way in.
  const orgPage = org ? await loadOrgPageSummary(supabase, org.id) : null;
  const [{ data: profile }, { data: auth }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
    // Fresh from Supabase, not the sign-in token, so a password saved a moment ago shows.
    supabase.auth.getUser(),
  ]);
  const hasPassword = !!auth.user?.user_metadata?.has_password;
  const mailto = <a href={`mailto:${brand.supportEmail}`} className="font-semibold text-brand underline underline-offset-4">{brand.supportEmail}</a>;

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div>
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Account</h1>
        <p className="mt-2 text-muted">
          Signed in as <strong className="font-semibold text-foreground">{user.email}</strong>
        </p>
        <p className="mt-1 text-sm leading-6 text-muted">Need to change your email? Write to us at {mailto}.</p>
      </div>

      {plan && (
        <Card id="plan">
          <h2 className="text-lg font-semibold">Your plan: {plan.package_name}</h2>
          {plan.active !== plan.package && (
            <p className="mt-2 text-sm leading-6 text-danger">
              Your plan isn&apos;t active right now, so you can publish parent-teacher conferences only. Your published events stay live. Write to us
              at {mailto} to renew it.
            </p>
          )}
          <h3 className="mt-4 text-sm font-semibold">What&apos;s included</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
            {includedLines(plan).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <h3 className="mt-4 text-sm font-semibold">What you&apos;re using</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
            {usageLines(plan).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm leading-6 text-muted">
            Need more, or an event your plan doesn&apos;t include? Write to us at {mailto} about an upgrade or a one-time event pass.
          </p>
        </Card>
      )}

      {orgPage && (
        <Card id="organization-page">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            <span>Organization page</span>
            {orgPage.page_on && !orgPage.blocked ? <Badge tone="live">On</Badge> : <Badge tone="neutral">Off</Badge>}
          </h2>
          {orgPage.blocked ? (
            <p className="mt-1 text-sm leading-6">This account is {orgPage.blocked === "suspended" ? "suspended" : "closed"}, so its organization page is off.</p>
          ) : orgPage.page_on ? (
            <p className="mt-1 text-sm leading-6">
              {orgPage.events_shown === 1 ? "1 event" : `${orgPage.events_shown} events`} shown, and{" "}
              {orgPage.help_active === 1 ? "1 way" : `${orgPage.help_active} ways`} to help anytime
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm leading-6">
                One public page for <span className="[overflow-wrap:anywhere]">{possessive(orgPage.name)}</span> volunteer events and fairs. Off until you turn it on.
              </p>
              <p className="mt-1 text-sm leading-6 text-muted">{WHY_LINE}.</p>
            </>
          )}
          {!orgPage.blocked && (
            <Link
              href="/dashboard/organization"
              className="mt-3 inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand"
            >
              Go to Organization page
            </Link>
          )}
        </Card>
      )}

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Your details</h2>
        <ProfileForm fullName={profile?.full_name ?? ""} phone={formatPhone(profile?.phone)} />
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-semibold">Password</h2>
        <PasswordSection hasPassword={hasPassword} email={user.email} name={profile?.full_name ?? ""} />
      </Card>

      <p className="text-sm leading-6 text-muted">
        Want your account closed? Write to us at {mailto} and we&apos;ll close it and remove your personal details.
      </p>
    </div>
  );
}

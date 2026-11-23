import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { HeaderBar, headerLinkClass } from "@/components/logo";
import { getUser } from "@/lib/auth";
import { brand } from "@/lib/brand";
import { getMyOrganization } from "@/lib/data";
import { dollars, listWords, loadAccountHost, loadAccountPlan } from "@/lib/plan";
import { kindNoun, loadPricingPage, passLabel, passWords, sortKinds, WEBSITE_KINDS, type PricingPage } from "@/lib/pricing";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { requestPricing } from "../../pricing-request-actions";
import { BTN_OUTLINE, CONTACT, LINK, usablePasses, yearly } from "../parts";
import { PreviewBanner } from "../pricing-view";
import { askAccountHost } from "./actions";
import { AskHostButton } from "./ask-host";
import { RequestForm, type Identity, type PlanChoice } from "./request-form";

export const metadata: Metadata = { title: "Ask about a package", robots: { index: false, follow: true } };

/** The page around it. `title` null: the request form shows its own heading (it changes with the choice, and once sent). */
function Frame({ title, banner, back, children }: { title: string | null; banner?: ReactNode; back: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <HeaderBar maxWidth="max-w-5xl">
        <Link href={back} className={`${headerLinkClass} inline-flex min-h-11 items-center`}>
          <span aria-hidden>←&nbsp;</span>
          Back to packages
        </Link>
      </HeaderBar>
      {banner}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {title && <h1 className="mb-6 text-3xl font-medium tracking-tight sm:text-4xl">{title}</h1>}
        {children}
      </main>
    </div>
  );
}

/** The packages and passes on the page, with their prices, for the select. */
function planChoices(page: PricingPage): PlanChoice[] {
  return [
    ...page.packages.map((p) => ({
      code: p.code,
      name: p.name,
      label: `${p.name}: ${p.price_year_cents != null ? yearly(p.price_year_cents) : "ask us"}`,
      group: "Packages" as const,
      teacher: p.teacher_rate && p.teacher_year_cents != null ? yearly(p.teacher_year_cents) : null,
      price: p.price_year_cents != null ? yearly(p.price_year_cents) : null,
      eventTypes: p.event_types,
    })),
    ...usablePasses(page).map((p) => ({
      code: p.code,
      name: passLabel(p.event_type),
      label: `${passLabel(p.event_type)}: ${dollars(p.price_cents)}`,
      group: "Passes" as const,
      teacher: null,
      price: dollars(p.price_cents),
      eventTypes: [p.event_type],
    })),
  ];
}

/**
 * "Ask about [package]" and "Get a [kind] pass" lead here (?plan=…&kinds=…). The Account Host, or someone without
 * an account, gets the request form; anyone else on a team gets "Ask your Account Host".
 */
export default async function AskPage({ searchParams }: { searchParams: Promise<{ plan?: string; kinds?: string; also?: string; start?: string }> }) {
  const supabase = await createClient();
  const load = await loadPricingPage(supabase);
  if (load.status === "hidden") notFound();
  if (load.status === "missing") missing();
  if (load.status === "error") {
    return (
      <Frame title="We can't show prices right now" back="/pricing">
        <p className="max-w-2xl leading-7">
          Try again in a few minutes, or write to us at{" "}
          <a href={CONTACT} className={`${LINK} [overflow-wrap:anywhere]`}>
            {brand.supportEmail}
          </a>{" "}
          with the events you run. A real person replies within a day.
        </p>
      </Frame>
    );
  }
  const page = load.page;
  const banner = page.live ? null : <PreviewBanner />;
  const q = await searchParams;
  const choices = planChoices(page);
  const chosen = choices.find((c) => c.code === q.plan) ?? null;
  const known = new Set(WEBSITE_KINDS.map((k) => k.value));
  const kinds = (q.kinds ?? "").split(",").filter((k) => known.has(k));
  // Back to the page with the same picks (UX F3).
  const back = kinds.length ? `/pricing?kinds=${kinds.join(",")}` : "/pricing";
  // More passes in the same cheaper choice: sent and stored with the request, and named on the form ("You're asking
  // about: …"; consultant r2 F5). Only alongside a first choice, as the database checks.
  const also = chosen
    ? [...new Set((q.also ?? "").split(","))]
        .map((c) => choices.find((x) => x.code === c && x.group === "Passes" && x.code !== chosen.code))
        .filter((c): c is PlanChoice => Boolean(c))
        .map((c) => c.code)
    : [];

  const user = await getUser();
  let identity: Identity | null = null;
  if (user) {
    const [org, { data: me }] = await Promise.all([
      getMyOrganization(),
      supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle<{ full_name: string | null }>(),
    ]);
    const name = me?.full_name?.trim() || "";
    if (org) {
      const host = await loadAccountHost(supabase, org.id, user.id);
      if (!host.isMe) {
        // Someone on the team who isn't the Account Host: only the Account Host chooses a package (2h).
        const plan = await loadAccountPlan(supabase, org.id);
        const first = host.name.split(" ")[0] || host.name;
        // Asking for the package they're already on would be an empty ask: then it's about packages in general.
        const wanted = chosen && chosen.code !== plan?.package ? chosen : null;
        // A pass is "got", a package is "chosen" (Content r2 F1).
        const wantedWords = wanted ? (wanted.group === "Passes" ? `get a ${passWords(page.passes.find((p) => p.code === wanted.code)?.event_type ?? "")}` : `choose ${wanted.name}`) : null;
        // What the account has now that the package asked for leaves out, said before anyone sends (consultant 5).
        const wantedPkg = wanted?.group === "Packages" ? page.packages.find((p) => p.code === wanted.code) : null;
        const lost = wantedPkg && plan ? sortKinds(plan.own_event_types.filter((t) => !wantedPkg.event_types.includes(t))) : [];
        return (
          <Frame title="Ask your Account Host" banner={banner} back={back}>
            <div className="max-w-2xl space-y-4 leading-7">
              <p>
                {host.unknown || !host.email ? "Your Account Host" : `${host.name}, the Account Host for ${org.name},`} is the only one who can choose a package or pass for the account.
                {plan ? ` ${org.name} is on ${plan.package_name} now.` : ""}
              </p>
              {lost.length > 0 && wantedPkg && plan && (
                <p className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3">
                  {wantedPkg.name} doesn&apos;t include {listWords(lost.map(kindNoun))}, which {plan.package_name} has now. Published events stay live, but {org.name} couldn&apos;t
                  publish new ones of {lost.length === 1 ? "that kind" : "those kinds"}.
                </p>
              )}
              {host.email ? (
                <AskHostButton
                  action={askAccountHost}
                  plan={wanted ? wanted.code : ""}
                  first={first}
                  email={host.email}
                  label={wantedWords ? `Ask ${first} to ${wantedWords}` : `Ask ${first} about packages`}
                />
              ) : (
                <p>
                  Ask them, or write to us at{" "}
                  <a href={CONTACT} className={`${LINK} [overflow-wrap:anywhere]`}>
                    {brand.supportEmail}
                  </a>
                  .
                </p>
              )}
              <p>
                <Link href={back} className={BTN_OUTLINE}>
                  Back to packages
                </Link>
              </p>
            </div>
          </Frame>
        );
      }
      // The account's package now: what a choice would leave out (UX r2 2), and whether it's a teacher's own account.
      const plan = await loadAccountPlan(supabase, org.id);
      identity = {
        name: name || user.email,
        email: user.email,
        organization: org.name,
        organizationId: org.id,
        current: plan ? { name: plan.package_name, eventTypes: plan.own_event_types, teacher: plan.package === "free_teacher" } : null,
      };
    } else {
      identity = { name: name || user.email, email: user.email, organization: null, organizationId: null, current: null };
    }
  }

  return (
    <Frame title={null} banner={banner} back={back}>
      <RequestForm action={requestPricing} choices={choices} plan={chosen?.code ?? ""} kinds={kinds} identity={identity} start={q.start === "1"} also={also} back={back} />
    </Frame>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { HeaderBar, headerLinkClass } from "@/components/logo";
import { getUser } from "@/lib/auth";
import { brand } from "@/lib/brand";
import { getMyOrganization } from "@/lib/data";
import { dollars, loadAccountHost, loadAccountPlan } from "@/lib/plan";
import { loadPricingPage, passLabel, WEBSITE_KINDS, type PricingPage } from "@/lib/pricing";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { requestPricing } from "../../pricing-request-actions";
import { CONTACT, LINK, usablePasses, yearly } from "../parts";
import { PreviewBanner } from "../pricing-view";
import { askAccountHost } from "./actions";
import { AskHostButton } from "./ask-host";
import { RequestForm, type Identity, type PlanChoice } from "./request-form";

export const metadata: Metadata = { title: "Ask about a package", robots: { index: false, follow: true } };

function Frame({ title, intro, banner, children }: { title: string; intro?: ReactNode; banner?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <HeaderBar maxWidth="max-w-5xl">
        <Link href="/pricing" className={headerLinkClass}>
          <span aria-hidden>← </span>
          Back to packages
        </Link>
      </HeaderBar>
      {banner}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{title}</h1>
        {intro && <div className="mt-2 max-w-2xl leading-7 text-muted">{intro}</div>}
        <div className="mt-6">{children}</div>
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
    })),
    ...usablePasses(page).map((p) => ({
      code: p.code,
      name: passLabel(p.event_type),
      label: `${passLabel(p.event_type)}: ${dollars(p.price_cents)}`,
      group: "Passes" as const,
      teacher: null,
    })),
  ];
}

/**
 * "Ask about [package]" and "Get a [kind] pass" lead here (?plan=…&kinds=…). The Account Host, or someone without
 * an account, gets the request form; anyone else on a team gets "Ask your Account Host".
 */
export default async function AskPage({ searchParams }: { searchParams: Promise<{ plan?: string; kinds?: string }> }) {
  const supabase = await createClient();
  const load = await loadPricingPage(supabase);
  if (load.status === "hidden") notFound();
  if (load.status === "missing") missing();
  if (load.status === "error") {
    return (
      <Frame title="We can't show prices right now">
        <p className="max-w-2xl leading-7">
          Try again in a few minutes. Or write to us at{" "}
          <a href={CONTACT} className={`${LINK} [overflow-wrap:anywhere]`}>
            {brand.supportEmail}
          </a>{" "}
          with the events you run, and a real person will reply within a day with prices.
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
        const wanted = chosen && chosen.code !== plan?.package ? chosen.name : null;
        return (
          <Frame title="Ask your Account Host" banner={banner}>
            <div className="max-w-2xl space-y-4 leading-7">
              <p>
                {host.unknown || !host.email ? "Your Account Host" : `${host.name}, the Account Host for ${org.name},`} is the only one who can choose a package for the account.
                {plan ? ` ${org.name} is on ${plan.package_name} now.` : ""}
              </p>
              {host.email ? (
                <AskHostButton
                  action={askAccountHost}
                  plan={wanted && chosen ? chosen.code : ""}
                  first={first}
                  email={host.email}
                  label={wanted ? `Ask ${first} to choose ${wanted}` : `Ask ${first} about packages`}
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
              <p className="text-sm text-muted">
                <Link href="/pricing" className={LINK}>
                  Back to packages
                </Link>
              </p>
            </div>
          </Frame>
        );
      }
      identity = { name: name || user.email, email: user.email, organization: org.name, organizationId: org.id };
    } else {
      identity = { name: name || user.email, email: user.email, organization: null, organizationId: null };
    }
  }

  const title = chosen ? (chosen.group === "Passes" ? `Get a ${chosen.name[0].toLowerCase()}${chosen.name.slice(1)}` : `Ask about ${chosen.name}`) : "Ask about a package";
  return (
    <Frame
      title={title}
      banner={banner}
      intro="You can't pay online yet. Tell us about your events, and a real person will reply within a day to set it up with you. Nothing is charged until you agree."
    >
      <RequestForm action={requestPricing} choices={choices} plan={chosen?.code ?? ""} kinds={kinds} identity={identity} />
    </Frame>
  );
}

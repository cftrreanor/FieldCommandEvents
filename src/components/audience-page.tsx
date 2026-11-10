import type { Metadata } from "next";
import Link from "next/link";
import { requestPilot } from "@/app/pilot-actions";
import { PilotForm } from "@/app/pilot-form";
import { FaqList } from "@/components/faq-list";
import { HowItWorks } from "@/components/how-it-works";
import { JumpLink } from "@/components/jump-link";
import { PhoneFrame } from "@/components/phone-frame";
import { HeaderBar, headerLinkClass } from "@/components/logo";
import { SiteFooter } from "@/components/site-footer";
import { AUDIENCES, CONFERENCES_PAGE, MEETINGS_PAGE, STUDENT_PRIVACY_PAGE, type Audience } from "@/lib/audiences";
import { brand } from "@/lib/brand";
import { SITE_URL } from "@/lib/site-url";
import { PILOT_END_LABEL, PILOT_NOTE } from "@/lib/pilot";
import { SUPPORT_POINTS } from "@/lib/support";
import { LineIcon } from "@/components/line-icon";

const CTA = "Join the pilot";

/** The deep-blue "Who sees what" and privacy box. In dark mode it stays navy with white text, like the rest of the page. */
export const infoBox = "bg-brand text-brand-foreground dark:bg-brand-soft dark:text-white";

/** Title, description and address for one event type's page. */
export function audienceMetadata(a: Audience): Metadata {
  return {
    title: a.metaTitle,
    description: a.metaDescription,
    alternates: { canonical: a.path },
    // Setting openGraph replaces the layout's (and the site's share image), so repeat them.
    openGraph: {
      type: "website",
      siteName: brand.name,
      url: a.path,
      title: a.metaTitle,
      description: a.metaDescription,
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: brand.name }],
    },
  };
}

/** One kind of event, for the people who run it, with its own FAQ and the pilot form. */
export function AudiencePage({ audience: a }: { audience: Audience }) {
  const url = `${SITE_URL}${a.path}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: a.metaTitle,
        url,
        description: a.metaDescription,
        about: { "@type": "SoftwareApplication", name: brand.name, url: SITE_URL, applicationCategory: "BusinessApplication", operatingSystem: "Web" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: brand.name, item: SITE_URL },
          { "@type": "ListItem", position: 2, name: a.name, item: url },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: a.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  };
  const others = [...AUDIENCES.filter((o) => o.path !== a.path), CONFERENCES_PAGE, MEETINGS_PAGE];

  return (
    <div className="flex flex-1 flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <HeaderBar maxWidth="max-w-6xl">
        <Link href="/" className={`hidden sm:block ${headerLinkClass}`}>
          All event types
        </Link>
        <Link href="/login" className={headerLinkClass}>
          Sign in
        </Link>
        <JumpLink
          href="#join"
          className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-violet px-3 text-[13px] font-semibold text-header transition hover:brightness-90 sm:px-5 sm:text-sm"
        >
          {CTA}
        </JumpLink>
      </HeaderBar>

      <main className="flex-1">
        <section className="hero-sky text-white">
          <div className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pb-24 sm:pt-20">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white ring-1 ring-white/20">
              <LineIcon name={a.icon} className="size-4" />
              {a.eyebrow}
            </p>
            <h1 className="mt-6 max-w-3xl text-4xl font-medium leading-[0.96] text-balance sm:text-6xl">{a.headline}</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-on-dark-mute">{a.intro}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <JumpLink href="#join" className="rounded-full bg-violet px-6 py-3 font-semibold text-header hover:brightness-90">
                {CTA}
              </JumpLink>
              <JumpLink href="#how" className="rounded-full px-5 py-3 font-medium text-white ring-1 ring-white/50 hover:bg-white/10">
                See how it works
              </JumpLink>
            </div>
            <p className="mt-4 text-sm text-on-dark-mute">{PILOT_NOTE}</p>
          </div>
        </section>

        <section className="border-b border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <h2 className="text-xl font-semibold">What it replaces</h2>
            <ul className="mt-5 grid list-disc gap-x-10 gap-y-3 pl-5 leading-7 text-muted marker:text-muted sm:grid-cols-2">
              {a.replaces.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </section>

        <HowItWorks steps={a.steps} className="" />

        <FeatureSections sections={a.sections} />

        <section className="mx-auto max-w-6xl px-4 pb-16 pt-4 sm:px-6">
          <div className={`rounded-lg p-8 sm:p-12 ${infoBox}`}>
            <h2 className="text-3xl font-normal leading-[1.02] tracking-tight sm:text-4xl">Who sees what</h2>
            <dl className="mt-6 grid max-w-5xl gap-6 leading-7 sm:grid-cols-2">
              {a.privacy.map((p) => (
                <div key={p.title}>
                  <dt className="font-semibold">{p.title}</dt>
                  <dd className="mt-1 opacity-90">{p.body}</dd>
                </div>
              ))}
            </dl>
            <Link href={STUDENT_PRIVACY_PAGE.path} className="mt-6 inline-block font-semibold underline">
              How we handle everyone&apos;s data
            </Link>
          </div>
        </section>

        <SupportSection />

        <section id="faq" tabIndex={-1} className="scroll-mt-20 border-t border-border outline-none">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-3xl font-normal leading-[1.02] tracking-tight sm:text-4xl">Common questions</h2>
            <FaqList faqs={a.faqs} />
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <h2 className="text-xl font-semibold">One account for every event</h2>
            <p className="mt-2 max-w-2xl leading-7 text-muted">
              The same {brand.name} account runs every kind of event, all year.
            </p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {others.map((o) => (
                <li key={o.path}>
                  <Link
                    href={o.path}
                    className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 font-medium hover:border-brand"
                  >
                    <LineIcon name={o.icon} className="size-5 text-brand dark:text-foreground" />
                    <span className="flex-1">{o.name}</span>
                    <span aria-hidden className="text-brand dark:text-foreground">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="join" tabIndex={-1} className="scroll-mt-20 border-t border-border bg-surface outline-none">
          {/* On the page's left edge like every other section; only the text and form stay narrow. */}
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="max-w-3xl">
              <p className="inline-flex rounded-full bg-accent-soft px-3 py-1 text-sm font-medium">Limited spots</p>
              <h2 className="mt-4 text-3xl font-normal leading-[1.02] tracking-tight sm:text-4xl">{CTA}</h2>
              <p className="mt-3 leading-7 text-muted">
                It&apos;s free for organizers through {PILOT_END_LABEL}, when the pilot ends, and we&apos;ll talk with you before
                anything changes. Volunteers, families, and visiting groups never pay.{" "}
                <Link href="/#pilot" className="text-brand underline">
                  See the pilot details
                </Link>
                .
              </p>
              <div className="mt-8">
                <PilotForm action={requestPilot} defaultEventTypes={[a.eventType]} />
              </div>
            </div>
          </div>
        </section>

        <section className="bg-teal-deep text-white">
          <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
            <h2 className="mx-auto max-w-2xl text-3xl font-medium leading-tight sm:text-4xl">Every detail organized. Every organizer supported.</h2>
            <p className="mx-auto mt-4 max-w-xl text-on-dark-mute">Free for organizers through {PILOT_END_LABEL}. Spots are limited.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <JumpLink href="#join" className="inline-flex rounded-full bg-white px-6 py-3 font-semibold text-teal-deep hover:brightness-90">
                {CTA}
              </JumpLink>
              <a
                href={`mailto:${brand.supportEmail}`}
                className="inline-flex rounded-full px-6 py-3 font-semibold text-white ring-1 ring-white/60 hover:bg-white/10"
              >
                Talk with us
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

/** Each section: a title, what it does, its points, and a phone screenshot if it has one. */
export function FeatureSections({ sections }: { sections: Audience["sections"] }) {
  return (
    <div className="mx-auto max-w-6xl divide-y divide-border px-4 sm:px-6">
      {sections.map((s) => (
        <section
          key={s.title}
          // One grid for every section, picture or not, so the words always start in the same place.
          className="grid gap-4 py-12 md:grid-cols-[2fr_3fr_240px] md:gap-10"
        >
          <h2 className="text-2xl font-medium leading-tight tracking-tight">{s.title}</h2>
          <div>
            <p className="leading-7">{s.body}</p>
            {s.points.length > 0 && (
              <ul className="mt-4 space-y-2 leading-7 text-muted">
                {s.points.map((p) => (
                  <li key={p} className="flex gap-2">
                    <span aria-hidden className="text-success">
                      ✓
                    </span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {s.screen && <PhoneFrame src={s.screen.src} alt={s.screen.alt} className="mx-auto mt-2 w-full max-w-[240px] md:mt-0 md:w-[240px] md:self-start" sizes="228px" />}
        </section>
      ))}
    </div>
  );
}

/** How support works, the same on every page that sells the product. */
export function SupportSection() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-3xl font-normal leading-[1.02] tracking-tight sm:text-4xl">How support works</h2>
        <p className="mt-3 max-w-2xl leading-7 text-muted">
          Support starts in the product, so fewer questions come up. When one does, a real person answers it.
        </p>
        <dl className="mt-8 grid gap-8 sm:grid-cols-3">
          {SUPPORT_POINTS.map((p) => (
            <div key={p.title}>
              <dt className="font-semibold">{p.title}</dt>
              <dd className="mt-1 leading-7 text-muted">{p.body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 leading-7">
          <a href={`mailto:${brand.supportEmail}`} className="font-medium text-brand underline">
            {brand.supportEmail}
          </a>
        </p>
      </div>
    </section>
  );
}

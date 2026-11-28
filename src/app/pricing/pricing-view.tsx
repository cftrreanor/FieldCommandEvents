// The public pricing page (docs/design-decisions/2026-11-22-pricing-page.md; approved mock-ups in
// docs/design-reviews/2026-11-22-pricing-mockups/, with the review's fixes and the owner's decisions). Everything
// about a package comes from pricing_page(); words follow docs/brand-voice.md.
import Link from "next/link";
import type { ReactNode } from "react";
import { IconTile } from "@/components/line-icon";
import { HeaderBar, headerLinkClass } from "@/components/logo";
import { PublicMenu } from "@/components/public-menu";
import { SiteFooter } from "@/components/site-footer";
import { brand } from "@/lib/brand";
import { dollars, listWords } from "@/lib/plan";
import { PILOT_END_LABEL } from "@/lib/pilot";
import { FEATURE_HINTS, kindWords, oneEvent, passLabel, passTeamLine, WEBSITE_KINDS, type PricingPage } from "@/lib/pricing";
import { SPONSOR_KINDS, SPONSOR_PROMISE } from "@/lib/sponsors";
import { HeaderCta, PRICES } from "@/components/site-prices";
import {
  AFTER_PILOT_LINE,
  askHref,
  BTN_OUTLINE,
  CellView,
  CheckIcon,
  compareMatrix,
  CONTACT,
  Disclosure,
  freeLine,
  LINK,
  NO_RENEW,
  OneBadge,
  PILOT_LINE,
  sectionTitle,
  TEACHER_WHO,
  usablePasses,
  WIDTH,
} from "./parts";
import { Chooser, OpenFromLink, PhoneCompare, PickedProvider, TryAgain } from "./pricing-client";

const EMAIL = (
  <a href={CONTACT} className={`${LINK} [overflow-wrap:anywhere]`}>
    {brand.supportEmail}
  </a>
);

// Comes with every package: things no package setting turns off (Engineer, kickoff; F6 for the last one).
const EVERY = [
  { title: "Check-in on any phone", body: "Volunteers, bands, groups, and visitors, for each kind of event your package includes" },
  { title: "Badges and printable lists", body: "Name badges and sheets to work from on the day" },
  { title: "Reminders", body: "Emails before the event, so people remember to come" },
  { title: "Your organization page", body: "One link to every public event you're running", notOnFreeTeacher: true },
  { title: "No account needed to sign up or register", body: "Volunteers, families, and directors join from your link, with no ads and no spam" },
];

/** The site header, as the other marketing pages have it, with this page marked. */
function PricingHeader({ afterPilot }: { afterPilot: boolean }) {
  return (
    <HeaderBar maxWidth={WIDTH}>
      <Link href="/" className={`hidden sm:block ${headerLinkClass}`}>
        All kinds of events
      </Link>
      <Link href={PRICES.href} aria-current="page" className={`hidden font-semibold text-white underline underline-offset-8 sm:block ${headerLinkClass}`}>
        {PRICES.label}
      </Link>
      <PublicMenu
        links={[
          { href: "/#organizing", label: "All kinds of events" },
          { href: PRICES.href, label: PRICES.label },
          // The pilot's section is gone from the home page once it ends.
          ...(afterPilot ? [] : [{ href: "/#pilot", label: "Pilot details" }]),
        ]}
      />
      <Link href="/login" className={headerLinkClass}>
        Sign in
      </Link>
      <HeaderCta afterPilot={afterPilot} live joinHref="/#join" />
    </HeaderBar>
  );
}

function Hero({ afterPilot, button }: { afterPilot: boolean; button: boolean }) {
  return (
    <section id="top" className="hero-sky text-white">
      <div className={`mx-auto ${WIDTH} px-4 pt-14 pb-16 sm:px-6 sm:pt-16`}>
        <h1 className="max-w-3xl text-4xl font-medium leading-[0.96] sm:text-6xl">Packages and prices</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-pretty text-on-dark-mute">{afterPilot ? AFTER_PILOT_LINE : PILOT_LINE}</p>
        <p className="mt-3 max-w-2xl text-on-dark-mute">{NO_RENEW}</p>
        {/* One filled pill on the page (the header's); this one is outlined (UI F3). */}
        {button && (
          <a href="#running" className="mt-8 inline-flex min-h-11 items-center rounded-full px-6 font-semibold text-white ring-1 ring-white/60 hover:bg-white/10">
            Find your package
          </a>
        )}
      </div>
    </section>
  );
}

/** "Preview, not public": an admin looking at the page before it's switched on, with the way to the switch (UX F8). */
export function PreviewBanner({ children }: { children?: ReactNode }) {
  return (
    <div role="note" className="border-b border-warning/40 bg-warning-soft">
      <div className={`mx-auto ${WIDTH} px-4 py-3 text-sm leading-6 sm:px-6`}>
        <span className="font-semibold">Preview, not public. </span>
        Visitors can&apos;t see this page until it&apos;s switched on in{" "}
        <Link href="/admin/packages" className={LINK}>
          Admin, Packages
        </Link>
        . {children}
      </div>
    </div>
  );
}

function faqs(page: PricingPage, afterPilot: boolean) {
  const oneAtATime = [
    ...page.free.filter((f) => f.code === "free" && f.one_at_a_time.length).map((f) => f.name),
    ...page.packages.filter((p) => p.one_at_a_time.some((k) => p.event_types.includes(k))).map((p) => p.name),
  ];
  const teacher = page.packages.some((p) => p.teacher_rate && p.teacher_year_cents != null);
  return [
    {
      q: "What does “one at a time” mean?",
      a: `${FEATURE_HINTS.oneAtATime}. When the published one ends, you can publish the next.${oneAtATime.length ? ` It applies to some kinds of event on ${listWords(oneAtATime)}.` : ""}`,
    },
    afterPilot
      ? {
          q: "I was in the free pilot. What now?",
          a: "Events you've published stay live, and your team stays as it is. New events publish under the Free package until you choose a package. Nothing is charged unless you choose one.",
        }
      : {
          q: `What happens after ${PILOT_END_LABEL}?`,
          a: "The free pilot is over. Events you've published stay live, and your team stays as it is. Until you choose a package, new events publish under the Free package. Nothing is charged unless you choose a package.",
        },
    ...(teacher
      ? [
          {
            id: "teacher-rate",
            q: "Who gets the teacher rate?",
            a: `${TEACHER_WHO} Check “I’m a classroom teacher” when you ask, and a real person checks it.`,
          },
        ]
      : []),
    {
      q: "Can our school pay with a purchase order?",
      a: "Yes. Tell us when you ask about a package. We'll send a quote and our W-9 first if you need them, then an invoice due within 30 days. Your package starts when we send it. Packages are yearly and never renew on their own.",
    },
    {
      q: "What happens when we change packages?",
      a: "Nothing you already have is taken away. Published events stay live, and nobody is removed from your team. A smaller package only limits what you publish or who you invite next. Ask about the new package, and a real person sets up the change with you.",
    },
  ];
}

/** The page, or "We can't show prices right now" when `page` is null. */
export function PricingView({ page, afterPilot, banner }: { page: PricingPage | null; afterPilot: boolean; banner?: ReactNode }) {
  if (!page || page.packages.length === 0) {
    // No dead buttons: the hero's button and the cards are gone, and the email is the way forward (Marketing F11).
    return (
      <div className="flex flex-1 flex-col">
        <PricingHeader afterPilot={afterPilot} />
        {banner}
        <main className="flex-1">
          <Hero afterPilot={afterPilot} button={false} />
          <section className={`mx-auto ${WIDTH} px-4 py-16 sm:px-6`}>
            <h2 className={sectionTitle}>We can&apos;t show prices right now</h2>
            <p className="mt-3 max-w-2xl leading-7">
              Try again in a few minutes, or ask us about prices. A real person replies within a day. You can also write to us at {EMAIL}.
            </p>
            {/* Two ways forward, as buttons (UI 8, consultant 13). The request form works without the prices. */}
            <div className="mt-6 flex flex-wrap gap-3">
              <TryAgain className={BTN_OUTLINE} />
              <Link href={askHref()} className={BTN_OUTLINE}>
                Ask about prices
              </Link>
            </div>
          </section>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const m = compareMatrix(page);
  const passes = usablePasses(page);
  // Passes work with Free: what a pass doesn't change, from Free's data (owner decision, follow-up check 1).
  const freePkg = page.free.find((f) => f.code === "free");
  const passTeam = freePkg ? passTeamLine(freePkg, page.packages) : null;
  const freeTeacher = page.free.find((f) => f.code === "free_teacher");
  const sponsorWords = listWords(SPONSOR_KINDS.map(kindWords));
  const freeLines = page.free;

  return (
    <div className="flex flex-1 flex-col">
      <OpenFromLink />
      <PricingHeader afterPilot={afterPilot} />
      {banner}
      <main className="flex-1">
        <Hero afterPilot={afterPilot} button />
        <PickedProvider>
          {/* What are you running? and the cards */}
          <section id="running" aria-labelledby="running-title" className="scroll-mt-4 border-b border-border bg-surface">
            <div className={`mx-auto ${WIDTH} px-4 py-14 sm:px-6`}>
              <h2 id="running-title" className={sectionTitle}>
                What are you running?
              </h2>
              <Chooser page={page} headingId="running-title" />
            </div>
          </section>

          {/* Every package includes */}
          <section className={`mx-auto ${WIDTH} px-4 py-14 sm:px-6`}>
            <h2 className={sectionTitle}>Every package includes</h2>
            <ul className="mt-8 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              {EVERY.map((e) => (
                <li key={e.title} className="flex gap-3">
                  <CheckIcon className="mt-0.5 size-5 text-success" />
                  <span className="min-w-0">
                    <span className="block font-semibold">{e.title}</span>
                    <span className="block leading-7 text-muted">{e.body}</span>
                    {/* Free Teacher is one of the free options, and has no organization page (Content r2 F13). */}
                    {"notOnFreeTeacher" in e && freeTeacher && <span className="block text-sm text-muted">Not on {freeTeacher.name}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Free options: their own short section (UX F7), never cards, never a price */}
          {freeLines.length > 0 && (
            <section id="free" aria-labelledby="free-title" className="scroll-mt-4 border-t border-border">
              <div className={`mx-auto ${WIDTH} px-4 py-14 sm:px-6`}>
                <h2 id="free-title" className={sectionTitle}>
                  Free options
                </h2>
                <ul className="mt-6 max-w-3xl space-y-3 leading-7">
                  {freeLines.map((f) => (
                    <li key={f.code}>
                      <span className="font-semibold">{f.name}: </span>
                      {freeLine(f)}.
                      {f.code === "free_teacher" && (
                        <>
                          {" "}
                          For classroom teachers, with no organization page.{" "}
                          <Link href="/parent-teacher-conferences" className={LINK}>
                            More for teachers
                          </Link>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {/* Passes */}
          {passes.length > 0 && (
            <section id="passes" aria-labelledby="passes-title" className="scroll-mt-4 border-y border-border bg-surface">
              <div className={`mx-auto ${WIDTH} px-4 py-14 sm:px-6`}>
                <h2 id="passes-title" className={sectionTitle}>
                  Running just one event?
                </h2>
                <p className="mt-3 max-w-2xl leading-7 text-muted">
                  A pass publishes one event of a kind your package doesn&apos;t include. Works with Free, no package needed. Use it within 12 months.
                </p>
                {passTeam && <p className="mt-2 max-w-2xl leading-7 text-muted">{passTeam}</p>}
                {/* Two or four across, so four passes never leave one alone on a row (UI 12). */}
                <ul className={`mt-8 grid gap-3 sm:grid-cols-2 ${passes.length % 3 === 0 ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
                  {passes.map((p) => {
                    const icon = WEBSITE_KINDS.find((k) => k.value === p.event_type)?.icon ?? "sparkle";
                    return (
                      <li key={p.code} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
                        <div className="flex items-start gap-3">
                          <IconTile name={icon} />
                          <span className="min-w-0 flex-1">
                            <span id={`pass-${p.code}`} className="block font-semibold">
                              {passLabel(p.event_type)}
                            </span>
                            <span className="block text-lg font-semibold tabular-nums">
                              {dollars(p.price_cents)} <span className="text-sm font-normal text-muted">for {oneEvent(p.event_type)}</span>
                            </span>
                          </span>
                        </div>
                        <a href={askHref(p.code, [p.event_type])} aria-describedby={`pass-${p.code}`} className={`${BTN_OUTLINE} mt-auto`}>
                          Get this pass
                        </a>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-4 text-muted">{NO_RENEW}</p>
              </div>
            </section>
          )}

          {/* Compare every package */}
          <section id="compare" aria-labelledby="compare-title" className={`mx-auto w-full scroll-mt-4 ${WIDTH} px-4 py-14 sm:px-6`}>
            <h2 id="compare-title" className={sectionTitle}>
              Compare every package
            </h2>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
              <OneBadge /> <span className="font-semibold text-foreground">One at a time:</span> one published event of that kind, with as many drafts as you like
            </p>
            <div className="mt-6 hidden md:block">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Every package compared: price, kinds of event, and team</caption>
                <thead>
                  {/* The package names stay in view while the rows scroll by (UI 3). */}
                  <tr>
                    <td className="sticky top-0 z-10 bg-background py-3 pr-3 shadow-[inset_0_-2px_0_var(--field-border)]" />
                    {m.cols.map((c) => (
                      <th
                        key={c.code}
                        scope="col"
                        className="sticky top-0 z-10 bg-background px-2 py-3 shadow-[inset_0_-2px_0_var(--field-border)] text-left align-bottom text-base font-semibold"
                      >
                        {c.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                {m.groups.map((g) => (
                  <tbody key={g.group}>
                    <tr>
                      <th scope="colgroup" colSpan={m.cols.length + 1} className="bg-surface px-2 pt-5 pb-1.5 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                        {g.group}
                      </th>
                    </tr>
                    {g.rows.map((r) => (
                      <tr key={r.label} className="border-b border-border align-top">
                        <th scope="row" className="max-w-64 py-2.5 pr-3 text-left font-semibold">
                          {r.label}
                          {r.hint && <span className="mt-0.5 block text-xs font-normal text-muted">{r.hint}</span>}
                        </th>
                        {m.cols.map((c) => (
                          <td key={c.code} className="px-2 py-2.5">
                            <CellView cell={r.cells[c.code]} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
            <div className="mt-6">
              <PhoneCompare m={m} packages={page.packages} />
            </div>
          </section>
        </PickedProvider>

        {/* Sponsors add-on */}
        <section className={`mx-auto ${WIDTH} px-4 pb-14 sm:px-6`}>
          <div className="rounded-lg border border-border bg-surface p-5 sm:p-8">
            <p className="text-sm font-semibold tracking-wide text-muted uppercase">Add-on</p>
            <h2 className="mt-1 text-2xl font-semibold">Sponsors</h2>
            <p className="mt-2 max-w-3xl leading-7">Thank your sponsors on the public pages of your {sponsorWords}. Ask us for a price.</p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{SPONSOR_PROMISE}</p>
            <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1">
              <a href={`${CONTACT}?subject=${encodeURIComponent("The Sponsors add-on")}`} className={`${LINK} inline-flex min-h-11 items-center`}>
                Ask us about Sponsors
              </a>
              <span className="inline-flex min-h-11 min-w-0 items-center text-muted [overflow-wrap:anywhere]">{brand.supportEmail}</span>
            </p>
          </div>
        </section>

        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-4 border-t border-border">
          <div className={`mx-auto ${WIDTH} px-4 py-14 sm:px-6`}>
            <h2 id="faq-title" className={sectionTitle}>
              Questions about packages
            </h2>
            <div className="mt-10 max-w-3xl divide-y divide-border border-y border-border">
              {faqs(page, afterPilot).map((f) => (
                <Disclosure key={f.q} id={"id" in f ? f.id : undefined} q={f.q}>
                  <p>{f.a}</p>
                </Disclosure>
              ))}
            </div>
          </div>
        </section>

        {/* Closing band */}
        <section className="bg-teal-deep text-white">
          <div className={`mx-auto ${WIDTH} px-4 py-16 text-center sm:px-6 sm:py-20`}>
            <h2 className="mx-auto max-w-2xl text-3xl font-medium leading-tight sm:text-4xl">{brand.tagline}</h2>
            <p className="mx-auto mt-4 max-w-xl text-on-dark-mute">Not sure which package fits? Tell us what you run, and a real person will reply within a day.</p>
            <div className="mt-8 flex flex-col items-center gap-2">
              <Link href={askHref()} className="inline-flex min-h-11 items-center rounded-full bg-white px-6 font-semibold text-teal-deep hover:brightness-90">
                Talk with us
              </Link>
              <span className="max-w-full text-sm text-on-dark-mute [overflow-wrap:anywhere]">{brand.supportEmail}</span>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

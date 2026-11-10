import type { Metadata } from "next";
import Link from "next/link";
import { infoBox } from "@/components/audience-page";
import { FaqList } from "@/components/faq-list";
import { JumpLink } from "@/components/jump-link";
import { PhoneFrame } from "@/components/phone-frame";
import { HeaderBar, headerLinkClass } from "@/components/logo";
import { PublicBanners } from "@/components/site-banner";
import { publicBanners } from "@/lib/site-banners";
import { brand } from "@/lib/brand";
import { SUPPORT_POINTS as support } from "@/lib/support";
import { SITE_URL } from "@/lib/site-url";
import { ADMINISTRATORS_PAGE, audiences, CONFERENCES_PAGE, MEETINGS_PAGE, STUDENT_PRIVACY_PAGE } from "@/lib/audiences";
import { SiteFooter } from "@/components/site-footer";
import { requestPilot } from "./pilot-actions";
import { PilotForm } from "./pilot-form";
import { PILOT_END_LABEL, PILOT_NOTE } from "@/lib/pilot";
import { IconTile } from "@/components/line-icon";

// Copy follows docs/brand-voice.md. Each event card links to its own page,
// and those pages carry the How it works steps.

const TAGLINE = "Every detail organized. Every organizer supported.";
const CONTACT = `mailto:${brand.supportEmail}`;

// The kinds of event (src/lib/event-types.ts), as the page's main pitch.
const kinds = [
  {
    icon: "volunteer" as const,
    title: "Volunteers and sign-ups",
    summary: "Sign-up sheets, potlucks, cleanups, and volunteer shifts",
    href: audiences.volunteers.path,
  },
  {
    icon: CONFERENCES_PAGE.icon,
    title: "Parent-teacher conferences",
    summary: "Fall and spring conferences, in person or on video",
    href: CONFERENCES_PAGE.path,
  },
  {
    icon: "band" as const,
    title: "Band contests",
    summary: "Marching invitationals, jazz festivals, and solo & ensemble",
    href: audiences.bands.path,
  },
  {
    icon: "group" as const,
    title: "Choir and group festivals",
    summary: "Choir and orchestra festivals, theater, and UIL academics",
    href: audiences.groups.path,
  },
  {
    icon: "fair" as const,
    title: "School fairs and fundraisers",
    summary: "Fall festivals, carnivals, and fundraisers",
    href: audiences.fairs.path,
  },
  {
    icon: "school" as const,
    title: "Visitor registration and check-in",
    summary: "Open houses, family lunches, performances, and award days",
    href: audiences.parents.path,
  },
  {
    icon: MEETINGS_PAGE.icon,
    title: "Meetings",
    summary: "Office hours, advising, and appointments",
    href: MEETINGS_PAGE.path,
  },
  {
    icon: ADMINISTRATORS_PAGE.icon,
    title: "For administrators",
    summary: "Contests, fairs, conferences, and visits across your campus",
    href: ADMINISTRATORS_PAGE.path,
    link: "More for administrators",
  },
];

// Beside the headline: the product as spectators, volunteers, and the front office see it.
const heroScreens = [
  { src: "/screens/band-live-order.webp", alt: "A band contest's public page on a phone, with the live performance order." },
  { src: "/screens/volunteer-shift-picker.webp", alt: "Volunteer sign-up on a phone: sign-ups, shifts, and how many spots are left." },
  { src: "/screens/parent-door-search.webp", alt: "Door check-in on a phone for a school visit: a search, the family's children, and a Check in button for each adult." },
];


const different = [
  { title: "Organized", body: "Sign-ups, schedules, and check-in are all in one place." },
  { title: "Supported", body: "Setup walks you through each step, and real people, not bots, answer the rest." },
  { title: "Respectful", body: "Families, volunteers, and visitors sign up without an account and never get ads or spam from us." },
];

// "Supported" is a system, not a person on call: no phone numbers or
// "always available" language, and only the response time we keep (lib/support.ts).


// The principles behind every event's data (the database enforces each one).
const privacy = [
  {
    title: "Only what the event needs",
    body: "We ask for the least information that gets the job done: headcounts where names aren't needed, first name and last initial for volunteers under 18, and no accounts for families or spectators.",
  },
  {
    title: "Only who needs it",
    body: "Organizers, leads, and volunteers each see what their role requires. Volunteer Leads see volunteers' contact details, Coordinators see them only on event day, and children's names stay with your event team.",
  },
  {
    title: "Gone when it's over",
    body: "Personal details are deleted on a set schedule after each event, from 10 days for volunteers' details to 2 years for directors' contact details. A guardian's OK for each volunteer under 18 is kept as a record. Our privacy page lists each one.",
  },
  {
    title: "No ads, no spam",
    body: `Emails go out only for your event, and there are no ads anywhere in ${brand.name}.`,
  },
];

// Plain answers to what organizers ask (and search for); also given to search
// engines and AI assistants as an FAQ (see jsonLd below).
const faqs = [
  {
    q: "Who is it for?",
    a: "Anyone running an event with sign-ups, registration, or check-in: PTO and PTA leaders, booster clubs, band and choir directors, teachers and school offices, churches and other congregations, clubs, nonprofits, and community groups.",
  },
  {
    q: "Can congregations, clubs, and community groups use it?",
    a: "Yes. Any group can run sign-up sheets, volunteer events, and meetings. Organizers sign in to run their events. Volunteers, families, and guests join from the organizer's link and are never asked to make an account or shown ads.",
  },
  {
    q: "Can I use this instead of an online form for parent check-in?",
    a: "Yes. For a school visitor event, parents register ahead with each child's name, teacher, and grade, and they get a reminder to bring a photo ID. Your front office checks every adult in at the door on any phone. Only your event team sees children's details, and they're deleted 30 days after the event.",
  },
  {
    q: "How do band and choir directors register for our contest or festival?",
    a: "Share one registration link. Directors fill in the form, with no account to set up first, and confirm with a code we email them. Returning directors reuse their saved details. They see their performance time or room schedule as soon as you publish it, and can withdraw from their own page if plans change.",
  },
  {
    q: "How do volunteers sign up and get checked in?",
    a: "Share a link or QR code. Volunteers pick a shift on their phone without making an account, and they get a confirmation and a calendar invite. They're checked in at the desk with one tap, and walk-ups can fill open spots on the day.",
  },
  {
    q: "Can it run a school fair or PTO fundraiser?",
    a: "Yes. Organize booths and community partners by zone, check partners in as they arrive, staff volunteer sign-ups with Coordinators, and share a public page of everything at the event that thanks your partners.",
  },
  {
    q: "Do volunteers, parents, or visiting directors have to pay or download an app?",
    a: `No app, and no platform fee. Only the school or organization running the event pays to use ${brand.name}. Everyone they invite (volunteers, parents and families, and visiting band and choir directors) uses ${brand.name} at no charge, right in their phone's web browser. Any registration fee or ticket price the event itself charges is set by the organizer and is separate from ${brand.name}.`,
  },
  {
    q: "How is student and family information handled?",
    a: "Band contests collect headcounts, not student names. Children's names at school visitor events and conferences are deleted 30 days after the event, and volunteers' phone numbers 10 days after. Conference bookings are seen only by the teacher, and Coordinators see volunteers' phone numbers only on event day. No ads, no spam, and emails used only for your event. Our Student data privacy page has the full details.",
  },
];

const pilot = [
  {
    title: "What you get",
    items: [
      `Every feature, free through ${PILOT_END_LABEL}, when the pilot ends`,
      "Unlimited events, volunteers, and registrations",
      "Help setting up your first event",
      "Direct support from the people building it",
    ],
  },
  {
    title: "What we ask",
    items: [
      "Run at least one real event with it",
      "A short call before and after your event",
      "Tell us what's clunky, so we can fix it",
    ],
  },
  {
    title: "After the pilot",
    items: [
      "Nothing renews or charges automatically",
      "Organizers pay to use it after the pilot, and we'll talk with you about pricing before anything changes",
      "No platform fee for anyone you invite: volunteers, families, and visiting groups use it free",
    ],
  },
];

const JOIN = "#join" as const;
// Every button to the form says the same thing.
const CTA = "Join the pilot";

export const metadata: Metadata = { alternates: { canonical: "/" } };

// What search engines and AI assistants read about the product.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: brand.name,
      url: SITE_URL,
      logo: `${SITE_URL}/logo.png`,
      email: brand.supportEmail,
      slogan: TAGLINE,
      address: { "@type": "PostalAddress", addressLocality: brand.city, addressRegion: brand.regionCode, addressCountry: "US" },
    },
    {
      "@type": "SoftwareApplication",
      name: brand.name,
      url: SITE_URL,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Event organizing for schools, clubs, congregations, and community groups: sign-up sheets, volunteer events, band contests, choir and group festivals, school fairs and fundraisers, school visitor days, meetings, and parent-teacher conferences, with registration, sign-ups, and check-in on any phone.",
      audience: {
        "@type": "Audience",
        audienceType:
          "PTO and PTA leaders, booster clubs, band and choir directors, teachers, school offices, administrators, congregations, clubs, nonprofits, and community groups",
      },
      offers: {
        "@type": "Offer",
        description:
          `Free for organizers during the pilot, which ends ${PILOT_END_LABEL}. After the pilot, organizers pay to use ${brand.name}. No fee for volunteers, families, or visiting groups.`,
      },
    },
    {
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ],
};

// Company banners for visitors (admin → Banners) refresh at least once a minute.
export const revalidate = 60;

/** Public banners, or none if the database isn't reachable (e.g. while building). */
async function homeBanners() {
  try {
    return await publicBanners();
  } catch {
    return [];
  }
}

const sectionTitle = "text-3xl font-normal leading-[1.02] tracking-tight sm:text-5xl";

export default async function Home() {
  const banners = await homeBanners();
  return (
    <div className="flex flex-1 flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <HeaderBar maxWidth="max-w-6xl">
        <JumpLink href="#organizing" className={`hidden sm:block ${headerLinkClass}`}>
          Events
        </JumpLink>
        <JumpLink href="#faq" className={`hidden md:block ${headerLinkClass}`}>
          FAQ
        </JumpLink>
        <JumpLink href="#pilot" className={`hidden sm:block ${headerLinkClass}`}>
          Pilot details
        </JumpLink>
        <Link href="/login" className={headerLinkClass}>
          Sign in
        </Link>
        <JumpLink
          href={JOIN}
          className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-violet px-3 text-[13px] font-semibold sm:px-5 sm:text-sm text-header transition hover:brightness-90"
        >
          {CTA}
        </JumpLink>
      </HeaderBar>

      <main className="flex-1">
        <PublicBanners banners={banners} />

        {/* 1. Hero */}
        <section className={`hero-sky text-white ${banners.length ? "mt-4" : ""}`}>
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 sm:pb-24 sm:pt-20 lg:grid-cols-[1fr_auto]">
            <div>
              <h1 className="max-w-3xl text-4xl font-medium leading-[0.96] sm:text-6xl">Events without the clipboards</h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-balance text-on-dark-mute">
                Volunteer and meeting <span className="whitespace-nowrap">sign-ups</span>, contest registration, and community events, on public links, with no account needed <span className="whitespace-nowrap">to sign up</span>
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <JumpLink href={JOIN} className="rounded-full bg-violet px-6 py-3 font-semibold text-header hover:brightness-90">
                  {CTA}
                </JumpLink>
              </div>
              <p className="mt-4 text-sm text-on-dark-mute">{PILOT_NOTE}</p>
            </div>
            {/* The product, on the phones people use it on: spectators, volunteers, and the front door. */}
            <div className="flex items-start justify-center">
              {heroScreens.map((p, i) => (
                <PhoneFrame
                  key={p.src}
                  src={p.src}
                  alt={p.alt}
                  hero={i === 1 ? "main" : "eager"}
                  // Their real widths: the middle one 132–176 px, the side ones 113–144 px.
                  sizes={i === 1 ? "(min-width: 1024px) 176px, (min-width: 640px) 160px, 34vw" : "(min-width: 1024px) 144px, (min-width: 640px) 128px, 28vw"}
                  className={
                    i === 1
                      ? "relative z-10 -mx-3 w-[38%] max-w-[200px] sm:w-44 lg:w-48"
                      : "mt-8 w-[33%] max-w-[170px] opacity-95 sm:w-36 lg:w-40"
                  }
                />
              ))}
            </div>
          </div>
        </section>

        {/* 2. One card per kind of event, each linking to its own page */}
        <section id="organizing" tabIndex={-1} className="scroll-mt-20 border-b border-border bg-surface outline-none">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className={sectionTitle}>What are you organizing?</h2>
            <p className="mt-3 max-w-2xl leading-7 text-muted">
              Choose your kind of event, and {brand.name} gives you the tools it needs.
            </p>
            {/* The same card at every width, all in view: no sideways row to swipe through. On phones the icon sits
                beside the name so the list stays short. "For administrators" is a reader, not a kind of event, so
                its card is tinted to set it apart. */}
            <ul className="mt-8 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
              {kinds.map((k) => {
                const forReader = "link" in k;
                return (
                  <li key={k.title}>
                    <Link
                      href={k.href}
                      className={`group grid h-full grid-cols-[auto_1fr] gap-x-3 rounded-lg border p-4 transition hover:border-brand sm:flex sm:flex-col sm:p-5 ${
                        forReader ? "border-brand/30 bg-accent-soft" : "border-border bg-background"
                      }`}
                    >
                      <IconTile name={k.icon} />
                      <span className="min-w-0 sm:contents">
                        <span className="block font-semibold sm:mt-2">{k.title}</span>
                        <span className="mt-1 block text-sm leading-6 text-muted">{k.summary}</span>
                        <span className="mt-2 block text-sm font-medium text-brand group-hover:underline sm:mt-auto sm:pt-3">
                          {forReader ? k.link : `More about ${k.title.toLowerCase()}`}
                          <span aria-hidden> →</span>
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* 3. Why it's different */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className={sectionTitle}>Built for the people running events</h2>
          <dl className="mt-10 grid gap-8 sm:grid-cols-3">
            {different.map((d) => (
              <div key={d.title}>
                <dt className="text-xl font-semibold">{d.title}</dt>
                <dd className="mt-1 leading-7 text-muted">{d.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* 4. How support works */}
        <section id="support" className="scroll-mt-20 border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className={sectionTitle}>How support works</h2>
            <p className="mt-3 max-w-2xl leading-7 text-muted">
              Support starts in the product, so fewer questions come up. When one does, a real person answers it.
            </p>
            <dl className="mt-10 grid gap-8 sm:grid-cols-3">
              {support.map((s) => (
                <div key={s.title}>
                  <dt className="font-semibold">{s.title}</dt>
                  <dd className="mt-1 leading-7 text-muted">{s.body}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-8 leading-7">
              <a href={CONTACT} className="font-medium text-brand underline">
                {brand.supportEmail}
              </a>
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <div className={`rounded-lg p-8 sm:p-12 ${infoBox}`}>
            <h2 className={sectionTitle}>Who sees what</h2>
            <dl className="mt-6 grid max-w-5xl gap-6 leading-7 sm:grid-cols-2">
              {privacy.map((p) => (
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

        <section id="faq" className="scroll-mt-20 border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className={sectionTitle}>Questions organizers ask</h2>
            <FaqList faqs={faqs} />
          </div>
        </section>

        {/* The pilot, and the form every "Join the pilot" button leads to */}
        <section id="pilot" tabIndex={-1} className="scroll-mt-20 border-t border-border bg-surface outline-none">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <p className="inline-flex rounded-full bg-accent-soft px-3 py-1 text-sm font-medium">Limited spots</p>
            <h2 className={`mt-4 ${sectionTitle}`}>Join the pilot</h2>
            <p className="mt-3 max-w-2xl leading-7 text-muted">
              We&apos;re working closely with a small group of organizers, from schools and booster clubs to community groups. It&apos;s free through {PILOT_END_LABEL},
              when the pilot ends. We keep the group small so we can support every organizer.
            </p>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {pilot.map((col) => (
                <div key={col.title} className="rounded-lg border border-border bg-background p-6">
                  <h3 className="font-semibold">{col.title}</h3>
                  <ul className="mt-3 space-y-2 leading-7 text-muted">
                    {col.items.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span aria-hidden className="text-success">
                          ✓
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div id="join" tabIndex={-1} className="mt-12 max-w-3xl scroll-mt-20 outline-none">
              <h3 className="text-xl font-semibold">Tell us about your events</h3>
              <p className="mt-1 text-muted">It takes a minute, and a person on our team will reply by email.</p>
              <div className="mt-6">
                <PilotForm action={requestPilot} />
              </div>
            </div>
          </div>
        </section>

        {/* 5. Closing call to action */}
        <section className="bg-teal-deep text-white">
          <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-24">
            <h2 className="mx-auto max-w-2xl text-3xl font-medium leading-tight sm:text-4xl">{TAGLINE}</h2>
            <p className="mx-auto mt-4 max-w-xl text-on-dark-mute">Free for organizers through {PILOT_END_LABEL}. Spots are limited.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <JumpLink href={JOIN} className="inline-flex rounded-full bg-white px-6 py-3 font-semibold text-teal-deep hover:brightness-90">
                {CTA}
              </JumpLink>
              <a
                href={CONTACT}
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

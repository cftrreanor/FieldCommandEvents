import type { Metadata } from "next";
import Link from "next/link";
import { requestPilot } from "@/app/pilot-actions";
import { PilotForm } from "@/app/pilot-form";
import { FeatureSections, infoBox, SupportSection } from "@/components/audience-page";
import { FaqList } from "@/components/faq-list";
import { HowItWorks, type HowStep } from "@/components/how-it-works";
import { JumpLink } from "@/components/jump-link";
import { HeaderBar, headerLinkClass } from "@/components/logo";
import { SiteFooter } from "@/components/site-footer";
import { ADMINISTRATORS_PAGE, AUDIENCES, CONFERENCES_PAGE, STUDENT_PRIVACY_PAGE, type Audience } from "@/lib/audiences";
import { brand } from "@/lib/brand";
import { PILOT_END_LABEL } from "@/lib/pilot";
import { LineIcon } from "@/components/line-icon";

// For principals and district staff. Brand voice: reassuring and concrete,
// about reliability, support, and less strain on staff; "facilitator" when
// naming the role (docs/brand-voice.md). Every claim must match the product.

const CTA = "Join the pilot";

export const metadata: Metadata = {
  title: "School Event Software for Principals and District Administrators",
  description:
    "One place for every school event: contests, festivals, fairs, volunteer events, visitor days, and parent-teacher conferences. Less strain on staff, clear roles, and families' details deleted on a schedule.",
  alternates: { canonical: ADMINISTRATORS_PAGE.path },
};

const replaces = [
  "A different sign-up tool, form, or spreadsheet for every event",
  "Front office staff answering the same questions by phone and email",
  "Paper sign-in sheets with families' details left in a binder",
  "Clipboards and paper rosters at the door, desk, and gate",
];

const steps: HowStep[] = [
  {
    title: "Your facilitators set up their event",
    body: "Each kind of event has its own setup, one step at a time, so a new facilitator isn't starting from a blank page.",
    screen: "/screens/pick-event-type-blue.webp",
    alt: "Starting a new event: choosing the kind of event, such as a band contest, volunteer event, or school visitor day.",
  },
  {
    title: "Families and volunteers sign up on their own",
    body: "Share one link. Confirmations, calendar invites, and day-before reminders go out without anyone on staff sending them.",
    screen: "/screens/volunteer-signup-blue.webp",
    alt: "A volunteer picking a shift on the event's sign-up page.",
  },
  {
    title: "Event day runs from any phone",
    body: "Your team checks people in at the door or desk on their own phones, with no app to install.",
    screen: "/screens/parent-door-checkin.webp",
    alt: "Door check-in: a family's children and adults, with a Check in button for each adult.",
  },
];

const sections: Audience["sections"] = [
  {
    title: "Every school event in one place",
    body: `The same ${brand.name} account runs every kind of event on your campus, all year, so families see one familiar sign-up page.`,
    points: [
      "Band contests and choir, orchestra, and theater festivals",
      "School fairs, carnivals, and PTO fundraisers",
      "Volunteer events like concessions, field day, and book fairs",
      "Family lunches, open houses, and other visitor days, with door check-in",
      "Parent-teacher conferences, with a free account for each teacher",
      "Your logo and colors on every public event page and printed badge",
    ],
    screen: {
      src: "/screens/fair-volunteer-badges.webp",
      alt: "A printable volunteer name badge with the school's logo, the volunteer's name and shift, and a QR code for event information.",
    },
  },
  {
    title: "Less strain on your staff",
    body: "The routine work of an event happens on its own, so your front office and teachers get their time back.",
    points: [
      "Families and volunteers sign up without an account or an app",
      "Confirmations, calendar invites, and reminders are sent for you",
      "Changes reach the people affected by email, like a new performance time",
      "Emergency messages can also be emailed right away to the groups you choose",
      "Start from the lists you already have: import families, volunteers, or visiting directors from a spreadsheet",
    ],
  },
  {
    title: "Safer events on campus",
    body: "The tools that help keep people safe are built into each event, not added on.",
    points: [
      "Parents are reminded to bring a photo ID, and your door team finds any family by an adult's or child's name",
      "Volunteers wear printable name badges with your logo and a QR code for event information",
      "Sign-ups like parking can be adults only, and volunteers under 18 are stored by first name and last initial, with a parent's contact details",
      "Coordinators see volunteers' phone numbers only on event day",
    ],
    screen: {
      src: "/screens/parent-door-search.webp",
      alt: "Door check-in on a phone: a search for a family, how many adults are checked in, and a Check in button for each adult once their photo ID is checked.",
    },
  },
  {
    title: "Accountability you can see",
    body: "When something changes, your team can see who did it and when.",
    points: [
      "Every setup step shows who last saved it and when",
      "Every check-in tap records who made it and when, and can be undone",
      "Each event's team is invited by name, so there are no shared logins",
    ],
    screen: {
      src: "/screens/group-room-taps.webp",
      alt: "A check-in list on a phone on event day: a group marked Done with the time and the name of the person who tapped it.",
    },
  },
  {
    title: "Clear roles and permissions",
    body: "Facilitators invite the people helping them, and each person sees only what their job needs.",
    points: [
      "Account Hosts can run every event on your school's account",
      "Hosts and Co-hosts run their event",
      "Volunteer Leads manage volunteers, and Coordinators run one sign-up",
      "Visiting directors see their own registration, never other schools' contact details",
    ],
  },
];

const privacy = [
  "We ask for only what each event needs: headcounts instead of student names for contests, and no accounts for families or spectators.",
  "Children's details from school visitor events and conferences are deleted 30 days after the event, volunteers' details 10 days after (packages with volunteer tracking keep a count of each adult's shifts until 2 years after their last event), fair partners' contact details 15 months after, and visiting directors' personal details 2 years after.",
  "Information families and volunteers give is your school's or organization's. We store it for you, and copies your staff print or download are your records.",
  "No ads, no spam, and emails used only for your event.",
];

const faqs = [
  {
    q: "Does it connect to our student information system?",
    a: `No. There's nothing to install or integrate, and students don't have accounts. Families and volunteers give only what the event needs, right on its sign-up page.`,
  },
  {
    q: "How much training do staff and volunteers need?",
    a: "Very little. Each kind of event walks facilitators through setup one step at a time. Volunteers and families use their phone's web browser with no account, and event-day screens show who has arrived and what happens next.",
  },
  {
    q: "Who owns the information?",
    a: `Your school or organization. ${brand.name} stores it for you and deletes it on a set schedule. Anything your staff print, download, or copy becomes your own record, kept under your policies.`,
  },
  {
    q: "Can our technology or legal team review it first?",
    a: "Yes. Our student data privacy page lists what's collected, who can see it, and when it's deleted. Email us, and a person on our team will send our district packet, answer their questions, and work through your district's data privacy agreement with you.",
  },
  {
    q: "Can we start from the lists we already have?",
    a: "Yes. Import families for a visitor day or volunteers onto their shifts from a spreadsheet, and choose whether each one gets a confirmation email. Visiting band and choir directors can be imported too: their details are filled in for them, and you invite them to register when you're ready.",
  },
  {
    q: "Can we see who did what?",
    a: "Yes. Every setup step shows who last saved it and when, and every check-in tap on event day records who made it and when. Each person on your team signs in with their own email, so there are no shared logins.",
  },
];

/** For principals and district administrators: reliability, support, and less staff strain. */
export default function AdministratorsPage() {
  const eventPages = [...AUDIENCES, CONFERENCES_PAGE];
  return (
    <div className="flex flex-1 flex-col">
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
              <LineIcon name={ADMINISTRATORS_PAGE.icon} className="size-4" />
              For principals and district administrators
            </p>
            <h1 className="mt-6 max-w-3xl text-4xl font-medium leading-[0.96] sm:text-6xl">Reliable events with less strain on your staff</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-on-dark-mute">
              {brand.name} keeps events organized, so facilitators can focus on their people, not the logistics. And when you need help,
              you&apos;ll reach a real person, not a bot.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <JumpLink href="#join" className="rounded-full bg-violet px-6 py-3 font-semibold text-header hover:brightness-90">
                {CTA}
              </JumpLink>
              <a href={`mailto:${brand.supportEmail}`} className="rounded-full px-5 py-3 font-medium text-white ring-1 ring-white/50 hover:bg-white/10">
                Talk with us
              </a>
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <h2 className="text-xl font-semibold">What it replaces</h2>
            <ul className="mt-5 grid list-disc gap-x-10 gap-y-3 pl-5 leading-7 text-muted marker:text-muted sm:grid-cols-2">
              {replaces.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </section>

        <HowItWorks steps={steps} className="" />

        <FeatureSections sections={sections} />

        <section className="mx-auto max-w-6xl px-4 pb-16 pt-4 sm:px-6">
          <div className={`rounded-lg p-8 sm:p-12 ${infoBox}`}>
            <h2 className="text-3xl font-normal leading-[1.02] tracking-tight sm:text-4xl">Student and family information</h2>
            <ul className="mt-6 grid max-w-5xl gap-4 leading-7 sm:grid-cols-2">
              {privacy.map((p) => (
                <li key={p} className="opacity-90">
                  {p}
                </li>
              ))}
            </ul>
            <Link href={STUDENT_PRIVACY_PAGE.path} className="mt-6 inline-block font-semibold underline">
              How we handle everyone&apos;s data
            </Link>
          </div>
        </section>

        <SupportSection />

        <section id="faq" tabIndex={-1} className="scroll-mt-20 border-t border-border outline-none">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-3xl font-normal leading-[1.02] tracking-tight sm:text-4xl">Common questions</h2>
            <FaqList faqs={faqs} />
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <h2 className="text-xl font-semibold">Every kind of event your campus runs</h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {eventPages.map((o) => (
                <li key={o.path}>
                  <Link
                    href={o.path}
                    className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 font-medium hover:border-brand"
                  >
                    <LineIcon name={o.icon} className="size-5 text-brand dark:text-foreground" />
                    {o.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="join" tabIndex={-1} className="scroll-mt-20 border-t border-border bg-surface outline-none">
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
            <p className="inline-flex rounded-full bg-accent-soft px-3 py-1 text-sm font-medium">Limited spots</p>
            <h2 className="mt-4 text-3xl font-normal leading-[1.02] tracking-tight sm:text-4xl">{CTA}</h2>
            <p className="mt-3 leading-7 text-muted">
              It&apos;s free through {PILOT_END_LABEL}, when the pilot ends. Tick the kinds of events your campus runs.{" "}
              <Link href="/#pilot" className="text-brand underline">
                See the pilot details
              </Link>
              .
            </p>
            <div className="mt-8">
              <PilotForm action={requestPilot} />
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

import type { Metadata } from "next";
import Link from "next/link";
import { HeaderBar, headerLinkClass } from "@/components/logo";
import { FeatureSections, infoBox, SupportSection } from "@/components/audience-page";
import { FaqList } from "@/components/faq-list";
import { HowItWorks, type HowStep } from "@/components/how-it-works";
import { JumpLink } from "@/components/jump-link";
import { SiteFooter } from "@/components/site-footer";
import { PilotForm } from "@/app/pilot-form";
import { requestPilot } from "@/app/pilot-actions";
import { CONFERENCES_PAGE, type Audience } from "@/lib/audiences";
import { brand } from "@/lib/brand";
import { PILOT_END_LABEL } from "@/lib/pilot";
import { LineIcon } from "@/components/line-icon";
import { connection } from "next/server";
import { loadTiers, type Tier } from "@/lib/package-names";

/** The Free Teacher package as set on the admin Packages page, or null if it can't be read. */
async function freeTeacher(): Promise<Tier | null> {
  await connection(); // Read on each visit, so Packages page changes show here.
  try {
    return (await loadTiers()).find((t) => t.code === "free_teacher") ?? null;
  } catch {
    return null;
  }
}

/** What a free teacher account includes, in words, from the Free Teacher package. */
function freeOffer(t: Tier | null) {
  const level = (type: string) =>
    !t ? (type === "conference" ? "one" : "none") : !t.event_types.includes(type) ? "none" : t.one_at_a_time.includes(type) ? "one" : "all";
  const conf = level("conference");
  const meet = level("meeting");
  const weekly = t?.weekly_hours ?? false;
  const part = (what: string, l: string) => (l === "one" ? `${what}, one published at a time` : what);
  const runs = [conf !== "none" && part("parent-teacher conference days", conf), meet !== "none" && part("meetings like office hours", meet)].filter(Boolean);
  const runsText = runs.join(conf === "one" ? ", and " : " and ");
  return {
    included: conf !== "none",
    weekly,
    faq:
      conf === "none"
        ? "During the pilot, conference scheduling comes with a paid package. Join the pilot, and we'll find the right fit for your class."
        : `Yes, during the pilot. Join the pilot, and we set up your free teacher account. It runs ${runsText}, and there's no credit card. ${weekly ? "Weekly hours are included." : "Weekly hours are a premium feature."}`,
    whatsFree:
      conf === "none"
        ? "During the pilot, conference scheduling comes with a paid package."
        : `A free teacher account runs ${runsText} while we're in the pilot.`,
    description: weekly ? "Weekly hours for calls included." : "Weekly hours for calls with premium.",
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const offer = freeOffer(await freeTeacher());
  return {
    title: "Parent-Teacher Conference Scheduling, Free During the Pilot",
    description: `Free for teachers during the pilot: set aside a day and families book their own conference time, in person, on video, or by phone, with calendar invites, reminders, and a link to change or cancel. ${offer.description}`,
    alternates: { canonical: CONFERENCES_PAGE.path },
  };
}

/** "Free during the pilot": the pilot form at the bottom of this page (we set up each account). */
const START = "#join" as const;

const steps: HowStep[] = [
  {
    title: "Set your day and hours",
    body: "Pick the meeting length and a few minutes between meetings. Add breaks if you need them. With premium, set the same hours every week instead.",
    screen: "/screens/conference-meeting-times.webp",
    alt: "Conference Setup: the day and hours, 15-minute meetings with 5 minutes between them, and breaks.",
  },
  {
    title: "Families pick a time",
    body: "Share one link. Families choose an open time, in person, on video, or by phone. Taken times aren't shown, so no one is double-booked.",
    screen: "/screens/conference-booking-page.webp",
    alt: "A parent booking a conference: open times to pick from, their child's name, and their own details.",
  },
  {
    title: "Everyone gets the details",
    body: "Each parent gets a calendar invite and a reminder, and can change or cancel from their own link.",
    screen: "/screens/conference-family-booking.webp",
    alt: "A family's booking page: when and where they meet the teacher, who's coming, and a way to change the time.",
  },
];

const sections: Audience["sections"] = [
  {
    title: "Set up in minutes",
    body: "Pick your day and hours, how long each meeting runs, and the minutes between meetings. Your meeting times are worked out for you.",
    points: [
      "Meetings of 10 to 60 minutes, with up to 15 minutes between them",
      "Add up to eight breaks, like lunch or a planning period, each with its own label",
      "Offer any mix of in person, video, and phone calls, and each family picks one",
      "Using one video link for everyone? You confirm it has a waiting room first, so families don't walk in on each other",
    ],
    screen: {
      src: "/screens/conference-meet-options.webp",
      alt: "Conference setup on a phone: tick in person, video, or phone call, then your school and room.",
    },
  },
  {
    title: "Families are taken care of",
    body: "Families book from your link without an account. Only open times are shown, so no one is double-booked.",
    points: [
      "Up to four parents or guardians on one booking, and each one gets the confirmation and a calendar invite",
      "An optional note to you, like a question they'd like to cover",
      "A reminder the day before, and a private link to change or cancel. A new time updates their calendar invite",
      "Email subjects never include a child's name",
    ],
  },
  {
    title: "Weekly hours and phone calls",
    body: "With premium, offer the same times every week, like calls on Tuesday afternoons. Families pick a day, then a time, and you call them.",
    points: [
      "Weekly hours on any days, with days off for holidays and field trips",
      "You choose how much notice families give and how far ahead they can book",
      "For phone calls, families give the number to call. Your number is never asked for or shared",
      "Each family has one upcoming meeting at a time, and can book again once it's past",
    ],
    screen: {
      src: "/screens/conference-weekly-hours.webp",
      alt: "Conference setup on a phone: Every week chosen, a first and last day, and Tuesday hours from 3:30 to 4:30 PM.",
    },
  },
  {
    title: "Your conference day",
    body: "Your Meetings page shows who's now and who's next, with each family's note, on your phone or laptop.",
    points: [
      "Search for any family, and print a one-page summary or the full list",
      "Mark each meeting Met or No-show once it starts, and undo it if you need to",
      "Cancel a meeting, and the family is emailed",
      "Each booking lands on your own calendar too, and moves or comes off it when a family changes or cancels",
    ],
    screen: {
      src: "/screens/conference-meetings-day.webp",
      alt: "A teacher's Meetings page on a phone on conference day: the family meeting now with their note, Met and No-show buttons, and the family up next.",
    },
  },
];

const privacy = [
  "Only you and your co-hosts see children's names and family notes, never other families.",
  "Families never see who else booked. Taken times simply aren't listed.",
  "Bookings are deleted 30 days after your conferences, or for weekly hours, 30 days after each meeting.",
];

// Plain answers to what teachers ask before signing up.
const faqs = (freeAnswer: string) => [
  {
    q: "Is it free for teachers?",
    a: freeAnswer,
  },
  {
    q: "Can families meet on video or by phone?",
    a: "Yes. Offer in person, video, phone calls, or any mix, and each family picks one when they book. For phone calls, families give the number to call, and you call them.",
  },
  {
    q: "Do families see my phone number?",
    a: "No. We never ask for your number. Calling from your own phone? In the US, dial *67 before the number to hide yours, or use a school phone.",
  },
  {
    q: "Can I offer the same times every week?",
    a: `Yes, with premium. Set weekly hours, like Tuesday and Thursday afternoons, add days off, and choose how much notice families give and how far ahead they can book. Write to us at ${brand.supportEmail} to add premium to your account.`,
  },
  {
    q: "Do families need to make an account?",
    a: "No. Families book from your link without an account. Each booking gets its own link to change or cancel.",
  },
  {
    q: "Can more than one parent come?",
    a: "Yes. Up to four parents or guardians can be on one booking, and each one gets the confirmation and calendar invite.",
  },
  {
    q: "Can a family with two children in my class book both?",
    a: "Yes. Each child has their own booking, so the family books two times. Each booking has its own link to change or cancel.",
  },
  {
    q: "Can I print my schedule?",
    a: "Yes. Your Meetings page prints a one-page summary or the full list.",
  },
  {
    q: "What if a family doesn't show?",
    a: "Mark the meeting No-show on your Meetings page once it starts. If they arrive late, undo it.",
  },
  {
    q: "Will bookings show up on my calendar?",
    a: "Yes. When a family books, changes their time, or cancels, you get an email with a calendar invite, so each meeting is added, moved, or removed on your own calendar. Every booking is also on your Meetings page.",
  },
];

/** Parent-teacher conferences: what they do, and a free teacher account to run them. */
export default async function ConferencesPage() {
  const offer = freeOffer(await freeTeacher());
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
          href={START}
          className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-violet px-3 text-[13px] font-semibold text-header transition hover:brightness-90 sm:px-5 sm:text-sm"
        >
          Free during the pilot
        </JumpLink>
      </HeaderBar>

      <main className="flex-1">
        <section className="hero-sky text-white">
          <div className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pb-24 sm:pt-20">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white ring-1 ring-white/20">
              <LineIcon name={CONFERENCES_PAGE.icon} className="size-4" />
              Parent-teacher conferences
            </p>
            <h1 className="mt-6 max-w-3xl text-4xl font-medium leading-[0.96] sm:text-6xl">
              Parent-teacher conferences that schedule themselves
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-on-dark-mute">
              Set aside a day, share one link, and families book their own time, in person, on video, or by phone. No sign-up
              sheets, no reply-all emails, and no double bookings.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <JumpLink href={START} className="rounded-full bg-violet px-6 py-3 font-semibold text-header hover:brightness-90">
                Free during the pilot
              </JumpLink>
            </div>
            <p className="mt-4 text-sm text-on-dark-mute">Tell us about your school, and we&apos;ll set up your account. No credit card.</p>
          </div>
        </section>

        <HowItWorks steps={steps} className="" />

        <FeatureSections sections={sections} />

        <section className="mx-auto max-w-6xl px-4 pb-16 pt-4 sm:px-6">
          <div className={`rounded-lg p-8 sm:p-12 ${infoBox}`}>
            <h2 className="text-3xl font-normal leading-[1.02] tracking-tight sm:text-4xl">Who sees what</h2>
            <ul className="mt-6 grid max-w-5xl gap-4 leading-7 sm:grid-cols-2">
              {privacy.map((p) => (
                <li key={p} className="opacity-90">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <SupportSection />

        <section id="faq" className="scroll-mt-20 border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-3xl font-normal leading-[1.02] tracking-tight sm:text-4xl">Common questions</h2>
            <FaqList faqs={faqs(offer.faq)} />
          </div>
        </section>

        <section className="border-t border-border bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
            <h2 className="text-2xl font-semibold">What&apos;s free</h2>
            <p className="mt-3 leading-7 text-muted">
              {offer.whatsFree} Planning a band contest,
              school fair, volunteer sign-ups, or visitor registration and check-in too? Pick those on the form, and we&apos;ll set up {brand.name} for your school.
            </p>
          </div>
        </section>

        <section id="join" tabIndex={-1} className="scroll-mt-20 border-t border-border bg-surface outline-none">
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
            <p className="inline-flex rounded-full bg-accent-soft px-3 py-1 text-sm font-medium">Free during the pilot</p>
            <h2 className="mt-4 text-3xl font-normal leading-[1.02] tracking-tight sm:text-4xl">Join the pilot</h2>
            <p className="mt-3 leading-7 text-muted">
              Tell us about your school, and we&apos;ll set up your account and email you when it&apos;s ready. The pilot ends {PILOT_END_LABEL}.
            </p>
            <div className="mt-8">
              <PilotForm action={requestPilot} defaultEventTypes={["conference"]} />
            </div>
          </div>
        </section>

        <section className="bg-teal-deep text-white">
          <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
            <h2 className="mx-auto max-w-2xl text-3xl font-medium leading-tight sm:text-4xl">Every detail organized. Every organizer supported.</h2>
            <JumpLink href={START} className="mt-8 inline-flex rounded-md bg-white px-6 py-3 font-semibold text-teal-deep hover:brightness-90">
              Free during the pilot
            </JumpLink>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

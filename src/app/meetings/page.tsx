import type { Metadata } from "next";
import { PublicMenu } from "@/components/public-menu";
import Link from "next/link";
import { HeaderBar, headerLinkClass } from "@/components/logo";
import { FeatureSections, infoBox, SupportSection } from "@/components/audience-page";
import { FaqList } from "@/components/faq-list";
import { HowItWorks, type HowStep } from "@/components/how-it-works";
import { JumpLink } from "@/components/jump-link";
import { SiteFooter } from "@/components/site-footer";
import { PilotForm } from "@/app/pilot-form";
import { requestPilot } from "@/app/pilot-actions";
import { MEETINGS_PAGE, type Audience } from "@/lib/audiences";
import { brand } from "@/lib/brand";
import { PILOT_NOTE } from "@/lib/pilot";
import { LineIcon } from "@/components/line-icon";

// Copy follows docs/brand-voice.md.

export const metadata: Metadata = {
  title: "Meeting Scheduling for Schools: Office Hours, Advising, and More",
  description:
    "Set your hours, share one link, and people book their own time with you, in person, on video, or by phone, with calendar invites, reminders, and a link to change or cancel. No account needed to book.",
  alternates: { canonical: MEETINGS_PAGE.path },
};

/** The pilot form at the bottom of this page. */
const START = "#join" as const;

const steps: HowStep[] = [
  {
    title: "Set your hours",
    body: "One day of meetings, or the same hours every week. Pick how long each meeting runs and add breaks or days off.",
    screen: "/screens/meeting-setup.webp",
    alt: "Meeting Setup on a phone: every week on Tuesdays and Thursdays, from a first day to a last day.",
  },
  {
    title: "People pick a time",
    body: "Share one link. People pick a day, then an open time, and how they'd like to meet. Taken times aren't shown, so no one is double-booked.",
    screen: "/screens/meeting-booking-page.webp",
    alt: "Booking a meeting on a phone: a month calendar with open days circled, under the organizer's weekly hours.",
  },
  {
    title: "Run your meetings",
    body: "Your Meetings page shows who's next, with their note and how to reach them. Everyone gets a calendar invite and a reminder.",
    screen: "/screens/meeting-list.webp",
    alt: "The organizer's Meetings page on a phone: today's meeting up next, on video, with the person's email and phone.",
  },
];

const sections: Audience["sections"] = [
  {
    title: "Set up in minutes",
    body: "Pick your day or weekly hours, how long each meeting runs, and the minutes between meetings. Your meeting times are worked out for you.",
    points: [
      "Meetings of 10 to 60 minutes, with up to 15 minutes between them",
      "Breaks like lunch, and days off for holidays",
      "With weekly hours, choose how much notice people give and how far ahead they can book",
      "Offer any mix of in person, video, and phone calls, and each person picks one",
    ],
  },
  {
    title: "Easy for the people booking",
    body: "People book from your link without an account. Only open times are shown, so no one is double-booked.",
    points: [
      "Bring up to three others, and each one gets the confirmation and a calendar invite",
      "An optional note to you, like a question they'd like to cover",
      "A reminder the day before, and a private link to change or cancel",
      "One upcoming meeting per person, so no one holds several times",
    ],
  },
  {
    title: "Your meeting day",
    body: "Your Meetings page shows who's now and who's next, on your phone or laptop.",
    points: [
      "Search for anyone, and print a one-page summary or the full list",
      "Mark each meeting Met or No-show, and undo it if you need to",
      "Cancel a meeting, and the person is emailed",
      "Each booking lands on your own calendar too, and moves or comes off it when someone changes or cancels",
    ],
  },
];

const privacy = [
  "Only you and your co-hosts see who booked, their contact details, and their notes.",
  "People never see who else booked. Taken times simply aren't listed.",
  "Bookings are deleted 30 days after each meeting.",
  "No ads, no spam, and emails used only for your meetings",
];

// Plain answers to what organizers ask before signing up.
const faqs = [
  {
    q: "What can I use Meetings for?",
    a: "Any time people book a one-on-one with you: counselor and advising appointments, office hours, coaching check-ins, scholarship or college application help, and PTA or booster meetings. For parent-teacher conferences, use our conference scheduling, which asks for each child's name.",
  },
  {
    q: "Do people need to make an account?",
    a: "No. People book from your link without an account. Each booking gets its own link to change or cancel.",
  },
  {
    q: "Can people meet on video or by phone?",
    a: "Yes. Offer in person, video, phone calls, or any mix, and each person picks one when they book. For phone calls, they give the number to call, and you call them.",
  },
  {
    q: "Do people see my phone number?",
    a: "No. We never ask for your number. Calling from your own phone? In the US, dial *67 before the number to hide yours, or use a work phone.",
  },
  {
    q: "Can I offer the same times every week?",
    a: "Yes. Set weekly hours on any days, add days off, and choose how much notice people give and how far ahead they can book.",
  },
  {
    q: "Can someone bring another person?",
    a: "Yes. Up to three others can be on one booking, and each one gets the confirmation and calendar invite.",
  },
  {
    q: "Will bookings show up on my calendar?",
    a: "Yes. When someone books, changes their time, or cancels, you get an email with a calendar invite, so each meeting is added, moved, or removed on your own calendar.",
  },
  {
    q: "What if someone doesn't show?",
    a: "Mark the meeting No-show on your Meetings page once it starts. If they arrive late, undo it.",
  },
];

/** Meetings: anyone books time with an organizer, like office hours or advising. */
export default function MeetingsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <HeaderBar maxWidth="max-w-6xl">
        <Link href="/" className={`hidden sm:block ${headerLinkClass}`}>
          All event types
        </Link>
        <PublicMenu
          links={[
            { href: "/#organizing", label: "All kinds of events" },
            { href: "#how", label: "How it works" },
            { href: "#faq", label: "Questions" },
            { href: "/#pilot", label: "Pilot details" },
          ]}
        />
        <Link href="/login" className={headerLinkClass}>
          Sign in
        </Link>
        <JumpLink
          href={START}
          className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-violet px-3 text-[13px] font-semibold text-header transition hover:brightness-90 sm:px-5 sm:text-sm"
        >
          Join the pilot
        </JumpLink>
      </HeaderBar>

      <main className="flex-1">
        <section className="hero-sky text-white">
          <div className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pb-24 sm:pt-20">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white ring-1 ring-white/20">
              <LineIcon name={MEETINGS_PAGE.icon} className="size-4" />
              Meetings
            </p>
            <h1 className="mt-6 max-w-3xl text-4xl font-medium leading-[0.96] sm:text-6xl">Office hours and appointments that book themselves</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-on-dark-mute">
              Set your hours, share one link, and people book their own time with you, in person, on video, or by phone. No
              back-and-forth emails, and no double bookings.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <JumpLink href={START} className="rounded-full bg-violet px-6 py-3 font-semibold text-header hover:brightness-90">
                Join the pilot
              </JumpLink>
            </div>
            <p className="mt-4 text-sm text-on-dark-mute">{PILOT_NOTE} No credit card.</p>
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
            <FaqList faqs={faqs} />
          </div>
        </section>

        <section id="join" tabIndex={-1} className="scroll-mt-20 border-t border-border bg-surface outline-none">
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
            <p className="inline-flex rounded-full bg-accent-soft px-3 py-1 text-sm font-medium">Free during the pilot</p>
            <h2 className="mt-4 text-3xl font-normal leading-[1.02] tracking-tight sm:text-4xl">Join the pilot</h2>
            <p className="mt-3 leading-7 text-muted">
              Tell us about your school or group, and we&apos;ll set up your account and email you when it&apos;s ready. Planning other
              events too? Pick them on the form, and they&apos;re part of the same account with {brand.name}.
            </p>
            <div className="mt-8">
              <PilotForm action={requestPilot} defaultEventTypes={["meeting"]} />
            </div>
          </div>
        </section>

        <section className="bg-teal-deep text-white">
          <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
            <h2 className="mx-auto max-w-2xl text-3xl font-medium leading-tight sm:text-4xl">Every detail organized. Every organizer supported.</h2>
            <JumpLink href={START} className="mt-8 inline-flex rounded-md bg-white px-6 py-3 font-semibold text-teal-deep hover:brightness-90">
              Join the pilot
            </JumpLink>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

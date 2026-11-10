import type { Metadata } from "next";
import Link from "next/link";
import { HeaderBar, headerLinkClass } from "@/components/logo";
import { SiteFooter } from "@/components/site-footer";
import { STUDENT_PRIVACY_PAGE } from "@/lib/audiences";
import { brand } from "@/lib/brand";

// The public answer to "how do you handle student data?", for district
// technology and legal teams. Keep it in step with docs/DATA-PRIVACY.md; every
// statement must match what the database actually does.

export const metadata: Metadata = {
  title: "Data Privacy",
  description: `What ${brand.name} collects about students, families, volunteers, and organizers, who can see it, where it's stored, and when it's deleted.`,
  alternates: { canonical: STUDENT_PRIVACY_PAGE.path },
};

/** Shown at the top, for reviewers. Change it whenever this page changes. */
const UPDATED = "October 2026";

const glance = [
  "Most events collect no student information at all",
  "Where an event needs it: a child's name, and for visitor days their teacher and grade",
  "Deleted on a schedule, 10 to 30 days after the event",
  "Owned by your school or organization, never sold, and never used for ads",
  "Stored in the United States, with access rules enforced inside the database",
];

const sectionLinks = [
  ["collect", "What we collect"],
  ["see", "Who can see it"],
  ["deleted", "When it's deleted"],
  ["owns", "Who owns it"],
  ["stored", "Where it's stored"],
  ["protected", "How it's protected"],
  ["agreements", "Data privacy agreements"],
] as const;

const collected = [
  {
    event: "Band contests and group festivals",
    students: "None. Headcounts only.",
    adults: "Directors' and assistant directors' names, the head director's email address and phone number, the school's address and contact email, and any accessibility or staging needs",
  },
  {
    event: "Volunteers and sign-ups",
    students:
      "Volunteers under 18: first name and last initial, age (to match shifts with a minimum age), and an optional email address and phone number, signed up by a parent or guardian. A record of the guardian's confirmation (who confirmed, when, and the exact words) is kept permanently",
    adults: "Volunteers' names, email addresses, and phone numbers, and shift check-in times",
  },
  { event: "School fairs", students: "None", adults: "Booth partners' contact name, email address, and phone number" },
  {
    event: "Visitor registration and check-in",
    students: "Each child's name, teacher, and grade",
    adults: "Parent's name, email address, and optional phone number, other adults' names, and door check-in times",
  },
  {
    event: "Parent-teacher conferences",
    students: "The child's name, the parent's optional note to the teacher, and whether the meeting took place",
    adults: "Up to four parents' names and email addresses, with optional phone numbers, and for phone calls, the number the teacher calls",
  },
  { event: "Organizer and team accounts", students: "None", adults: "Name, email address, optional phone number, and sign-in history" },
];

const deleted = [
  { what: "Children's details from visitor registration and check-in", when: "30 days after the event" },
  { what: "Parent-teacher conference bookings", when: "30 days after the conference, or for weekly hours, 30 days after each meeting" },
  { what: "Volunteers' details, phone numbers, and check-in times, and volunteers under 18", when: "10 days after the event" },
  {
    what: "Only for organizers with volunteer tracking: adult volunteers' names, email addresses, and how many shifts they signed up for and checked in to (the organizer's volunteer history)",
    when: "2 years after their last event, or right away when the organizer removes them",
  },
  { what: "Files shared with an event", when: "30 days after the event" },
  { what: "Booth partners' contact details", when: "15 months after the event" },
  { what: "Band and group directors' contact details", when: "2 years after the event, so a contest can invite them back" },
  { what: "Records of the emails we sent", when: "14 to 180 days after sending" },
  { what: "A closed account and everything in it", when: "90 days after it's closed" },
];

const providers = [
  { name: "Supabase", does: "Database, sign-in, and file storage, in the United States" },
  { name: "Vercel", does: "Hosts the website and app" },
  { name: "Resend", does: "Sends confirmation and reminder emails" },
  { name: "Sentry", does: "Error alerts, with names, email addresses, phone numbers, and form contents removed" },
  { name: "Cloudflare Turnstile", does: "The “not a robot” check on public forms" },
  { name: "Google Maps Platform", does: "Venue address search for organizers. It receives no personal information." },
];

const h2 = "text-2xl font-medium leading-tight tracking-tight sm:text-3xl";

/** Student data privacy: the facts a district asks for before signing up. */
export default function StudentDataPrivacyPage() {
  return (
    <div className="flex flex-1 flex-col">
      <HeaderBar maxWidth="max-w-4xl">
        <Link href="/" className={`hidden sm:block ${headerLinkClass}`}>
          All event types
        </Link>
        <Link href="/login" className={headerLinkClass}>
          Sign in
        </Link>
      </HeaderBar>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-sm font-medium text-muted">{STUDENT_PRIVACY_PAGE.name}</p>
        <h1 className="mt-2 text-4xl font-medium leading-tight tracking-tight sm:text-5xl">Only what each event needs</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
          Most events collect no student information at all. Where an event needs it, it&apos;s limited to a name, and for visitor registration and check-in
          the child&apos;s teacher and grade, and it&apos;s deleted 30 days after the event.
        </p>
        <p className="mt-3 text-sm text-muted">Last updated {UPDATED}</p>

        <section aria-labelledby="glance" className="mt-10 rounded-lg border border-border bg-surface p-6 sm:p-8">
          <h2 id="glance" className="text-xl font-semibold">
            At a glance
          </h2>
          <ul className="mt-4 space-y-2 leading-7">
            {glance.map((g) => (
              <li key={g} className="flex gap-2">
                <span aria-hidden className="text-success">
                  ✓
                </span>
                <span>{g}</span>
              </li>
            ))}
          </ul>
          <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {sectionLinks.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="inline-flex min-h-11 items-center font-medium text-brand underline-offset-4 hover:underline">
                {label}
              </a>
            ))}
          </nav>
        </section>

        <section id="collect" className="mt-12 scroll-mt-20">
          <h2 className={h2}>What we collect</h2>
          <ul className="mt-6 divide-y divide-border rounded-lg border border-border">
            {collected.map((c) => (
              <li key={c.event} className="grid gap-2 p-4 sm:grid-cols-[1fr_1.4fr_1.4fr] sm:gap-6">
                <span className="font-semibold">{c.event}</span>
                <span>
                  <span className="block text-xs font-medium uppercase tracking-wide text-muted">About students</span>
                  {c.students}
                </span>
                <span>
                  <span className="block text-xs font-medium uppercase tracking-wide text-muted">About adults</span>
                  {c.adults}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 leading-7 text-muted">
            We never collect student ID numbers, dates of birth, home addresses, grades or scores, school attendance, or health, discipline, or special
            education information, and students never have accounts. The two optional free-text boxes, a band&apos;s accessibility or staging
            needs and a parent&apos;s note to a teacher, ask people to leave health details out.
          </p>
        </section>

        <section id="see" className="mt-12 scroll-mt-20">
          <h2 className={h2}>Who can see it</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 leading-7">
            <li>
              Children&apos;s and families&apos; details from visitor days: the event&apos;s Hosts, Co-hosts, and Volunteer Leads, who run the
              door, and Coordinators on event day only
            </li>
            <li>Conference bookings, parents&apos; notes, and the number to call for phone calls: only the teacher who set up the conference and the hosts and co-hosts on their account, who can reschedule or cancel a meeting.</li>
            <li>Volunteers&apos; phone numbers: Hosts, Co-hosts, and Volunteer Leads, and Coordinators on event day only</li>
            <li>
              An organizer&apos;s volunteer history (who volunteered and how many shifts they kept): that organizer&apos;s Hosts, Co-hosts, and
              Volunteer Leads only, never other organizers
            </li>
            <li>Visiting directors see their own registration, never other schools&apos; contact details</li>
            <li>Families never see who else registered or booked</li>
            <li>These rules are enforced inside the database, with an automated test for each one</li>
          </ul>
        </section>

        <section id="deleted" className="mt-12 scroll-mt-20">
          <h2 className={h2}>When it&apos;s deleted</h2>
          <p className="mt-3 leading-7 text-muted">Deletion runs automatically every day. Organizers can also delete an event at any time.</p>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {deleted.map((d) => (
              <li key={d.what} className="flex flex-col gap-1 p-4 sm:flex-row sm:justify-between sm:gap-6">
                <span>{d.what}</span>
                <span className="font-semibold">{d.when}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 leading-7 text-muted">
            Kept until the account is closed: organizer, team, and director sign-in accounts and their sign-in history. Emails and calendar
            invites we send live in each recipient&apos;s own inbox and calendar, and anything your staff print or download is your school&apos;s
            own record, kept under your policies.
          </p>
        </section>

        <section id="owns" className="mt-12 scroll-mt-20">
          <h2 className={h2}>Who owns it</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 leading-7">
            <li>The school or organization running the event owns the information, and we store it for them</li>
            <li>We use it only to run their event: sign-ups, confirmations, reminders, and check-in</li>
            <li>We never sell it, never show ads, and never send marketing to families, students, or volunteers</li>
          </ul>
        </section>

        <section id="stored" className="mt-12 scroll-mt-20">
          <h2 className={h2}>Where it&apos;s stored, and who helps us run the service</h2>
          <p className="mt-3 leading-7 text-muted">
            Data is stored in the United States. These providers handle it only to run the service. We don&apos;t use advertising, analytics,
            or tracking services.
          </p>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {providers.map((p) => (
              <li key={p.name} className="grid gap-1 p-4 sm:grid-cols-[12rem_1fr] sm:gap-6">
                <span className="font-semibold">{p.name}</span>
                <span>{p.does}</span>
              </li>
            ))}
          </ul>
        </section>

        <section id="protected" className="mt-12 scroll-mt-20">
          <h2 className={h2}>How it&apos;s protected</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 leading-7">
            <li>Encrypted in transit and at rest</li>
            <li>Database rules that keep each school&apos;s information separate, checked in a security review in October 2026</li>
            <li>Private links for families and volunteers that use long random keys</li>
            <li>Shared files opened through private links that expire within minutes</li>
            <li>Bot protection and sending limits on public forms</li>
          </ul>
        </section>

        <section id="agreements" className="mt-12 scroll-mt-20 rounded-lg border border-border bg-surface p-6 sm:p-8">
          <h2 className={h2}>Data privacy agreements</h2>
          <p className="mt-3 leading-7">
            We work with districts on their data privacy agreements, including the Texas Student Privacy Alliance&apos;s agreement. Email us
            and a person on our team will send our district packet and answer your team&apos;s questions.
          </p>
          <a
            href={`mailto:${brand.supportEmail}?subject=${encodeURIComponent("Data privacy agreement")}`}
            className="mt-6 inline-flex min-h-11 items-center rounded-md bg-brand px-5 font-semibold text-brand-foreground hover:bg-brand-hover"
          >
            Email {brand.supportEmail}
          </a>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

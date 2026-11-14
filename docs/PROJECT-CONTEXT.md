# Project context

One page on what Field Command Events is and how it works today, for anyone (or any Claude chat or project) who
needs the current picture fast. **Updated with every pull request that changes what people see or do.** When this
page and an older note disagree, this page and the files it points to are right.

Last updated: 2026-11-14 (PR: project context page)

## What it is

- **Product:** Field Command Events (the name lives only in `src/lib/brand.ts`)
- **Tagline:** *Every detail organized. Every organizer supported.*
- **Who it's for:** schools first (band and choir directors, PTOs and booster clubs, teachers, principals, and
  districts), and also congregations, clubs, nonprofits, and community groups
- **The promise:** organizers have an account; everyone they invite (volunteers, parents, directors, families)
  joins from a link with no account and no ads. Real people answer support, with a reply within a day
- **Where:** Melissa, Texas. Website and app at fieldcommandevents.com
- **Stage:** a free pilot that ends January 1, 2027. Nobody can buy a plan in the app yet (Stripe is next; see
  `docs/ROADMAP.md`)

## Kinds of event

Each kind has its own setup steps, event-day screens, and public pages. Labels and blurbs: `src/lib/event-types.ts`.

| Kind (stored as) | What it does |
|---|---|
| Band contest (`band_contest`) | Director registration, performance order and finals (with a finalist reveal), contest-day check-in stops from parking to the gate, push the schedule back, a live order for spectators |
| Choir, orchestra, or group festival (`group_event`) | Groups register (performers, chaperones, buses, availability), rooms and a schedule builder with per-day order, door links for each room, Arrived / In / Done marks, families and directors follow each room live |
| Volunteers and sign-ups (`volunteer`) | Jobs and shifts, things to bring, public sign-up (family members and under-18 helpers too), reminders, a check-in desk with walk-ups, volunteer badges |
| Visitor registration and check-in (`school_visit`) | Parents register each child, teacher, and grade; photo ID reminder; door check-in. Children's details deleted 30 days after |
| School fair or fundraiser (`fair`) | Booths and partners by zone, partner check-in, a public "What's at the event" page, volunteer shifts with Coordinators |
| Parent-teacher conferences (`conference`) | Families book, change, or cancel a time; reminders; the teacher's meetings page. Free for teachers |
| Meetings (`meeting`) | Advisers, counselors, coaches, and club officers set their hours (one day or every week); anyone with the link books |

Every kind set up in steps follows `docs/event-setup-pattern.md` (one step bar, the same step pages, saving,
publishing, and words).

Volunteers can be added to band contests and festivals too (the "Jobs and shifts" or "Volunteers" area).

## Add-ons and packages

- **Packages** (names and prices are set on the admin Packages page, so check the app for current ones): Free,
  Free Teacher, Volunteer Command, Event Command, Schedule Command, and District Command, plus one-time event
  passes. Each package says which kinds of event it includes, team spots, and whether Volunteer tracking is in it.
  During the pilot every account gets Schedule Command.
- **Sponsors add-on** (an admin switches it on per account): band contests, festivals, and fairs thank their own
  sponsors on the main public event page only (a "Presented by" line, a thank-you section by level, and one line on
  the day). Never on sign-up, registration, or director pages, or in emails. Decisions:
  `docs/design-decisions/2026-11-12-sponsors.md`

## People and permissions

In the app the permission names stay **Host**, **Co-host**, and **Account Host**; the website calls the person the
"organizer".

- **Account Host:** owns the account; the only one who can delete events or manage co-hosts
- **Co-host:** of every event, or of just one event (sees only that one)
- **Volunteer Lead:** runs an event's volunteers (sign-ups, shifts, check-in, badges, and maps for the badges)
- **Section Lead** and **Station Coordinator:** run part of the day (their section's roster, or their station)
- **Directors** (band contests and festivals), **volunteers**, **parents and families:** join from links, no
  account needed (directors can save their details)
- **Field Command admins:** the admin dashboard (pilot pipeline, accounts, packages, emails) and demo mode

## Demo mode (admins)

An admin can view any event in each of its roles (Host, Volunteer Lead, Coordinator, Volunteer, Parent, a band or
group director, or a teacher and families for conferences), from Event settings, then More. The first time, the
event fills with made-up sample data for its kind:

- Every kind except conferences and meetings: three jobs with shifts and a dozen volunteers
- Band contests: six bands. Festivals: five groups and three rooms
- Fairs: eight booths across four zones
- School visits: 400 families (one to three children each, 14 teachers from Pre-K to 5th grade); one is the
  owner's own name, for demoing a license check at the door
- Conferences and meetings: about two of every three times booked
- Band contests, festivals, and fairs with the Sponsors add-on: nine sponsors with logos at four levels

Sample people are never emailed, and "Back to me" or "Remove demo people" takes it all back off.

## How we work

- **House rules for building:** `CLAUDE.md` (and `AGENTS.md`)
- **Words:** `docs/brand-voice.md` (no exclamation points, the Oxford comma, "organizer" for the role)
- **Design:** mock-ups, then the design review panel, then the owner's decisions, then building
  (`.claude/skills/design-review`). Decisions are logged in `docs/design-decisions/`; repeat findings in
  `docs/design-lessons.md`; the look in `docs/DESIGN.md`
- **Privacy:** rules live in the database and every rule has a security test (`supabase/tests/security_test.sql`).
  Deletion schedule and the district packet: `docs/DATA-PRIVACY.md`
- **Shipping:** each change is a pull request. After merging, the owner runs any new database update (a file in
  `supabase/migrations/`) in the Supabase SQL Editor (`docs/SETUP-GUIDE.md`)
- **Stack:** Next.js on Vercel, Supabase (database, sign-in, and file storage), Resend for email, Sentry for error
  alerts, Cloudflare Turnstile on public forms

## Recent changes (newest first)

Keep the last ten or so; older ones are in git history and `docs/design-decisions/`.

- 2026-11-14: This page
- 2026-11-12 (PR 372): School visit demos fill with 400 sample families
- 2026-11-12 (PR 371): Volunteer Leads can add a map for the back of volunteer badges, on the badge page
- 2026-11-12 (PR 370): Demo mode adds sample sponsors when the add-on is on; sample fair booths name only made-up
  businesses
- 2026-11-12 (PR 369): Fix: a volunteer job's first change (like a band check-in stop) never saved
- 2026-11-12 (PR 368): Sponsors add-on for band contests, festivals, and fairs
- 2026-11-11 (PR 367): Festival update: per-day schedules, door links for each room, Arrived / In / Done, live room
  pages, and director emails for schedule changes

## Open questions and what's next

See `docs/ROADMAP.md`. The biggest: how someone gets a plan after the pilot (self-serve checkout, a request form, or
"ask your Account Host"), then Stripe, the privacy policy and terms pages, and the data privacy agreements.

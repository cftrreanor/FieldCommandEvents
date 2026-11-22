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
| Volunteers and sign-ups (`volunteer`) | Jobs and shifts, things to bring, public sign-up (family members and under-18 helpers too), an optional "Sign-up opens" day (sign-up opens by itself that day, in the event's time zone; until then the public sign-up page shows the shifts read-only with spots left and a calendar reminder, the pages say "Volunteer sign-up opens Mon, Jan 4", and the organizer can open it now), reminders, a check-in desk with walk-ups, volunteer badges |
| Visitor registration and check-in (`school_visit`) | Parents register each child, teacher, and grade, with first and last name boxes for each adult; photo ID reminder; door check-in, each adult separately. Hosts and Co-hosts check names the app split (choosing from the likely splits; particles like van and de la stay with the last name), download a visitor list for the school's visitor system (one row per adult per child; new, corrected with the old name, and removed since the last download) and a class list, can mark an adult "Send to the front office" (the door shows an amber note instead of Check in; Hosts and Co-hosts can undo it there), and print or download the visitor check-in report, final after the event, then confirm "Our school has a copy" (undo until the deletion date). Volunteer Leads see families only from the day before through the event day (Coordinators on event day), never email addresses. Emails remind Hosts to save the report (morning after; Co-hosts of one event by day 7; a week before deletion). Families' and children's details and the report kept for 30 days after the event and deleted the next day (one date everywhere); names-free totals kept and shown on Parent Registration and the report afterward |
| School fair or fundraiser (`fair`) | Booths and partners by zone, partner check-in, a public "What's at the event" page, volunteer shifts with Coordinators (with the same optional "Sign-up opens" day, before fair day) |
| Parent-teacher conferences (`conference`) | Families book, change, or cancel a time; reminders; the teacher's meetings page. Free for teachers |
| Meetings (`meeting`) | Advisers, counselors, coaches, and club officers set their hours (one day or every week); anyone with the link books |

Every kind set up in steps follows `docs/event-setup-pattern.md` (one step bar, the same step pages, saving,
publishing, and words).

Volunteers can be added to band contests and festivals too (the "Jobs and shifts" or "Volunteers" area).

**Duplicate event** (every kind with jobs; the Account Host and Co-hosts of every event): a new draft on new dates
from New event ("Start from one of your events"), Event settings, Publishing and more, or a card on My events (only past
events and those within 4 weeks of their day). Meetings and visitor events can't be duplicated. Details, jobs, shifts,
things to bring, maps and documents, and contest or festival registration setup come over, every date moved by the
same number of days; never volunteers, bands, groups, or anyone's details. Every screen counts what comes over the same
way ("2 Coordinators (1 asked again)", "1 map or document"). A contest close to its day is warned before copying by
the two-week rule (registration should close two weeks before contest day), the same rule Band registration's deadline
box names. Dates typed into copied text (descriptions, job names, locations, and instructions, shifts, things to bring,
map and document names, information for directors, meal details and options, the contact for directors, rooms, zones)
are left as "[new date]"; grades, scores, times, links, numbers after "ages", "size", "table", "room", or "#", and a
piece called "March" after a grade or a count stay. Each box holding one has an amber border with its note under it. Each place is counted under the page where it's fixed
(map and document names under Maps and documents), with a ◆ on each Jobs and shifts tab that has one; the publish card
lists every place once, each step's Next goes to the next place, and publishing waits until none is left (checked in
the database too). Text that "[new date]" would push past its limit comes over whole and is listed to change by hand (its box always
shows, a job's Location included).
Copied steps say "Copied: check it" until opened. Coordinators come over as invitations in Team setup's Pending list,
emailed when the organizer publishes (checked in the publish window, which every Publish button on a never-published
copy opens) or with "Send invitation now" ("Not emailed yet · sent when you publish" waits with a neutral clock);
after publishing, the banner says only what happened to the event, and the amber card below Links to share names anyone
not emailed and lets the organizer send, change the email of, or remove each one ("Ana Silva removed. Undo", also at the top of Team
setup's Coordinators tab). Changing an email gives the invitation new link keys, so the old email's links stop working. People already
on the team who led a job are put straight on it. Drafts made by duplicating say "Copied from [event]" on My events
until published. Every event has a Description box on Details. Decisions: `docs/design-decisions/2026-11-20-duplicate-event.md`

**Organization page (organizer side):** one public page per account for its volunteer events and fairs, plus "Help
anytime" ways to help. Off until turned on from Account or My events (Organization page). Only the Account Host and
Co-hosts of every event can open it: turning on asks for the group's name (a person's name is refused), a contact
email, and which events show (nothing ticked to start; new events created after that start on); the preview is the
real page (its parts, the group's color and logo, only the ticked events that would show today) with "Turn on page"
inside. While on: Copy link and Preview, the name and contact each saved when you leave the box, a "Show on
organization page" switch per event with why any event isn't listed (locked ones look locked), "1 new event to review"
for events a Co-host of one event made (first on the My events and Account cards, with a Review link), Help anytime
(title, note, link made secure without tracking parts, end date, "Take off the page now" with Undo, ended ones kept to
show again, Remove with Undo), and Turn off. Someone who runs more than one account gets one card per account, each
naming its group, and the page picks the account (?org=). Each event's switch is also in Event settings, Publishing and more, and on the Publish step (read-only for
a Co-host of one event, with who to ask). Decisions: `docs/design-decisions/2026-11-20-organization-page.md`

**Organization page (public side):** `/o/[address]` shows the group's name and logo on its color, "Coming up" by month
(only months with events; the first two open, later ones folded rows that open when tapped), each row with a date tile,
the kind ("Volunteer event", "Fair or fundraiser", "Things to bring"), when and where, open spots, and one button; "Today"
and "Volunteer sign-up opens Mon, Jan 4" where true, "Happening now" in place of the button when its shifts are under way,
and "You're signed up · See your shift" on events this device holds; then Help anytime ("Open on amazon.com", new tab)
and the contact. Not listed by search engines (a noindex header; sign-up pages showing "More ways to help" ask the same);
when off, "This page isn't available" (404). On each volunteer sign-up page, while the page
is on: "Can't make this one? More ways to help from [Org]" (up to 3, soonest first, Help anytime filling a spare slot)
below the form, right under the note when every shift is full or sign-up is closed (shifts read-only behind "See the
shifts"), and "More from [Org]" after signing up; shifts already under way are left out. Tapping a shift there opens a
confirm step: details this device remembers for that group (email masked, phone shown as "Phone ending 0142"), or only
the missing fields plus a required "I'm 18 or older" with "Under 18? Use the full sign-up form", one Confirm button,
"Forget this device" under the privacy note (it asks first), and "just filled up. Nothing was saved." with the nearest
open shift if it filled. The full form from these links says "Signing up as…" and uses the remembered phone. Every
public event and organization page has one footer line: the product name and tagline

## Add-ons and packages

- **Packages** (names and prices are set on the admin Packages page, so check the app for current ones): Free,
  Free Teacher, Volunteer Command, Event Command, Schedule Command, and District Command, plus one-time event
  passes. Each package says which kinds of event it includes, team spots, and whether Volunteer tracking is in it.
  During the pilot every account gets Schedule Command.
- **Pricing page, admin side** (admin Packages page): a site-level "Pricing page: Hidden / Live" switch with
  "Preview the page" (going live confirms and lists what changes across the site; it can't go live with no package
  card); per package "Show on website", "Best for" (blank means the page writes one), and one "Recommended"; "Show
  on website" per pass; an editable "Weekly hours" row. Website switches save at once with Undo. Passes are named by
  kind of event ("Band contest pass") everywhere in admin. Requests from the page's buttons are listed at
  /admin/pricing-requests (count in the admin menu) to mark handled; the owner applies the package from the
  account's page and sends the invoice by hand (net 30, starts when sent). Decisions:
  `docs/design-decisions/2026-11-22-pricing-page.md`
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

- 2026-11-22 (PR pending): Pricing page, admin side: the Pricing page Hidden / Live switch with a confirm that lists what changes, Show on website, Best for, and Recommended for packages, Show on website for passes, an editable Weekly hours row, Undo on each website switch, passes named by kind of event, "One at a time" no longer amber, and a Pricing requests list to mark handled
- 2026-11-21 (PR pending): Organization page, public side: the page at /o/[address], "More ways to help" on volunteer sign-up pages (below the form, at the top when full or closed, "More from [Org]" after signing up), and a confirm step that carries remembered details over; "Sign up for more" is now "Add another shift here"
- 2026-11-21 (PR pending): Organization page, fixes from the built-page check: the confirm step asks "I'm 18 or older"; the group's color reaches 4.5:1 in dark mode on every event page; the turn-on preview is the real page; search engines are asked not to list the page or sign-up pages showing "More ways to help"; details carry over only within one group; started shifts are left out; "Take off the page now" with Undo; one card per account; clearer wording throughout
- 2026-11-21 (PR pending): Organization page, organizer screens: a new Organization page (from Account and My events) to turn the page on with a group name, contact email, and the events to show (with a preview), then manage each event's "Show on organization page" switch, new events to review, Help anytime, and turning it off; the same switch in Event settings and on the Publish step, where "When you publish" now says people find the event from your organization page when it's shown
- 2026-11-20 (PR pending): Volunteer sign-up can open on a set day (volunteer events and fairs): an optional "Sign-up opens" date on the Jobs and shifts step, the Publish step, Volunteer Setup, and Event settings' Publishing. Sign-up opens by itself that day in the event's time zone (no background job); before then the sign-up page, the event page, My events, the step bar, and Links to share say "Sign-up opens Mon, Jan 4", sign-ups, things to bring, and shift switches are refused, and the organizer can open it now. Duplicating moves the day, or leaves it blank if it would be past. After the light check: before the day the public sign-up page lists the shifts and things to bring read-only (no details form or buttons) with "Add a reminder to my calendar"; the day is set on the Publish step (not the Jobs step) and in Event settings, which has "Open sign-up now"; Clear on a live event asks first; a fair's day comes before fair day; moving the event's dates moves the day (or clears it, keeping sign-up closed); unpublishing or closing sign-up clears it
- 2026-11-20 (PR pending): Duplicate event: a new draft from any event with jobs, on new dates, from New event, My events (past and soon events), or Event settings; dates typed into copied text become "[new date]" and hold back publishing until filled in; Coordinators come over as invitations sent when you publish (or Send now); replaces "Start from a previous contest" and the festival copy. Also across the app: a Description box on every event's Details, confirm windows start on "Never mind" with one phone layout, capitals after "Now ·" and "Next:", and a Co-host of one event sees the real reason on Event settings' Publishing card
- 2026-11-19 (PR pending): Event details: on a multi-day event the times read "Daily start time" and "Daily end time" (the hours each day, which is how shifts and the event page use them), not first-day start and last-day end
- 2026-11-14 (PR pending): Visitor check-in follow-up fixes: one deletion date everywhere, kept totals after deletion, "Our school has a copy" can be undone, "Saved:" left where a checked name was, the safe choice first in the download warning, and "Let Ben check in" as a button
- 2026-11-14 (PR pending): Visitor check-in fixes from the built-page check: name choices with particles kept in the last name, one download button that follows what's changed, a soft amber door note with Let Ben check in for Hosts, report groups with the front office first, and "Our school has a copy"
- 2026-11-14 (PR pending): Visitor check-in report, visitor list, and front-office mark
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

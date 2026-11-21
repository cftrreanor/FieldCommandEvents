# Brief: more ways to help, and the organization page (kickoff, 2026-11-20)

From the owner's conversation with a PTO volunteer. Kickoff panel: all seven roles and the consultant, before anything
was drawn. Owner decisions: `docs/design-decisions/2026-11-20-organization-page.md`.

## The idea in one line
When a parent can't do the thing they were asked to do, show them something they *can* do, right then, with their
details already filled in. People want to be generous; friction (ads, accounts, hunting for a link, coming back later)
loses the yes.

## What the panel agreed on (all 8)
1. **Catch the "no" where it happens.** Parents arrive from a link to one event, on a phone. The win is on that event's
   sign-up page: when a shift is full, when sign-up is closed, and on "You're signed up". The organization page is the
   "See everything" behind that, not the starting point. Draw those states first.
2. **One tap from "can't" to a real open spot,** details carried over from the sign-up this device remembers. No second
   form, no account.
3. **Nothing goes public unless someone chose it.** The page is off until the organizer turns it on; each event is
   shown on purpose. Meetings, conferences, visitor days, and teacher accounts never appear. The rule lives in the
   database with security tests.
4. **Show only what someone can do now.** Open spots first; full or past things drop off; "Opens Dec 2" when not open yet.
5. **No names, no sponsors, no ads, no tracking** on the page. Leaving our site is said out loud ("Opens amazon.com"),
   plain links only, never affiliate codes, and we never handle money.
6. **No upkeep.** The page is built from what's already published; the organizer's job is a switch per event.
7. **A list by date, not a calendar grid** (phone, screen readers, 320 px and 200% zoom).
8. **"Notify me" waits.** It would be the first email list that outlives an event, and it breaks "we only email you
   about events you sign up for" (said in five places). Later, with double opt-in, a weekly digest at most, one-tap
   stop, and a deletion date.

## Risks to design against
- Private events leaking onto a public list (every published event is readable by anyone today; privacy is only "nobody
  has the link"). "Not on your page" must not be called hidden: "Anyone with the link can still open it."
- An account named after a person (blank account names fall back to the organizer's name; teacher accounts).
- A Co-host of one event listing their own event without the Account Host.
- A stale or empty page, or a block that pushes a parent's own sign-up down the page.
- Guilt wording ("Only 2 left", "Urgent", "Sorry"), and words that only fit schools.
- Name collisions: "calendar", "follow", "group", and "upcoming" already mean other things.
- Speed with 40+ events; search engines indexing a year of where children will be.

## Must-haves for v1 (proposed)
- **"More ways to help from [Org]"** on the volunteer sign-up page: below the shifts (never above), when a shift is
  full, when sign-up is closed (with the organizer's contact, not "contact the organizers"), and on "You're signed up".
  The 2–3 soonest open items, each one tap, then "See everything". Never lists the event itself.
- **The organization page:** the group's name and logo as the heading; "Coming up" grouped by date, each row with what,
  when, where, open spots in words, and one button in the kind's own words. The same look as event pages.
- **Organizer side, "Organization page":** turn on, preview, copy link, a "Show on our page" switch per event (Account
  Host and Co-hosts of every event; read-only with the reason for a Co-host of one event), and a line in "When you
  publish".
- **States:** page off, nothing coming up (with a contact), one event, a full year, happening now, all full, opens later,
  not shown, drafts never, database update not run (`missing()`).
- **Database:** a narrow function that returns only what the page shows; kinds allowlisted; per-event and per-account
  switches; security tests. Not indexed by search engines. The account's existing web address.
- **Measure without tracking:** count sign-ups that came from these links, with no names. Success: 10% or more of a
  PTO's sign-ups over a month.

## Words (Content Manager)
"Organization page" in the app; the group's name on the public page, with "Events and ways to help from [Org]";
sections "Coming up" and "Help anytime"; "Can't make this one? More ways to help from [Org]"; "More from [Org]" after
signing up; facts, not pressure ("3 spots open").

## Reuse
`organizations.slug`, logo and color (`src/lib/event-brand.ts`, generalized to the account), `EventHeaderBar`,
`EventHeading`, `Card`, the volunteer page and its `Confirmed` card (`src/app/e/[slug]/volunteer/`), the remembered
sign-up and My volunteering (`src/app/my/`, `src/lib/volunteer-pass.ts`), `event-types.ts` words, the fair's section
chips, `https`-only link rules from sponsors, the bot check, `missing()`.

## Questions for the owner
Timing against the plan path and Stripe; which kinds and whether events start shown; ongoing ways to help (wish lists,
drives) in v1 or later; and the rest as recommended (Notify me later, not indexed, the existing address, one page per
account, no sponsors, every package).

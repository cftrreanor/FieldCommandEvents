# Design review: the public pricing page (built, before the PR)

| | |
|---|---|
| **What was reviewed** | The built public page (nothing picked, one kind picked, three kinds picked, phone compare, FAQ), the request form (signed out, Account Host, sent), Ask your Account Host (and sent), admin Packages (grid, Best for editor, go-live dialog, switch with Undo, live blocked with no cards), admin Pricing requests, and states (no price, hidden with admin preview, public 404, prices can't be read) |
| **Stage** | Screenshots before the PR, checked against `docs/design-briefs/2026-11-22-pricing-page.md` and the owner's decisions |
| **Size** | Light check: UX Designer, UI Designer, UX Content Manager, Software Engineer, and the consultant |
| **Date** | 2026-11-22 |
| **Not reviewed** | Card checkout and invoices (a later project), the in-app Plan page, tax |

Screenshots: `docs/design-reviews/2026-11-22-pricing-built/`.

## The consultant's verdict

Ship after fixes. The page is honest and clear: words in every cell, "Ask about" and never "Buy", "Nothing renews or
charges on its own" where people decide, a solid phone compare view, and a careful go-live switch. The one change that
would help most: make the cheapest-option lines honest about what a pass covers.

## Blocks people (severity 3–4)

### 1. The cheapest option oversells passes · severity 3 · found by 3 of 5 (UX, Content, consultant)
- **Where:** the summary under "What are you running?" (1b, 1c); `cheapestChoices` in `src/lib/pricing.ts`,
  `choiceWords` in `src/app/pricing/pricing-client.tsx`
- **What happens:** a mix of single-event passes on Free gets the green "Lowest price that includes what you picked"
  badge, weighed against a full year of a package. "Schedule Command plus a … pass: $210 a year" adds a yearly price to a
  one-time pass. Only two choices are shown, so a real in-between fit (Volunteer Command plus one visitor pass) can be
  missing, and "one at a time" isn't mentioned where Free only covers that.
- **Who it hurts:** the PTO president skimming in the car line, a front office that checks visitors in every day, and a
  band director running two contests
- **Standard:** heuristic 2 (match with the real world), heuristic 5 (error prevention); claims guardrails
- **Suggested fix:** say "for one event" on every pass option; keep yearly and one-time apart ("$60 a year, plus $150
  for one contest"); add "one at a time" where that's all a package covers; the badge says "Lowest price for one of
  each" when it uses passes; drop options that cost more without adding anything picked; allow a third choice; give the
  line its own button
- **Decision:** _see the decisions log_

### 2. After January 1 the home and conferences pages still promise the pilot · severity 3 · found by 1 of 5 (Content)
- **Where:** `src/app/page.tsx` (hero button "Join the pilot", the pilot note, the pilot section, the closing band) and
  `src/app/parent-teacher-conferences/page.tsx` (buttons "Free during the pilot", the join section, the page title)
- **What happens:** the page goes live in January, after the pilot. The header would say "Get started" while the body
  still offers a free pilot that has ended, and the go-live dialog tells the owner these lines switch when they don't.
- **Who it hurts:** organizers deciding to buy, and the owner
- **Standard:** claims guardrails; same thing, same word
- **Suggested fix:** switch these lines after the pilot ends ("Get started", "Start free", "A person on our team replies
  within a day to help you get set up", a conferences title without "pilot"), and point the conferences FAQ's weekly
  hours answer to the packages page once it's live
- **Decision:** _see the decisions log_

## Should fix (severity 2)

- **Admin counts 5 passes; visitors see 4** (4 of 5): the Volunteers and sign-ups pass is left out because Free
  includes it. Count the passes the page shows, and say why under that pass.
- **The sent screen keeps the form's heading and instructions** (4 of 5): make the heading "Request sent", drop the
  intro, and keep "Nothing is charged until you choose a package".
- **Signed-in people can read hidden prices** (Engineer): anyone who signs in can read every package, monthly prices,
  and hidden packages through the data connection. Admins only.
- **"Ask your Account Host" can send unlimited emails** (Engineer), even while the page is hidden, and can name a hidden
  package. Once a day per person and package, only shown packages, only when live. Add an optional note, and say what
  was sent (consultant).
- **A second request within the hour is dropped** (Engineer) while the page says thanks; one script can block everyone
  for an hour. Duplicates by email and item; a per-email limit; past the overall limit, still save the request.
- **A team member who isn't the Account Host can tie a request to the account** (Engineer). Mark it "Not the Account
  Host" on the request.
- **Requests don't show the account's current package** (consultant): "On now: Event Command".
- **Lists of kind names are hard to read** (Content, UI): "Doesn't include 2 of your picks: …", "1 package includes all
  3: Event Command", "Packages that include everything you picked", and Best for lines written with short names
  ("volunteer sign-ups", "band contests", "festivals").
- **Weekly hours promises conference days** on packages without conferences (Content, consultant); the table says
  which kinds.
- **Picks are lost on Back** (UX): keep them in the address.
- **The cheapest option has no button** (UX, consultant).
- **Passes are far below the fold on phones** (consultant): a line under the chooser, "Running just one event? Passes
  start at $[lowest]".
- **"Who qualifies" leaves the form and loses what was typed** (consultant): show it in place.
- **The compare table's column names scroll away on a laptop** (UI): keep the top row in place.

## Polish (severity 1)

One name for the page in sentences ("packages and prices"); the home FAQ answers with the starting price and a link;
"Check" not "Tick"; quote “one at a time”; a shorter "One at a time" key; "Not sure? Choose “Not sure yet” and tell us
below"; "Get this pass" on pass buttons; "Sent to Dana. They'll get an email…"; "All kinds of events" in the header;
admin: quote button names, "Make recommended", a quieter empty Best for box, plural kind names, quiet notes when a
package looks odd (same contents or costs more for less); the preview banner links to admin; request "find it" links
to admin search; card tops on one row; a "Try again" button and a request link when prices can't be shown; bigger tap
targets for small links; inset panels visible in light mode; the dark-mode switch knob; Undo never covers a control;
ask before showing a package with no price on a live page; the teacher box says it's for an account in your own name;
one shape for the kind choices; a $0 price shows "Ask us"; the "plan isn't active" message built from the data; the
last card can't be retired off a live page; the page switch clears its cache tag; more security tests.

## What's working well

- Words in every cell; "One at a time" in neutral type; yearly first; "Ask us" never $0
- Cards built from the data: "Everything in X, plus" only when it's true
- The chooser marks matching cards in words, announces its result, and regroups matches first on phones
- The request form carries over picks, doesn't re-ask signed-in people, and shows the teacher box only where it applies
- The go-live dialog, preview banner, Undo, and the block on going live with no cards
- A careful migration: the owner's switches survive a re-run, the page fails closed, upgrade messages never name a
  hidden or retired package, and every email escapes what people type
- Reflow at 320 px, dark mode on every screen, 44 px tap targets on buttons

## By role

- **UX Designer:** the cheapest-option line (3), the admin pass count, picks lost on Back, the far-off button.
- **UI Designer:** nothing blocking; the sticky table header, the sent screen, and visual polish in admin.
- **UX Content Manager:** the pilot wording after January 1 (3, only they raised it), hard-to-read kind lists, the
  weekly hours line, one page name.
- **Software Engineer:** nothing blocking; hidden prices readable when signed in, email and request limits, who a
  request is tied to.
- **Consultant:** ship after fixes; the cheapest-option line (3), passes below the fold, "Who qualifies" losing typing,
  the current package on requests.

## Limits

This is an AI review, not testing with real people. Before January, have two or three real organizers (a PTO
president, a band director, a front office) use the chooser and read the cheapest-option line.

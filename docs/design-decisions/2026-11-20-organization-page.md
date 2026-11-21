# Decisions: more ways to help, and the organization page (2026-11-20)

Brief: docs/design-briefs/2026-11-20-organization-page.md (kickoff panel, all seven roles and the consultant).

| # | Question | Decision | Notes |
|---|---|---|---|
| 1 | Timing against the plan path and Stripe (pilot ends Jan 1) | Owner: **build now** | Against the Product Manager's advice to settle the plan path first; mock-ups, one review against the brief, then build |
| 2 | Which kinds, and do they start shown | Take the advice | Volunteer events and fairs only. The page is off until turned on; turning it on asks which events to show; new ones then start ticked, with a switch to take each off. Meetings, conferences, visitor days, band contests, festivals, and teacher accounts never appear. Enforced in the database |
| 3 | Ongoing ways to help in v1 | Take the advice | A simple "Help anytime" list: title, note, optional https link (shows its site), end date so it drops off; no counts |
| 4 | Everything else | Take the advice | "Notify me" later (it would change the email promise); not indexed by search engines; the account's existing web address; one page per account; no sponsors; included in every package |

## Mock-ups checked against the brief (2026-11-20)

Review: docs/design-reviews/2026-11-20-organization-page-mockups.md (full panel). Ten findings rated 3, each with a clear
fix. Owner decisions:

| # | Question | Decision | Notes |
|---|---|---|---|
| 1 | Order on the public page | Take the advice | **Coming up first**, then Help anytime; a chip at the top jumps to Help anytime |
| 2 | "Opens later" | Owner: **add the date now** | An optional "Sign-up opens" date for volunteer events and fairs (on the Publish step and the volunteering step), worked out in the event's time zone with no background job, like band registration's opening day. Sign-up opens by itself that day; the page and the block show "Volunteer sign-up opens Mon, Jan 4" until then. Its own first PR. Reverses the Product Manager's and Product Owner's advice to leave it out of v1 |
| 3 | Who controls the page | Owner: **the Account Host and Co-hosts of every event** (`is_org_admin`) | Turn on or off, group name, contact email, which events show, Help anytime. A Co-host of one event sees their event's switch read-only |
| 4 | Everything else | Take the advice | Every severity 3 fix: a group name box at turn-on (required when it matches a person's name), the web address set from it at turn-on and then kept; no personal email on the closed note (page contact, or a typed reply-to, never the sign-in fallback); a Co-host of one event's events start off the page with "1 new event to review"; the switch changed only through a database function; a first-time parent gets the same confirm card with name, email, and phone; full and closed states put the block right under the note (shifts read-only behind "See the shifts", no form); a failed save snaps back with the true status; save status on its own line; the confirm step with its own action and invisible bot check; "Phone ending 0142"; the "When you publish" line made true. Every severity 2 and 1 fix as written, including a names-free daily count of sign-ups by source, shown in Admin only |

## "Sign-up opens" date, built: light check (2026-11-20)

Review: docs/design-reviews/2026-11-20-signup-opens-built.md. Four findings rated 3, each with one clear fix (the
public form before the day, Clear on a live event, a hidden day on copies, a fair's day that never comes); fixed as
written, with every severity 2 and 1 item, under the owner's standing "all as recommended" for this feature. Added: an
"Add a reminder to my calendar" link on the public pages before the day (a calendar file, no email), as the consultant
suggested. Notify me stays later.

## Updated mock-up (2026-11-21)

Owner, after seeing the updated public page (`docs/design-reviews/2026-11-20-organization-page-mockups-2/`):
- **Drop "Show later months".** Later months are folded rows ("January · 4 events") that open when tapped; nothing else.
- **A month with no events doesn't show at all**, open or folded. "The next two months open" means the first two months
  that have events.

## Built pages: light check (2026-11-21)

Review: docs/design-reviews/2026-11-21-organization-page-built.md. Three findings rated 3, each with one clear fix
(the confirm step asks "I'm 18 or older"; the group color's dark-mode contrast; a preview built from the real page);
fixed with every severity 2 and 1 item under the owner's standing "all as recommended". Also fixed: the turn-on rule now
says "New events you create from now on start on your page", which is what the database does.
- **Search engines (owner):** when "More ways to help" shows on a volunteer sign-up page, that page asks search engines
  not to list it (noindex). The organization page sends a noindex header and is no longer blocked in robots.txt, so
  search engines can read that header.

# Duplicate an event (2026-11-20)

Owner request (from a retrospective after a call with a user): a "Duplicate event" action for hosts that copies the
event's details, jobs, shifts, things-to-bring items, and Coordinator assignments into a new draft; never volunteer
sign-ups or any volunteer's personal details. The host picks the new dates while duplicating, and every shift moves by
the same amount. Coordinators on the copy get a fresh invitation email only once the new event is published. Show where
the action appears for hosts and co-hosts, and confirm the database's privacy rules still apply to the copy.

Found before designing: band contests and festivals already "start from a previous" one (copy_band_contest_setup,
copy_group_event_setup), copying jobs, shifts, and things to bring with dates moved, but not Coordinators. Volunteer
events and fairs have no copy.

Owner decisions before the mock-ups:
- **Kinds:** every kind with jobs (volunteer events, school fairs, band contests, festivals). Band contests and festivals
  also bring their registration setup, so one consistent action replaces "start from a previous".
- **Who:** the Account Host and Co-hosts of every event (the people who can create events). A Co-host of just one event
  sees "Ask [Account Host] to duplicate this event" instead.
- **Coordinators:** copied as invited for the same jobs, not active. When the new event is published, each gets a fresh
  invitation email; they have no access to the new event until they accept. The host can remove anyone before publishing.

## Full panel on the mock-ups (2026-11-20)

Review: docs/design-reviews/2026-11-20-duplicate-event-mockups.md. Owner decisions:

| # | Finding | Severity | Decision | Notes |
|---|---|---|---|---|
| 1 | Hard to find; New event path removed | 3 | Owner: **three places** | New event: "Start from one of your events" for every kind with jobs; My events: "Duplicate" on each event's row; Event settings keeps its panel. All open the same page, named "Duplicate event" everywhere |
| 2 | "Done" and "Everything is set up" on the copy | 3 | Take the advice | Copied steps show "Copied: check it" until opened; a short checklist with links (description and dates in it, maps and documents, reply settings; contests: fee, payment link, meal price) |
| 3 | Contest after copying not designed | 3 | Take the advice | Drawn in round 2, with a deadline left blank or in the past |
| 4 | Publish window vs "open sign-up later" | 3 | Take the advice | Two versions of the sentence, button, and success message |
| 5 | No held-until-publish invitation | 3 | Take the advice | Held state: can't be accepted, no Copy link, 30 days start when sent, deleted with its job, tested |
| 6 | Team spots and plan limits | 3 | Take the advice | Held invitations don't count until sent; the copy never fails because of Coordinators; states for no-Coordinators plan and full team; publish as the signed-in person, then send |
| 7 | Lock the copy function down and prove it | 3 | Take the advice | `is_org_admin` only; always a draft with sign-up closed; named columns; replaces the two old copy functions; security tests (who may duplicate, nothing personal copied, a copied Coordinator can't see the copy before accepting, publishing still checks the plan) |
| — | Maps and documents | 2 | Owner: **copy them** | They're the organizer's own files with no volunteers' details; hidden until the copy is published, as files are today |
| — | Copied Coordinators asked early | 2 | Owner: **add an optional "Send now"** (with a confirm) | Changes the original request's "only after publish" for those the organizer chooses. Default stays "sent when you publish". Someone who accepts early can see the draft as a Coordinator; there are no volunteers on a draft |
| — | All other severity 2 and 1 findings | 2/1 | Take the advice | As written in the report: no Coordinator checkboxes on the Duplicate page (decided in the publish window); one status ladder ("Not emailed yet · sent when you publish", "Invitation sent [date]", "Accepted"); "If you can't help this time, let [host] know"; "discard this copy" for whoever made it, never published, nothing on it; one transaction with a request id; shift list closed by default; "Volunteers aren't copied" wording; festivals bring rooms; account members copied straight on as Coordinators; source invitations never accepted don't come over; the wording and layout fixes |

Next: round-2 mock-ups of the changed parts, a light check, then build.

## Round 2: light check (2026-11-20)

Review: docs/design-reviews/2026-11-20-duplicate-event-mockups-2.md. Three findings rated 3 (the contest copy with future
registration dates not drawn; an early invitation expiring unseen; the publish window silent about unchecked copied text).
Owner decision: **all as recommended, build.**
- Contest copied with registration still ahead: Coordinators are emailed at publish; the window and button name the
  scheduled opening.
- An early "Send now" invitation that expires before publishing: "Invitation expired · Send again", and the publish window
  offers it again, ticked.
- The publish window lists copied steps nobody has opened, quoting old dates found in the copied text; publishing stays
  allowed.
- Every severity 2 and 1 finding as written in the report, including: the step bar stays the one tracker ("Opened", not
  "Done", until saved or confirmed; the note's items are plain links); "Keep it a draft" disabled while publishing;
  success messages name anyone not emailed, with a line on the event page; a freed team spot doesn't send on its own;
  festivals built the same way (rooms, minutes per group, and walking time come over); the wording and layout fixes.

## Built pages: light check (2026-11-20)

Review: docs/design-reviews/2026-11-20-duplicate-event-built.md (UX, UI, Content, Product Owner, Software Engineer,
consultant). Three findings rated 3. Owner decisions:

| # | Finding | Severity | Decision | Notes |
|---|---|---|---|---|
| 1 | Opening a step clears its old-date warning | 3 | Owner: **fix it differently** | The owner's intent: everything comes over except volunteers, personal details, and dates. Structured dates still move to the new first day the organizer picks (owner confirmed). **Old dates typed into copied text (descriptions, shift and job notes, things to bring, director information, and the like) are blanked while copying and replaced with a marker, "[new date]".** The step shows "Add the new date" until every marker is filled in, and publishing waits until then (every publish path). Replaces round 2's "publishing stays allowed" for old dates |
| 2 | Other publish buttons skip the copy's publish window | 3 | Take the advice | Until a copy is first published, every Publish button (event page, Jobs and shifts, Band or festival registration, Event settings) opens the same window with ticks for who gets emailed |
| 3 | The Coordinator list can show the name of anyone with an account | 3 | Take the advice | A name only once they accept or when they're already on this account's team; otherwise the email. Security test |
| — | The "[Step] looks right" link (added in building, not in the mock-ups) | 2 | Owner: **remove it** | Opening a copied step checks it off ("Copied: check it" → "Opened"); "[new date]" markers are the remaining check |
| — | All other severity 2 and 1 findings | 2/1 | Take the advice | As written in the report. Kept from earlier decisions: "If you can't help this time, let [host] know" in the email (no decline link yet); the short message after publishing plus the line that stays on the event page; "Email settings, not copied" in the note |

By the routing rule, the fixes get a light check from the roles that raised findings plus the Product Manager and
Marketing Manager.

## Built pages, after fixes: follow-up check (2026-11-20)

Review: docs/design-reviews/2026-11-20-duplicate-event-built-2.md (all seven roles and the consultant). Two findings rated
3, both with clear fixes. Owner decisions:

| # | Finding | Severity | Decision | Notes |
|---|---|---|---|---|
| 1 | A job's old Location can block publishing for good | 3 | Take the advice | Location (no longer shown on the job form) is never a "[new date]" place for these kinds, or the box shows when it holds one; a test |
| 2 | Long text can stop duplicating with only "Try again" | 3 | Take the advice | A marker never pushes text past its limit; a field that still doesn't fit is named; a test |
| — | A contest close to its day: three deadline rules | 2 | Owner: **the two-week rule** | Both screens say registration should close two weeks before contest day; the Duplicate page says plainly when that's already past or leaves a day or so, before copying |
| — | Duplicate event on every My events card | 2 | Owner: **past and soon** | On past events and events within a few weeks of their day; always in Event settings and on New event |
| — | Description box on Details | 2 | Owner: **every event** | Details always has a Description box (it was missing for every event) |
| — | All other severity 2 and 1 findings | 2/1 | Take the advice | As written in the report: one list of "[new date]" places, each under the page where it's fixed; ◆ on Jobs tabs; "place" not "spot"; date patterns fixed (grades, scores, "march", names, links) and widened ("7 November", ISO dates, job and room names); the privacy promise made true (counts only in the summary, removals cleared daily); Remove on the "wasn't emailed" card; re-adding a removed Coordinator says it emails them now (and isn't offered while Undo works); a same-day date allowed with a warning; the smaller items |

### Built as decided (follow-up fixes, 2026-11-20)

- **A job's old Location:** the job form shows the Location box whenever it holds "[new date]" (kept for that visit),
  so every marker sits in a box the organizer can reach. Location is still marked and counted (band contests and
  festivals show it to volunteers).
- **Length limits:** "[new date]" never pushes text past its limit. When it would, the text comes over whole (nothing
  cut) and is listed as a place to change by hand, until that field changes.
- **My events:** "Duplicate event" on past events and those within 4 weeks of their first day.
- **Can't be duplicated:** meetings (and parent-teacher conferences) and visitor events. They have no jobs to copy;
  the Duplicate page says so if reached, and they have no Duplicate panel or card.
- **The old copy functions** (copy_band_contest_setup, copy_group_event_setup) can't be called by anyone signed in;
  nothing in the app calls them.

### Success measures

Checked a month and a season after launch (from event_copies and events; no personal details needed):

- The share of new events (of kinds with jobs) started as copies
- The median time from duplicating to publishing the copy
- The share of copies deleted with "Delete and start over"
- The copied-Coordinator acceptance rate: invitations that came over with a copy and were accepted, of those sent


## Final check on the changed screens (2026-11-20)

Review: docs/design-reviews/2026-11-20-duplicate-event-built-3.md. Four findings rated 3 were bugs in the code with
one possible fix each (invitation keys kept on Change email, delivery times missing for invitations already sent, the
confirm window's focus, an unreachable long Location). Fixed as the review says, under the owner's standing "all as
recommended" for this feature. Severity 2 and 1 fixes as written, except "Duplicate event" on every My events card,
which stays as the owner decided (past events and those within four weeks).

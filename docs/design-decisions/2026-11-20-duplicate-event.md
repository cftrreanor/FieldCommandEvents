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

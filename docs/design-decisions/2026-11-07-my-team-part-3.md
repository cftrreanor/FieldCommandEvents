# Decisions: My team, part 3 (2026-11-07)

Review: docs/design-reviews/2026-11-07-my-team-part-3-mockups.md

| # | Finding | Severity | Decision | Notes |
|---|---|---|---|---|
| 1 | The hand-on window doesn't say it's one-way | 3 | Take the advice | Say plainly: you can't take it back, the new Account Host could remove you, and getting and renewing the plan moves to them; the same on the co-host's side; button "Offer Account Host role…" |
| 2 | An offer stays open after its co-host leaves or is removed | 3 | Take the advice | The database cancels it; the remove and stop windows say so |
| 3 | Undo promises emails it can't send | 3 | Take the advice (a) | Removal emails go out as now; Undo sends a short "never mind" to everyone who was emailed, recorded at removal |
| 4 | Undo's database design | 3 | Take the advice | Only the remover, within 10 minutes, all or nothing, remover still has the right, not if re-invited, the team limit, jobs and email sender restored; tests |
| — | Clearer Undo | 2 | Take the advice | End time shown and removed when it passes, one Undo per removal, a note that stands out, focus moved to it, wording for one role or several |
| — | Offer status and follow-up | 2 | Take the advice | Badge, Resend, emails when withdrawn or replaced, a note on My team when accepted, declined, or expired |
| — | Offer page polish | 2 | Take the advice | Sign-in context, the real reason an offer closed, a full-size next step, a success mark, one Accept label |
| — | Successor not a co-host yet | 2 | Later, then built | A hint under Hosts (in the "It's just you so far" card when there are no co-hosts); see the follow-up below |
| — | Database hardening (locks, offer by token, time zones, readable errors, tokens server-side) | 2 | Take the advice | Part of building it right |

## Light check of the built pages (2026-11-07)

Review: docs/design-reviews/2026-11-07-my-team-part-3-light-check.md. No severity 3 or 4.

| # | Finding | Severity | Decision | Notes |
|---|---|---|---|---|
| 1 | When Undo runs out, the rows still point to it; notes made hours apart share one Undo; where focus goes | 2 | Take the advice | Page refreshes when time's up; one note per removal; focus moves to the note (no double read-out), and to the page heading if it was on Undo when it ended |
| 2 | Who pays after handing on, and "You can't take this back" next to Withdraw | 2 | Take the advice | "The plan stays as it is until it ends. After that, renewing it is up to …" in the window, offer page, note, and email; "Once … accepts, you can't take it back" |
| 3 | How the last offer ended is easy to miss | 2 | Take the advice | A tinted note at the top, name in bold |
| 4 | After undoing a co-host's removal, screens say their offer ended because they left | 2 | Take the advice | Says it ended when they were removed for a moment |
| 5 | Engineering: a second Accept emails twice; Withdraw acts on whatever is open; offer page shows details on old links; missing tests | 2 | Take the advice | Accept again changes nothing and emails nobody; withdraw and decline name which they mean; offer page shows details only while open, never a full email; 6 new security tests; Undo is one person at a time; the database returns an offer's id, not its token |
| 6 | Dark mode has no grey for supporting text | 2 | Keep as is | The site-wide rule (docs/DESIGN.md: dark mode has no grey text) stays; My team sets lines apart with bold names and tinted notes instead |
| — | Smaller wording and polish (Decline…, one date format, one-sentence offer headline, sign-in line, "See your plan", email wording, "No Coordinators yet") | 1 | Take the advice | |
| — | Lock order, phone button layout | 1 | Later, then built | See the second follow-up below |

## Follow-up: the "Later" items (2026-11-07)

The owner asked to build them: a hint for passing the account to someone who isn't a co-host yet,
a 10-minute wait between offer emails (`20270121000000_offer_resend_limit.sql`), and "Undo ends in
under a minute" in Undo's last minute. Light check (UX Designer and UX Content Manager), no
severity 3 or 4. Screenshots 15–17 in `docs/design-reviews/2026-11-07-my-team-part-3-built/`.

| # | Finding | Severity | Decision | Notes |
|---|---|---|---|---|
| 1 | The hint is bolder than the explanation above it, on every visit | 2 | Take the advice | Muted text with a bold question; in the "It's just you so far" card when there are no co-hosts |
| 2 | The hint doesn't say what happens to you | 2 | Take the advice | "They take over the plan, and you stay on as a co-host" |
| 3 | Resend too soon looks like an error | 2 | Take the advice | A calm message, "Already sent … You can send it again in about N minutes" (no clock time, so no time-zone mix-up) |
| 4 | Resend wording and when the spam tip shows | 2 | Take the advice | Spam tip after a resend that worked too |
| 5 | "Handing on" wording, a button named mid-sentence | 2 | Take the advice | "Passing the account to someone new? Choose Offer Account Host role on their row" |

## Follow-up: lock order and the offer row's buttons (2026-11-07)

- **Lock order:** accepting an offer now locks the account's member rows before the offer, the same
  order as making an offer and removing a co-host, so they can't deadlock
  (`20270122000000_handoff_lock_order.sql`). A test covers an offer from someone who is no longer
  the Account Host. (The old version also tried to mark that offer "replaced" just before raising
  the error, which the error undid; that line is gone.)
- **Offer row:** light check (UX Designer, UI Designer, consultant), no severity 3 or 4.

| # | Finding | Severity | Decision | Notes |
|---|---|---|---|---|
| 1 | On phones the offer's buttons and Remove… still read as one wrapped row | 2 | Take the advice | The offer is its own tinted block in the row: its line, then Resend email and Withdraw offer… |
| 2 | The offer line was joined onto the email and access line | 2 | Take the advice | Its own line, inside the block |
| 3 | "Resend email" button's name for voice control didn't contain its visible words | 2 | Take the advice | "Resend email: {name}" |
| 4 | Remove… is reached last with Tab on desktop | 1 | Keep as is | The left column (the person and their offer) reads first |

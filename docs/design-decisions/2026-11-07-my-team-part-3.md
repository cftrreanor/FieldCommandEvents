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
| — | Successor not a co-host yet | 2 | Later | Not in this part |
| — | Database hardening (locks, offer by token, time zones, readable errors, tokens server-side) | 2 | Take the advice | Part of building it right |

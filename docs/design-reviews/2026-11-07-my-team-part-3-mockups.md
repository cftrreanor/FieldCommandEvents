# Design review: My team, part 3 (mock-ups)

| | |
|---|---|
| **What was reviewed** | Mock-ups (the real components with sample data) of Undo after removing someone, and handing on the Account Host role: 12 screens |
| **Stage** | Mock-ups before building |
| **Size** | Full panel: Product Manager, Product Owner, UX Designer, UI Designer, Software Engineer, UX Content Manager, Marketing Manager, usability consultant |
| **Date** | 2026-11-07 |
| **Screenshots** | `docs/design-reviews/2026-11-07-my-team-part-3-mockups/` (72: phone, tablet, desktop, light and dark) |
| **Not reviewed** | The rest of My team (shipped in #340 and #341) |

## The consultant's verdict

Build after fixes. Both features are sound and mostly well written: each window says what changes, Undo sits where people look, and every state of the offer page is covered. The handover window plays down the one change that can't be reversed. The Undo note is static text with a time limit, and keyboard users have to hunt for it. The change that would help most: say plainly in the hand-on window that once Priya accepts, Dana can't take the role back herself and Priya could remove her.

## Blocks people (severity 3)

### 1. The hand-on window doesn't say it's one-way · 6 of 8
- **Where:** Make Account Host window (02); the same gap on the offer card (05), the offer page (08), and the offer email.
- **What happens:** the window says "You become a co-host, with the same access to every event as now". It leaves out three things:
  - Dana can't take the role back.
  - Priya, as Account Host, could remove Dana.
  - The Account Host is the one who gets and renews the plan (`src/lib/plan.ts`), so that moves too.
- **Suggested fix:** add "You can't take this back. Only Priya could offer it to you again, and as Account Host they could remove you as a co-host" and "Priya will get and renew the plan". Say the same on the co-host's side.
- **Decision:** _Waiting for the owner_

### 2. An offer stays open after its co-host leaves or is removed · 2 of 8
- **Where:** removing a co-host, or "Stop being a co-host"; the offer link.
- **What happens:** the offer isn't cancelled. The link still shows "Accept". If the person is invited back within 14 days (or put back by Undo), the forgotten link would hand over the whole account.
- **Suggested fix:** the database cancels any open offer when that co-host is removed or leaves, with a test. The remove and stop windows say "This also ends the Account Host offer".
- **Decision:** _Waiting for the owner_

### 3. Undo promises emails it can't send yet · 3 of 8
- **Where:** the Undo note ("lets anyone we emailed about it know"), `undoRemoval`.
- **What happens:** nothing records who was emailed about a removal, so nobody can be told it was undone. The Product Manager suggests holding removal emails until the 10 minutes pass. The Software Engineer notes that needs a job running every few minutes, and today there's only a daily one.
- **Options:**
  - (a) send a short "never mind" email to everyone who was emailed (recording who that was);
  - (b) hold removal emails for 10 minutes (needs a frequent job);
  - (c) drop the promise.
- **Decision:** _Waiting for the owner_

### 4. Undo's database design · Software Engineer
- **What happens:** a removed Coordinator's jobs are deleted before the removal is recorded, so Undo can't give them back. Undo is also the only way onto a team other than an invitation, so the database has to enforce every rule:
  - only whoever removed them, within 10 minutes by the database clock;
  - all or nothing;
  - the remover still has the right;
  - not if they were re-invited in the meantime;
  - the team-spot limit;
  - jobs and the email-sender setting restored.
  Each rule needs a test.
- **Recommendation:** build it this way. It's what makes "puts them back, with their jobs" true.

## Should fix (severity 2)

**Undo**
- Show when Undo ends ("until 4:52 PM") and remove it when the time runs out (6 of 8).
- One Undo per removal, not three (6 of 8).
- Make the note stand out, and move focus to it after a removal (3 of 8).
- Word it for one role or several (4 of 8).

**Offers**
- A badge on a waiting offer (4 of 8).
- Resend the offer email (2 of 8).
- Rename the button "Offer Account Host role…" (Content Manager).
- Use "Keep the offer open" instead of "Not now" next to Decline (5 of 8).
- One Accept label, plus a confirmation of what changed after accepting (5 of 8).
- Tell the co-host when an offer is withdrawn or replaced. Show the Account Host when an offer is accepted, declined, or expires (4 of 8).

**The offer page**
- Say who it's from, and which email to use, on the sign-in step (5 of 8).
- Name the real reason an offer closed (4 of 8).
- A full-size next step on every state (5 of 8).
- A success mark when accepted (UI Designer).

**When the successor isn't a co-host yet,** which is the usual case at PTO turnover: a hint, and optionally "offer the role once they join" (Product Manager).

**Database and code (Software Engineer)**
- Lock the Account Host's row while making and accepting offers.
- Withdraw or decline one specific offer, not whatever is open.
- Dates in the right time zone.
- Messages that aren't turned into "You don't have permission".
- Keep offer tokens on the server.
- Tests for each.

## Polish (severity 1)

- Consistent "…" on buttons that open a window.
- Ending "Make Account Host…" on every row (a once-a-year action).
- The logo position on the offer page.
- The co-host window's dark-mode edge (the app's shared confirm window).
- Measures to tell if this works.
- A line for co-hosts whose Account Host is gone.

## What's working well

- "Nothing changes until they accept", said everywhere it matters; one offer at a time, enforced in the database.
- One Undo note per person, naming every role removed; Undo limited to your own removals.
- The co-host can answer from the email or on My team; the offer page covers every state; honest "the email didn't go out" fallback.
- Calm, on-brand words; 44 px buttons; dark mode readable throughout.

## Limits

An AI review of mock-ups, not testing with real people. Before launch, have two or three Account Hosts hand the role to a co-host and undo a removal on a phone.

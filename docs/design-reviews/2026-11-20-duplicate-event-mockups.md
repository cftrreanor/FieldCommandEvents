# Design review: Duplicate event (mock-ups)

| | |
|---|---|
| **What was reviewed** | Nine mock-up boards: Event settings with the Duplicate event panel (Account Host; Co-host of one event), the Duplicate event page and its states, the new draft, Coordinators on the draft, publishing the copy, the Coordinator's invitation email, a second way in ("Run it again"), and a band contest |
| **Stage** | Mock-ups before building |
| **Size** | Full panel: Product Manager, Product Owner, UX Designer, UI Designer, Software Engineer, UX Content Manager, Marketing Manager, usability consultant |
| **Date** | 2026-11-20 |
| **Not reviewed** | Pricing and plans, the rest of Event settings, public pages |

Screenshots: `docs/design-reviews/2026-11-20-duplicate-event-mockups/`.

## The consultant's verdict

Build after fixes. The Duplicate page is clear, the "Comes over / Starts fresh" lists and the email safeguards are some of
the most careful work in the product, and the error states are plain. Two things will cause real failures: the new draft
says everything is "Done" and "set up" while last year's description and missing maps wait to go live, and the feature
is hard to find, made worse by removing the entry on New event. The one change that would help most: on the new draft,
replace "Done" with a short "Check what came over" list (description, maps and documents, shifts on new dates), with
links.

## Blocks people (severity 3–4)

### 1. Hard to find, and the path people use today goes away · severity 3 · 8 of 8
Duplicate lives only in the old event's Event settings, fifth tab, below Kind of event. Removing "Start from a previous
contest" (and the festival copy) from New event takes away where returning organizers start. **Fix:** "Start from one of
your events" on New event for every kind with jobs, opening the same Duplicate page; "Duplicate" on My events rows; keep
the Event settings panel. One name, "Duplicate event", on every button.

### 2. The new draft says "Done" and "Everything your event needs is set up" · severity 3 · 7 of 8
Copied steps are marked Done and the green Publish leads, while the description still says "fall" and Nov 21, maps and
documents didn't come over, and (for contests) today's check of fee, payment link, and meal price is lost. **Fix:**
copied steps show "Copied: check it" until opened; the "Copied from" note becomes a short checklist with links
(description and dates in it, maps and documents, reply settings, contest fee and payment link); no "Everything is set up"
while something copied is unchecked.

### 3. A duplicated band contest after copying isn't designed · severity 3 · Product Owner
Where it lands, the "Copied from" checks, a deadline left blank (and whether it holds back publishing), and the contest
publish window. **Fix:** draw them in round 2, including a past deadline.

### 4. The publish window says sign-up opens even after "open sign-up later" · severity 3 · Content (5 others: 2)
**Fix:** two versions of the sentence, button, and success message.

### 5. No "held until publish" invitation exists, and unsent invitations can already be accepted · severity 3 · Software Engineer
Today an invitation's link works the moment it exists, and expires 30 days after creation. **Fix:** a held state that
can't be accepted, has no Copy link, starts its 30 days when sent, is deleted with its job, and is tested.

### 6. Team spots and plan limits can break duplicating · severity 3 · Software Engineer
Held invitations would use team spots for months, or be refused and fail the whole copy. **Fix:** held invitations don't
count until sent; the copy never fails because of Coordinators; states for "plan doesn't include Coordinators" and "team
full"; publish first as the signed-in person (so plan checks run), then send.

### 7. The copy function must be locked down beyond today's copy functions, and proven · severity 3 · Software Engineer
**Fix:** only `is_org_admin` (never a Co-host of one event); always a draft with sign-up closed; the source's account;
named columns only; a new slug; dates refused in the past; replace the two old copy functions so column lists can't drift;
security tests for who may duplicate, that nothing personal comes over, that a copied Coordinator can't see the copy
before accepting, and that publishing still checks the plan.

## Should fix (severity 2)

- **Coordinators chosen three times; "untick" means two things** (all but Marketing): no checkboxes on the Duplicate page,
  one information line; decide in the publish window; remove in Team setup.
- **"Invited" before anyone is invited** (6 of 8): one status ladder: "Not emailed yet · sent when you publish", then
  "Invitation sent [date]", then "Accepted"; the name first, then the email.
- **Copied Coordinators can't be asked early** (PM, UX): an optional "Send now" (owner decides).
- **What starts fresh isn't flagged** (PM, PO, UX, consultant): copy maps and documents (owner decides), or list them in
  the checklist with a link.
- **"Stay with Fall Cleanup Day" reads as kept forever** (Marketing): "Volunteers aren't copied", and deleted on the usual
  schedule.
- **"Start over" for Co-hosts of every event** (Software Engineer): only the Account Host can delete events; a narrow
  "discard this copy" for the person who made it, never published, nothing on it. Its wording says it deletes the copy
  (Content), and it's a quiet danger link after the note (UI).
- **Double press, or a dropped connection, makes two copies** (Software Engineer): one transaction plus a request id.
- **No way for a Coordinator to say no** (UX, Content, consultant): "If you can't help this time, let Renee know" with
  her address.
- **Failed invitation can't be fixed in place** (UX, consultant): "Fix the address" on the row.
- **Phone: the button is four screens down** (UX, consultant): shift list closed by default.
- **Missing states** (PO): publishing itself fails; no Coordinators; no jobs; a setup day landing in the past; Start over
  after edits; a Co-host publishing (whose name the email shows); festivals (rooms come over).
- **Order of Coordinators, account members as Coordinators, pending source invitations** (Software Engineer).
- **Words**: job vs sign-up (Marketing, Content), "Co-host" capitalized, contest footer names directors, band "invitations"
  vs Coordinator invitations, error placement and naming the field (UI, consultant), busy and sending states readable
  (UI), partial-success message split green and red (UI), "Not emailed yet" with the yellow dot (UI), confirmation
  windows laid out one way on phones (UI), "None yet" above two people (UI).

## Polish (severity 1)

Different weekday called out, measuring success, Remove undo, the live preview read aloud in full, email fine print and
"Tap", dark-mode backdrop, required marks, × size, one name for "Run it again", the source's id kept out of the public
events row.

## What's working well

- "Comes over / Starts fresh" side by side before anything is created (all 8)
- One new first day moves everything; each shift shown with "was Sat, Nov 21" (all 8)
- Nothing emailed until publish; the window names who, and the button counts them (all 8)
- Coordinators come over as invitations, so access only through accepting (Software Engineer)
- The Co-host of one event is told who to ask, with an email button (7 of 8)
- Plain error states: "Nothing was created" (5 of 8)

## By role

- **Product Manager:** the main way in is hidden; asked about Coordinators three times; how we'll know it worked.
- **Product Owner:** the contest after copying isn't drawn; missing states; 27 acceptance criteria.
- **UX Designer:** findability; "Done" too early; a declined Coordinator is invisible.
- **UI Designer:** Start over looks safe; faded busy states; partial success all red.
- **Software Engineer:** held invitations, team limits, locking the function down, and the security tests that prove
  privacy on the copy.
- **Content Manager:** the publish window's words; "Invited"; "Start over" wording; job vs sign-up.
- **Marketing Manager:** "Everything is set up" overclaims; "stay with" vs the 10-day deletion; contests' directors.
- **Consultant:** build after fixes; the "Check what came over" list is the most helpful change.

## Acceptance criteria (from the Product Owner)

Kept in full in the decision log's build notes (27 criteria: access, the Duplicate page, what gets copied, the new draft,
Coordinators and publishing, entry points, and checks before shipping).

## Limits

AI review of mock-ups, not testing with real people. Before launch, have one or two organizers who run a repeat event try
duplicating last year's event end to end.

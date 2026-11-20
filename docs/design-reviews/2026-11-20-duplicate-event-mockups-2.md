# Light check: Duplicate event, round-2 mock-ups

| | |
|---|---|
| **What was reviewed** | Seven round-2 boards: the three ways in, the Duplicate page, the new draft, Coordinators on the draft, publishing, the invitation email, and a band contest after copying |
| **Stage** | Mock-ups before building |
| **Size** | Light check: UX Designer, UI Designer, UX Content Manager, Product Owner, usability consultant |
| **Date** | 2026-11-20 |

Screenshots: `docs/design-reviews/2026-11-20-duplicate-event-mockups-2/`.

## The consultant's verdict

Build after fixes. Everything coming over is stated, nothing is emailed without a clear choice, past dates are handled
honestly, and risky actions have a confirm or an Undo. The one change that would help most: the publish window lists any
copied steps not yet looked at, quoting old dates found in the copied text.

## Blocks people (severity 3)

1. **The most common contest copy isn't drawn** (Product Owner): last year's contest moved to next year, both
   registration dates still ahead. What the Publish step and window say ("registration opens Aug 7") and when Coordinators
   are emailed. **Fix:** Coordinators are emailed at publish (not on opening day); the window's sentence and button name
   the scheduled opening; check it on the built screens.
2. **An early "Send now" invitation can expire unseen** (consultant; UX, PO: 2): sent Nov 20, expires Dec 20, published
   Mar 1, nobody emailed again. **Fix:** an "Invitation expired · Send again" rung with the yellow dot; the publish window
   lists expired invitations ticked to send again; "Publishing won't email her again while this invitation still works".
3. **The publish window is silent about unchecked copied text** (consultant): old dates in the description or the
   information for directors go out. **Fix:** the window lists copied steps not yet opened, quoting old dates found in the
   copied text; publishing stays allowed.

## Should fix (severity 2)

- **One tracker** (UX, consultant, UI): the step bar stays the only tracker. Opening a copied step shows "Opened", not
  "Done", until saved or confirmed; the note's items are plain links (no tick circles); one phrase, "Copied: check it";
  a distinct step-bar segment for copied steps (UI); "Ready to publish" says what's left to look over.
- **Who wasn't emailed** (UX, PO, consultant): success messages name who wasn't emailed; a line stays on the event page;
  publish window drawn for team full, plan without Coordinators, already sent, nobody ticked; whether a freed team spot
  sends on its own (recommend: no, a Send button and a note).
- **"Keep it a draft" live while publishing** (UX, UI, consultant): disabled while busy.
- **Start over after an unaccepted Send now** (PO): the window says the invitation stops working; what the Coordinator sees.
- **Missing states** (PO): the contest copy ready to publish; deadline field errors and the step bar after picking one;
  festivals (same flow, in their words: rooms, minutes per group, and walking time come over).
- **Words** (Content, UX, consultant): Coordinator line built from real statuses; "open sign-up later" named in the
  publish title and button; tense-neutral hint and email ("You're the Coordinator for Trail crew at…"); "Wait until I
  publish"; "Couldn't email Luis…" with "Fix the address" first; "maps and documents" never "files"; "Delete and start
  over"; reader-specific "can't delete" line; shorter team-full message; "your sign-up's shifts" → "who signs up for
  Trail crew".
- **Layout** (UI, consultant): 44 px text actions on phones; the weekday change as a warning callout; the publish window's
  buttons pinned on phones; the contest's deadline field first on its landing.
- **Connection-dropped message** (UX, consultant): one instruction, "Try again".

## Polish (severity 1)

Heart icon for Coordinators, alignment on rows and cards, past card badge, Ready card layout matching today's, dark failure
alerts, email header with the product name, "*" kept on the date field, empty-state rule for "Start from one of your
events", shared "Starts fresh" list, multi-day contest hint, period consistency, legend for the yellow dot, main button
after picking on New event, two time limits in the email, Remove of an unsent invitation without a confirm (Undo instead).

## What's working well

- One name and one page from all three ways in (all 5)
- The date preview, including the weekday warning and contest dates left blank with the reason (all 5)
- Failure states that say what happened and what didn't (all 5)
- Confirmation windows that list consequences, with named buttons (all 5)
- Privacy carried where it matters: "Volunteers aren't copied", a draft has no volunteers (consultant, PO)

## Limits

AI review of mock-ups. Before launch, have an organizer who runs a repeat event duplicate last year's event end to end.

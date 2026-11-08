# Design review: starting a meetings event (light check)

| | |
|---|---|
| **What was reviewed** | The new-event screen as step 1 of 5, Meeting times with nothing suggested (one day and every week), Details and the event page before hours are picked, the My events card, and the volunteer first step for comparison |
| **Stage** | Built pages with sample data, before the PR |
| **Size** | Light check: UX Designer, UI Designer, usability consultant |
| **Date** | 2026-11-08 |
| **Screenshots** | `docs/design-reviews/2026-11-08-meetings-start/` (reviewed), `docs/design-reviews/2026-11-08-meetings-start-v2/` (after the fixes) |
| **From** | QA issues 350 and 351, and the owner: "we shouldn't suggest any days/hours"; "I don't want people to think that they are only filling out that screen and then they are done" |

## The consultant's verdict

**Build after fixes.** Step 1 reads as the start of five steps, and an empty Meeting times on "One day" is
clear. Two things get in the way: "Every week" shows red errors before anything is typed, and the event page
still pushes people to publish with no hours and no place.

## Blocks people (severity 3)

1. **The event page says "Almost ready to publish" with a big Publish button before any hours or place** (3 of 3).
   The database refuses the publish, but the page invites the click.
2. **"Every week" outlines every empty box in red as soon as it's picked** (consultant 3; UX and UI 2). One day
   doesn't; red is the only cue on each box.

## Should fix (severity 2)

- Details still says "The name, dates, times, and venue everyone sees" (3 of 3)
- Step 1 has a different header and step bar from steps 2–5; "Step 1 of 5" twice on phones (3 of 3)
- "Changes save automatically" and a strong Next button when nothing is saved yet (3 of 3)
- Phone step bars don't show which steps need work (UI Designer)
- "Next:" on My events cards isn't a link (UI Designer)
- The step count differs between the event page and My events (UX Designer, consultant)
- The Meeting setup card on the event page names the job three ways (UX Designer; later)
- The step 1 button looks disabled (consultant; it's the shared "not ready yet" style until a name is typed)

## What's working well

"Step 1 of 5. Next, you'll set your hours and where you'll meet"; no date asked for that would be replaced;
"No times yet" with what to do; "Day and hours not set yet" instead of a made-up date; the step-4 pointer for
breaks; light and dark equally good.

## Limits

An AI review with sample data, not real people.

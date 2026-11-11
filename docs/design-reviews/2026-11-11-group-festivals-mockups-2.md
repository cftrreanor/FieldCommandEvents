# Light check: round 2 of the group festival mock-ups

| | |
|---|---|
| **What was reviewed** | 20 round-2 mock-ups (`docs/design-reviews/2026-11-11-group-festivals-mockups-2/`) |
| **Stage** | Mock-ups after the owner's decisions on the full panel |
| **Size** | Light check: consultant, UX Designer, UI Designer, Software Engineer, Content Manager |
| **Date** | 2026-11-11 |

## Verdict

Build with fixes (consultant). The setup steps, Publish, the live page's next step, posting and changing a posted
schedule, and the director's pages work. Most problems are on Event day and in sample numbers that don't add up.

## Blocks people (severity 3)

1. **Event day on phones:** the search box shrinks to a sliver under the push-back button (5 of 5).
2. **"Now" and "On time" contradict the team's marks** (3 of 5): the strip and the public page show a group "Now" that
   nobody marked in; a group past its time shows "On time". One rule: "Now" comes only from marks; "Not marked in
   [room]" for any group past its start without a mark.
3. **The break's times don't add up** (4 of 5): the row shows a window that is another group's slot, and the next
   group's start doesn't follow. A break is a gap in start times (today's model); say so and show the next start.
4. **Build needs** (Software Engineer): one running order per day; a draft copy while posted (no live edits or
   emails as you type); refuse to drop a room with marks, and a version check; the bands table needs optional
   classification and fewer required columns, plus festival publish rules; who taps at a room door.

## Should fix (severity 2)

Push back's counts (computed, per day) and only for hosts; checkboxes for a pick-one days question; "Load theirs
only" says it drops your change; "and 2 more" opens; the phone bar keeps "not posted yet"; time tiles that look like
boxes; a dashed break row; the room strip cut off on phones; the blocking "two groups at once" card calmer than a
warning, with no way out; "Can't be removed" with no way out; promises that times come "when registration closes";
"rooms outside the rotation" shown to directors; one name for the director's page; "Mark in…" for event-day buttons;
room locations on the public page; dark-mode example text; the "Change your registration" rule after the deadline;
mock-up 10 after posting; director phone for the day; small red links.

## Owner decisions

See `docs/design-decisions/2026-11-11-group-festivals.md` (light check, round 2).

# Light check before the pull request: the built group festival update

| | |
|---|---|
| **What was reviewed** | Screenshots of the built update (`docs/design-reviews/2026-11-11-group-festivals-built/`, 26 screens) and the code |
| **Size** | Light check: consultant, UX Designer, UI Designer, Software Engineer, Content Manager |
| **Date** | 2026-11-11 |

## Verdict

Ship with fixes (consultant). Setup follows the event setup pattern; posting and changing a posted schedule are
explicit about who is emailed; door links, the live view, and emails keep personal details private.

## Blocks people (severity 3)

1. **Shortening a festival's dates** strands groups on a day that no longer exists and blocks every later schedule
   save, including push back on the day (Software Engineer).
2. **The website's pictures show the old festival screens** (Content Manager; 3 others at 2).

## Should fix (severity 2)

The Rooms step says "all set" while a room would hold two groups at once (5 of 5); prefilled 7 AM to 10 PM (4 of 5);
phone tabs cut off (4 of 5); the public page on the day leads with volunteering, and Find a group shows times but not
where the group is (4 of 5); a full green bar beside "Not posted" (2 of 5); the next step still says "share the link"
after posting; marking words vary ("Mark in", "is in", "at the door of"); "1 min behind" cries wolf; withdrawn groups
on the door and public pages; times move silently with a time zone or date change after posting; the send status
hides earlier failures; posting can succeed with no emails and nothing to retry; door links never expire; the public
live call returns more than the page shows; "2 of 2 directors"; "performers" vs "participants"; register form and
done page promises; tall phone cards; disabled arrows in dark mode; Remove next to the arrows; open-close rows that
don't look tappable; Find a group as one sentence.

## Polish (severity 1)

House style ("&", "host", periods on fragments); one form for the time zone line; "Directions"; pill and dashed
buttons; one look for Remove, Withdraw, and Delete; email addresses breaking mid-word; duplicate push-back and copy
buttons; preview link names; the copy window's "Last year"; "signed up" for groups; status line wording.

## Owner decisions

See `docs/design-decisions/2026-11-11-group-festivals.md` (light check on the built update).

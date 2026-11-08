# Design review: Meetings, final light check (before the PR)

| | |
|---|---|
| **What was reviewed** | The screens changed after the light check: Meeting times, Where you'll meet, Meeting setup, changing hours after booking, Your meetings, the printable summary, the booking page, booked, and every time booked; plus a code review of the change |
| **Stage** | Built pages with sample data, before the PR |
| **Size** | Light check: UI Designer, Software Engineer, usability consultant |
| **Date** | 2026-11-08 |
| **Screenshots** | `docs/design-reviews/2026-11-08-meetings-steps-v3/` (reviewed), `docs/design-reviews/2026-11-08-meetings-steps-v4/` (after the fixes) |

## The consultant's verdict

**Fix first, small fixes only.** Nothing blocks people. The change that would help most: on the
"change hours after booking" warning, lead each choice with what happens (email them, or I'll contact
them) and make Save say it.

## Blocks people (severity 3): bugs, Software Engineer

1. The "already emailed a link" mark never cleared, so a meeting left out a second time was never emailed, and the message didn't say so
2. Before the database update is run, choosing "email each" sent nothing, with no message
3. The pick-a-new-time email set its own Reply-To, overriding the organizer's Replies setting
4. Moving the day with "email each" left those people's calendars, and the organizer's, on the old day

## Should fix (severity 2)

- The organizer's choice applied to people who booked after the page loaded
- Where you'll meet could save part of the place on a live event
- The summary counted meetings still to come as "not marked"
- A weekly copy whose settings failed was kept, broken
- No database test for who can read or set the new "emailed" mark
- Long email lists are sent one by one inside the save (later)
- Both choices started "Keep them booked"; Save didn't say whether anyone is emailed (consultant)
- The breaks tip pointed to "More options" in words that didn't say it's step 4 (consultant)
- The contact email card saved by hand on a self-saving page (all three)
- "Confirmation email" and "calendar invite" for one email (consultant)
- "Still needed: a time, then …, then …" read as an order (consultant)
- Reschedule and Cancel were small links on tablet and desktop (UI Designer, consultant)
- The summary: an empty Met column, the records note above the title, no way to reach people with no phone, spaced hyphens (UI Designer, consultant)
- The not-ready Book button was dashed like open times (UI Designer, consultant)
- The booked page still led with "Book a meeting" and the big title (UI Designer)
- Faint radio rings on the dark warning box (UI Designer)
- "Optional" marked two ways; no "Video" heading; only an inline link when every time is booked (UI Designer)

## What's working well

Client and server agree on who's newly left out; no redirect loops; the booked card; "Who sees your
details"; the "Open" rows; the Every-week lock and its way forward; light and dark consistent.

## Limits

An AI review with sample data, not real people.

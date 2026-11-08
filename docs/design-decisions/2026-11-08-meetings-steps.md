# Decisions: Meetings, set up in steps (2026-11-08)

Review: docs/design-reviews/2026-11-08-meetings-steps.md

| # | Finding | Severity | Decision | Notes |
|---|---|---|---|---|
| 1 | Every week is in the optional step | 3 | Take the advice | "One day / Every week" first on Meeting times; switching keeps the hours; no red until a field is touched. More options keeps time between meetings, breaks, the booking window, and days off. Changes the 2026-11-07 "extras" choice |
| — | Phone calls apart from the other ways to meet | 2 | Take the advice | Back on Where you'll meet: In person, Video, Phone call. Changes the 2026-11-07 choice |
| 2 | Changing hours after people book | 3 | Take the advice (b) | The save bar says "N booked meetings don't fit · Review" and jumps to the box; after saving, Your meetings lists them at the top; the warning offers "Save and email them a link to pick a new time", and says when no open times are left |
| 3 | Two messages about the video link; the removed option still works in the database | 3 | Take the advice | One video sentence everywhere; a database update so old "add it to each invite" events need a pasted link again, with a test; a Join button on the person's booking page |
| 4 | "Meetings" means two things | 3 | Take the advice | "Times" for openings, "meetings" for what's booked |
| 5 | Bugs in the new build | 3 | Fix | Weekly copy, moving the day, phone number on the summary and summary on phones, stuck "Saving…", all-or-nothing save on Where you'll meet, cut-off AM/PM |
| 6 | "Your number isn't shared" | 3 | Take the advice | "We never show your number. Calling from your own phone? Dial *67 first to hide it, or use a work phone" |
| — | Setup severity 2: one tracker (step bar only); one "Saved"; preview before publishing; Your meetings first and Unpublish lower after publishing, tabs stacked on phones; simpler step bar on phones; one "not ready" button style with what's missing; each step saves only its own settings; the "doesn't fit" check also catches new bookings, past meetings, and days off; a failed cancel email keeps their contact details on screen | 2 | Take the advice | |
| — | Booking severity 2: no "You choose below" after booking or when full; a contact email the organizer chooses, hidden once it's over; the group's name on the booking page and email; exact deletion wording and "Who sees your details"; the brand tagline and footer; Meetings and conferences cards told apart; dark-mode windows and open times; the email's place as readable as the time | 2 | Take the advice | |
| — | Book for someone, copy an earlier event, a note for people booking, a waiting list, measures | 2 | Later | |
| — | Polish (severity 1) | 1 | Take the advice where it's in the same code | |

## Light check (2026-11-08)

Review: docs/design-reviews/2026-11-08-meetings-steps-light-check.md

| # | Finding | Severity | Decision | Notes |
|---|---|---|---|---|
| 1 | Cutting hours after people book | 3 | Take the advice | One question, "What should happen to these N meetings?": keep them booked and email each a link to pick a new time, or keep them booked and contact them myself. Save says what happens. Starts on "contact them myself" when there aren't enough open times, and says why. Only meetings this change leaves out count, and no one is emailed twice. Phone layout for the bar |
| 2 | Bugs in the build | 3 | Fix | Day move plus cut hours; summary on the day; unpublished events with bookings use Meeting setup |
| — | Severity 2 and polish | 2 | Take the advice | All of the list in the report |

## Final light check (2026-11-08)

Review: docs/design-reviews/2026-11-08-meetings-steps-final-check.md

The owner's standing direction for this round was "Yes, fix all": no finding needed a new choice.

| # | Finding | Severity | Decision | Notes |
|---|---|---|---|---|
| 1 | "Already emailed" never clears, so a second cut never emails anyone | 3 | Fix | The mark clears in the database whenever the meeting's time changes; the saved message says who was already emailed |
| 2 | Emailing silently does nothing before the database update | 3 | Fix | Emails everyone without marking, or says "We couldn't email them" |
| 3 | The pick-a-new-time email overrode the Replies setting | 3 | Fix | Uses the event's Replies setting; "reply to this email" only when replies reach the organizer, else the contact email, else nothing |
| 4 | Moving the day left some calendars on the old day | 3 | Fix | Everyone whose meeting moved gets the updated invite, the organizer too |
| 5–9 | Choice applied to meetings not shown; partial place save on live events; "not marked" counted upcoming meetings; broken weekly copy kept; no test for the new column | 2 | Fix | |
| 10 | Long email lists sent inside the save | 2 | Later | Fine at today's sizes (no one is emailed twice if it stops); batch when weekly events grow |
| — | Wording and layout (both choices led with the same words; Save names who's emailed; breaks hint; contact email saves itself; one name for the confirmation email; "Still needed" list; Reschedule and Cancel buttons at every width; summary Contact column and Met column; records note below; not-ready button style; booked page leads with "You're booked"; warning radios in dark mode; "Place name (optional)"; In person and Video headings; "Email Dana" button) | 2 | Take the advice | |
| — | Phone numbers look spaced on the summary ("555 - 0501") | 2 | Keep as is | The numbers use a plain hyphen; the spacing is the font's own glyph in the screenshot browser, and turning off its contextual letters changed nothing |

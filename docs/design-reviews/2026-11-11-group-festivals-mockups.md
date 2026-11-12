# Design review: mock-ups of the group festival update

| | |
|---|---|
| **What was reviewed** | 17 mock-ups of the planned update: setup on the shared steps (Details, Rooms, Registration, Volunteers, Publish), the live event page, Rooms and schedule (posting, two days, reordering), changing a posted schedule, Event day, the public festival page, registering a group, the director's dashboard, copying last year, the schedule email, and the website words |
| **Stage** | Mock-ups before building (owner decisions of 2026-11-11 on the built feature) |
| **Size** | Full panel: all seven roles plus the consultant |
| **Date** | 2026-11-11 |
| **Not reviewed** | Event settings, the Volunteers step (the existing jobs page), band contests |

Screenshots: `docs/design-reviews/2026-11-11-group-festivals-mockups/`.

## The consultant's verdict

Build with fixes. Setup now follows the shared pattern well. The weak spot is the middle of the job: building and
posting the schedule. The mock-ups lose two things today's app does (lunch breaks and "push the schedule back"), never
show what stops two groups landing in one room at once, and let one click email every director while registration is
still open. The change that would help most: make "Post the schedule" a checked, confirmed step that names how many
directors are emailed, any group with no times, any double-booked room, and any group whose request isn't met.

## Blocks people (severity 3–4)

1. **Saving rooms after posting still emails directors as you type** (Software Engineer, sev 4; 3 others at 2–3).
   The Rooms step saves as you go, and today every save that moves a time emails the directors, so typing "25" can
   send emails from "2". Once posted, every page that can change times needs a Save button with the "who's affected,
   email or not" window (mock-up 10's model), and rooms must stop emailing by themselves.
2. **Two co-hosts can delete each other's work** (Software Engineer, sev 4; 4 others at 2). Saving replaces the whole
   list of rooms or groups, so a stale tab can delete a room (and its check-in taps) or drop a group from a posted
   schedule with nobody told. Needs a version check, saving by room rather than replacing the list, and a conflict
   message that says what the other person changed and keeps your own change to re-apply.
3. **Breaks and "push the schedule back" are missing** (6 of 8). Both exist today; a festival day has lunch, and on
   the day a room runs behind. The new website words still promise "add a break".
4. **Nothing stops two groups being in one room at once** (5 of 8). Mock-up 10 makes the hall 25 minutes with groups
   20 minutes apart. Today's app warns about this; the mock-ups don't.
5. **Posting: one click emails everyone, while registration is still open** (6 of 8). No confirm, Sunday's groups
   hidden, and late registrations not designed (where they go, who's told). A group that registered after the
   deadline appears only on Event day.
6. **Event day leaves out the main job** (6 of 8). No group "not here yet" with "Mark arrived"; only the late group
   has buttons; no undo; no Saturday/Sunday switch; no view for one room; "Running late" blames the choir when it's
   usually a missed tap.
7. **The public page shows the wrong state** (8 of 8). On festival day it still says registration is open with a
   "Register your group" button; "Find your group" doesn't say which day.
8. **The email promises a check-in place nobody set** (7 of 8). "Check in at the front office" is fixed text; no
   address; no place for the organizer's own arrival, parking, and fee information (band contests have one).
9. **Two-day schedules and the live view need new data** (Software Engineer). A start for each day, times that reset
   each day, and an "in the room now" state the families' page can read without seeing who tapped.
10. **Emailing hundreds of directors in one request** (Software Engineer). It can stop partway with no record of who
    got their times. Needs a send list with retries and "Sent to 38 of 40".
11. **Copying "team" with last year's festival** (Software Engineer, privacy). It would quietly give last year's
    co-hosts access to this year's directors' details. Offer to invite them instead.
12. **Removing a room on the day** (Software Engineer, Product Owner). Deletes the team's taps for good, and the
    dialog's "other rooms keep their times" is untrue for a middle room. Block removal once a room has taps.
13. **Dark mode: example text looks like typed answers** (UI Designer, consultant). Placeholder text is the same
    white as values, so empty boxes look filled. App-wide fix.

## Should fix (severity 2)

- **One name:** the step is "Rooms", the card and page "Rooms and schedule", the button "Go to rooms"; tabs "Rooms" and
  "Room by room" side by side; "0 scheduled" on one page and "5 groups have times" on the next; "Now: nobody" vs
  "Between groups", "Next" vs "Up next"; "arrivals", "check-ins", and "marks".
- **Classifications start filled with 1A to 6A and are required.** Many choir, orchestra, and middle school festivals
  use other divisions or none.
- **"Times your group can't perform" is free text,** but the schedule warns as if it could read it, and the sample
  warning is a false alarm (9:00 isn't before 9:00). No way to say "Saturday only".
- **Skipping a room** is a tap on an information chip: easy to do by accident, with small "Skip" text.
- **Reorder arrows next to "Minutes per group"** read as a number stepper on phones.
- **Sunday's groups** are one line with no times.
- **The change window** lists names but not old and new times, and missed a group whose time moved.
- **Room notes ("Room 112, east hallway") and rooms outside the rotation** are dropped (the website promises them).
- **The director's group page,** the confirmation after registering, and "registered, times not posted yet" aren't
  drawn.
- **Publish step:** no "Event settings" link; empty draft cards with no first action; summary cards vanish when ready.
- **The live page** has nowhere to copy the registration link, the first job after publishing.
- **Phone layout:** the pinned bar wraps to three lines; tabs wrap; radio circles squash; the red Remove sits nearest
  the thumb; small text-only targets.
- **Website words:** "publish, and every director is emailed" is no longer true (it's on posting); "follow every room
  live" should say "as your team marks it".
- **Copy last year** fills in a date; its two lists of what comes along differ.

## Polish (severity 1)

"Group limit" for "Most groups"; "Keep editing" for "Go back"; "✓ Done" for "✓ 3 rooms"; one date and time format;
the quick links repeat the cards; the sample data contradicts itself (Riverside is a Sunday group shown on Saturday).

## What's working well

- The step bar as the one tracker, statuses in words, "Saves as you go" with "Next up", no "Back to" link.
- "Not ready to publish yet" names one thing with one button; "When you publish" is honest (nobody is emailed).
- The read-back line on Rooms ("Each group's path … About 1 hour per group").
- The live page's one next step with counts; cards named like their areas.
- Posted vs not posted made explicit; the remove and change windows name who is affected and give an email choice.
- Copy last year says what comes along and what doesn't; the email names the group; festival words throughout;
  "post" and "publish" never mixed.
- Light-mode contrast passes; dark mode buttons and warnings read well.

## By role

- **Product Manager:** breaks and push-back, directors' information, registration timing, how we'd measure it.
- **Product Owner:** pattern rule by rule; late registrations; acceptance criteria.
- **UX Designer:** day-of tools, double-booking, Event day's main job, skipping by accident.
- **UI Designer:** dark-mode placeholders, Event day on phones, tabs, chips, radios, small targets.
- **Software Engineer:** emails from autosave, version checks, two-day data, live state, sending at scale, copy privacy.
- **Content Manager:** one name per thing, "scheduled" vs "posted", exact wording.
- **Marketing Manager:** website promises (publish vs post, breaks, push-back, room notes, live).
- **Consultant:** a checked, confirmed Post; breaks; double-booking.

## Limits

This is an AI review, not testing with real people. Before a festival season, walk two or three choir or orchestra
directors through posting a schedule and the day itself.

# Decisions: one setup pattern for volunteer events, band contests, and meetings (2026-11-08)

Review: docs/design-reviews/2026-11-08-setup-alignment-mockups.md

The owner set the direction before the review: volunteer events and band contests take the meetings setup
layout (one tracker, no settings menu on the Details step, step titles = step names); meetings take the
volunteer and band contest live pattern (Unpublish only in Event settings, the same event page card, the same
Not ready box).

| # | Finding | Severity | Decision | Notes |
|---|---|---|---|---|
| 1 | Event settings' menu is a second tracker; hidden section on phones | 3 | Take the advice | Plain labels, no done circles (a plain word only where it's a fact, like "Live"); on phones the sections wrap so the open one is always visible |
| 2 | The volunteer area has two names | 3 | Take the advice: "Jobs and shifts" | The same name on both kinds, in the step bar, page title, buttons, and links; optional on band contests |
| 3 | Unpublish wording for meetings | 3 | Take the advice | Words for each kind, with the number booked; Unpublish looks less dangerous than Delete |
| — | "Publish" as the last step everywhere | 2 | Take the advice | Band contests too |
| — | Old names left behind | 2 | Take the advice | Tab titles, "Go to band registration", back links, "Broadcast message", "and" for "&", one draft label |
| — | Event settings during setup | 2 | Take the advice | An Event settings link on every step page; "Back to setup" on Event settings while it's a draft |
| — | Two main buttons on the meetings Publish step | 2 | Take the advice | The card's button is an outline, like the other kinds |
| — | No "Next up" on Jobs and shifts | 2 | Take the advice | "Next up: Publish" |
| — | The current step's label | 2 | Take the advice | "Now" always first |
| — | Drafts full of zeros | 2 | Take the advice | One line per empty card; Contest day waits until published |
| — | Live Meeting setup saves with a button | 2 | Fix it differently | Keeps its Save button (changes can affect people who booked), says why, and shows the button only once something changes |
| — | The live checklist panel | 2 | Keep as is | Live volunteer events and band contests show the same panel |
| — | Weekly meetings have no fullness bar | 2 | Keep as is | Weekly keeps its count line; no bar when there are no times |
| — | Phones and look | 2 | Take the advice | "Saves as you go" on phones, the band registration note off the phone bar, a visible progress track, Unpublish an outline (red only for Delete). "Copy link" and "QR code" already have 44 px targets; "Add job" is the shared "not ready yet" style until a name is typed |
| — | Copy from another context | 2 | Take the advice | Time zone help, "Tap to add" → "Add common ones", required-boxes note only where there are boxes, first-job order, schedule sentence. "Logo and color" stays: the color picker appears once a logo is uploaded |
| — | Old `?step=` links | 2 | Fix | Bug |

## Light check on the built pages (2026-11-08)

Nothing new rated 3 or 4 beyond the Meeting setup save bar (fixed: it explains Save only once something
changes). Software Engineer bugs fixed. The owner's decision on the new suggestions: "1–9 now, 10 later".

| # | Finding | Severity | Decision | Notes |
|---|---|---|---|---|
| 1 | Jobs and shifts has no pinned bar; "Add job" looks disabled | 2 | Take the advice | |
| 2 | "Back to [event]" on step pages jumps forward to Publish | 2 | Take the advice | Dropped during setup; the step bar covers it |
| 3 | Band schedule card offers an action you can't take yet; "publish" means two things | 2 | Fix it differently | "Opens after you publish" in place of the button before the event is published. The schedule really is published (directors and the public see it), and the schedule page says Publish and Unpublish throughout, so the card keeps "publish" but always says "the schedule" ("Schedule not published", "Publish the schedule by …") |
| 4 | Section names don't match the steps | 2 | Take the advice | "Jobs and shifts" card; meetings section "Meetings" with "Change times or place"; one name for the booking link |
| 5 | The phone step summary doesn't say "Now" | 2 | Take the advice | |
| 6 | Dark mode radio buttons and checkboxes look half-filled | 2 | Take the advice | |
| 7 | The pinned bar can cover the box you're typing in | 2 | Take the advice | |
| 8 | Unpublishing volunteer events and band contests doesn't say what happens to people; Delete doesn't name bookings | 2 | Take the advice | |
| 9 | "When you publish" doesn't say what opens for volunteer events and meetings | 2 | Take the advice | |
| 10 | Small items (nav names, bus rules, band logo card, cut-off email, dashed borders, small targets, demo chips) | 2 | Later | |

## The seven items left for later (2026-11-08)

The owner chose to do them now. Light check (UI Designer, consultant) on
`docs/design-reviews/2026-11-08-small-items/`: nothing rated 3 or 4; its severity 2 refinements were made
(the locked choice muted, with its link on its own line; a shorter deadline help; one "where the logo
shows"; the demo card's wording and button borders).

| # | Item | Decision | Notes |
|---|---|---|---|
| 1 | "Volunteers" vs "Volunteer tracking" in the top menu | Take the advice | "Volunteer tracking" at every width |
| 2 | Two bus-booking rules | Take the advice | "At least two weeks before contest day", matching the schedule card |
| 3 | Band contest logo card | Take the advice | Names the registration page and each band's page |
| 4 | Cut-off contact email | Take the advice | Its own row |
| 5 | Dashed borders mean three things | Take the advice | Dashed = optional or an empty slot only; disabled is solid and muted; locked is solid and muted with a lock |
| 6 | Small tap targets | Take the advice | Demo role buttons are 44 px; "See all steps", "Copy link", and "QR code" already were |
| 7 | Demo card's "Host"/"Guest" | Take the advice | Organizer / Someone booking (meetings), Teacher / Parent (conferences) |

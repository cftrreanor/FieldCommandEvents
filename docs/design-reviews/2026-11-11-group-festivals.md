# Design review: choir, orchestra, and group festivals (the built feature)

| | |
|---|---|
| **What was reviewed** | The festival as built: new event, setup, rooms and schedule, group registration, event day, settings, the public page and registration form, and a director's dashboard and group page; plus the website's festival page |
| **Stage** | A check of a built feature (owner: "we might need to make some updates") |
| **Size** | Full panel: all seven roles plus the consultant |
| **Date** | 2026-11-11 |
| **Not reviewed** | Event day and the public page with a posted schedule (the sample had none; reviewed from code) |

Screenshots: `docs/design-reviews/2026-11-11-group-festivals/`.

## The consultant's verdict

Rethink the setup, then update the rest. The separate pages mostly work (the schedule builder, registration, the
director's page, the public form), and the privacy rules are tight and tested. But festivals were built before the
event setup pattern and never moved onto it: a generic 5-step wizard about the team and email, then three more
trackers, and the festival's main job, a posted room schedule, is marked "Optional". The one change that would help
most: put festivals on the shared step bar, and make posting the schedule the main action once it's live.

## Blocks people (severity 3–4)

1. **Not on the event setup pattern** (8 of 8). `SETUP_STEPS` has no festival. Step 1 is the old 5-step wizard (Event
   details, Team setup, Email settings, Maps and documents, Publishing and more) with no Rooms step; saving lands on
   Team setup; then a "Setup · 1 of 3" strip, a sidebar checklist, a "Next step" card, and tab statuses, which
   disagree. "Back to [event]" links, a manual "Save rooms", prefilled times (7 AM–10 PM) and prefilled rooms.
2. **Posting the schedule is optional, hidden, and has many names** (7 of 8). Marked "Optional · After you publish";
   reached by two saves and a status bar that doesn't look like a button ("Post it from the outlined bar"); called
   post, publish, build and post, not published. The schedule page opens saying "Unsaved changes".
3. **Saving rooms after posting emails directors without warning** (3 of 8, confirmed in code). Renaming a room or
   changing minutes emails every affected director; Remove has no confirmation and deletes that room's check-in taps.
4. **Changing the date strands the schedule on the old day** (Software Engineer, from code). The schedule's start
   date doesn't move with the event; the public "Now / Up next" never lights up.
5. **The pinned save bar covers the field being typed in on phones** (2 of 8): new event, rooms, schedule, settings.
6. **The day of, and families' live view, can't be found or don't reflect reality** (5 of 8). The Event day card
   offers only volunteer check-in; registered groups don't appear on Event day until a schedule is saved; families'
   "Now / Up next" comes from the clock, not the team's taps (band contests use real progress).
7. **The website promises what the app doesn't** (Marketing): setup "built around your kind of event" with step 1
   "Set up rooms and the order"; "adjust any time by hand" (there's no per-time edit); "UIL academics" (not groups
   moving through rooms).
8. **Band words for choir directors** (7 of 8): "Competing · Your bands' registrations at contests", a `/bands`
   registration link, "Jazz Band" placeholder, "Volunteer Setup" on the team step.

## Should fix (severity 2)

- One name for the area ("Rooms and schedule"; today six names) and one verb for the schedule ("post").
- Draft page: one main button (today Start and Publish), no Event day card on drafts.
- Event page cards that match: counts for rooms and schedule ("5 groups · 0 scheduled"), a bar for registration.
- "Close registration" and "Close sign-up" as red text links on home: move to settings, confirm who's affected.
- Main buttons that look switched off ("Register group", "Save and continue", "Send invitation").
- Tabs and quick links cut off on phones.
- Room chips that skip a room for one group don't look tappable; only arrows to reorder (slow for 30+ groups).
- Event day: "Running over" in red for every unmarked room; 300 groups is 300 cards with no search.
- Emails name the school, not the group (two choirs from one school get identical emails); "The host changed".
- Public page: the directors' card doesn't look tappable; families get only "check back soon"; no "find my group";
  registered directors have no "see your times" link.
- Registration form: required fields unmarked; two email boxes; no saved progress; deadline not shown.
- Registration settings "Needs to be done" while registration is open.
- Co-hosts saving at once can delete each other's rooms (no version check); emails one by one can run out of time
  at 300 groups.
- Fewer setup guards than band contests (classifications, deadline), and no "copy last year".

## Polish (severity 1)

"Dashboard" back link to a page titled "My events"; "Full schedule" link before there is one; the public page loads
band-contest data it doesn't use; house style ("&", title case); reorder arrows move around on phones.

## What's working well

- The schedule builder: a path through the rooms, times worked out per group, no double-booking, breaks, skipping a
  room per group; database and screen agree on the times.
- Privacy: the public sees only posted times; a director sees only their group's; check-in taps only through a
  checked function; all with security tests.
- "When you publish" says exactly what happens; the director's "What's next"; the short, private registration form.
- Push back, and "email only directors whose times changed"; taps record who and when.
- Dark mode and phone widths hold up; tap targets are 44 px.

## By role

- **Product Manager:** the schedule as the core job, marked optional; rooms emails; how we'd know it works.
- **Product Owner:** pattern rule by rule (most not met); undrawn states; acceptance criteria.
- **UX Designer:** posting buried; skipping rooms hidden; scale; find my group; registration progress.
- **UI Designer:** four trackers; the post control not a button; mismatched cards; grey main buttons; phone tabs.
- **Software Engineer:** the date bug, rooms emails and Remove, live view from the clock, version checks, email time.
- **Content Manager:** six names, post vs publish, band words, emails naming the school, exact wording.
- **Marketing Manager:** website promises (setup, adjust by hand, UIL), band words for choir directors.
- **Consultant:** rethink the setup; pinned bar over fields; one save model.

## Limits

This is an AI review, not testing with real people. Before a festival season, try setup and the day with two or
three choir or orchestra directors.

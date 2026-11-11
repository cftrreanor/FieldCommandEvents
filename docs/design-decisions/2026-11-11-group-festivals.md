# Choir, orchestra, and group festivals: updates (2026-11-11)

Owner request: "let's do a check on our group/choir festivals, I feel like we might need to make some updates."
Full panel on the feature as built (`docs/design-reviews/2026-11-11-group-festivals.md`). Owner decisions:

- **Setup steps (the event setup pattern):** Details, Rooms (needed to publish), Registration (group registration
  settings: deadline and classifications, like band contests), Volunteers (optional), Publish. The old 5-step wizard,
  the checklist panel, the setup strip, and "Back to" links go.
- **The room schedule:** once live, "Post the schedule" is the event page's main action until it's posted, with counts
  ("5 groups · 0 scheduled"). Never "Optional". One verb: *post* the schedule; *publish* is for the event.
- **Families' live view:** "Now / Up next" follows the team's taps (group arrived, room done), like band contests,
  through a privacy-safe database function with a security test.
- **Website:** say what the app does ("change the order, skip a room for one group, or add a break"), and remove
  "UIL academics".
- **Everything else as recommended:** the bug fixes (the schedule moves with the event's dates; saving rooms after
  posting warns and offers the email choice; Remove confirms; the pinned bar never covers a field; registered groups
  show on Event day; no "Unsaved changes" before an edit; co-hosts saving at once; email sending at scale), one name
  for each thing, matching event page cards, close registration in settings, primary buttons, phone tabs, visible
  room skipping, emails that name the group and say "organizer", the public page and registration form fixes, and
  festival words throughout (a `/register` link that keeps old `/bands` links working).
- **Bigger items, all in this update:** Event day search (and collapsing finished groups), faster reordering (move to
  a position, sort by classification), copy last year's festival, and two-day schedules (a start time for each day).

Next: mock-ups of the new setup steps and changed screens, a panel review, then build.

## Mock-up review (2026-11-11)

Full panel on the mock-ups (`docs/design-reviews/2026-11-11-group-festivals-mockups.md`). Verdict: build with fixes.
Owner decisions:

- **When to post the schedule:** while registration is open, the festival page's main action is "Copy the
  registration link"; "Post the schedule" becomes the main action once registration closes. Posting early stays
  possible, with a warning, and posting always asks first ("Post and email 5 directors?") with anything still wrong
  (groups with no times, a room with two groups at once, a request not met).
- **Classifications:** optional and empty to start, with one-tap sets (1A to 6A, Varsity and Non-varsity, Middle
  school and High school) or your own. Not needed to publish; "Sort by classification" hides when there are none.
  (Changes the earlier "deadline and classifications" rule: only the deadline is needed.)
- **Times a group can't perform:** simple choices instead of free text: which days the group can come (two-day
  festivals), earliest and latest times, and an optional note. The schedule warns only when a time breaks a limit.
- **Everything else as the panel advised**, including:
  - Once the schedule is posted, every page that changes times saves with a button and the "who's affected, email or
    not" window; rooms never email on their own.
  - Co-hosts: a version check, saving room by room, and a conflict message naming what the other person changed and
    keeping your change to re-apply.
  - Keep "Break before this group" and "Push the schedule back"; warn (and block posting) when a room is longer than
    the gap between groups.
  - Late registrations: listed on Rooms and schedule and the event page, added at the end of a day, email only that
    director.
  - Event day: every group's next tap as a button (Mark arrived, In [room] now, Done in [room]), undo, a day switch,
    a view for one room, "Not marked" instead of "Running late".
  - Public page states (registration open, closed, the day, over), the day on every result, a performance hall list.
  - "Information for directors" (arrival, parking, fees) on the Registration step, in the email and on the group
    page; the address in the email; no fixed "front office" line.
  - Two-day data, an "in the room now" state, a privacy-safe live function, an email send list with retries.
  - Copy last year: no team (offer invitations), no prefilled date, a new copy function for festivals.
  - Block removing a room once it has taps; keep room notes and rooms outside the rotation.
  - Dark mode example text dimmer than typed answers (app-wide).
  - One name: "Rooms and schedule" for the step, card, page, and buttons; "posted" not "scheduled"; "Up next" and
    "Between groups" on both pages; "marked arrived" and "marked done".
  - The director's group page, the registration confirmation, and the "times not posted yet" state.
  - Publish step: Event settings link, empty cards with a first action; copy the registration link on the live page.
  - Phone fixes, and the website words corrected (posting emails directors; "as your team marks it").

Next: round 2 of the mock-ups for the changed screens, a light check, then build.

## Light check on round 2 (2026-11-11)

Report: `docs/design-reviews/2026-11-11-group-festivals-mockups-2.md`. Owner decisions:

- **Room doors:** each room gets its own private link for whoever is at the door, no sign-in. It can only mark groups
  in that one room (in, done, next in), shows only that room's list, and the organizer can turn it off or make a new
  one. Pushing the schedule back stays hosts and co-hosts only.
- **Dark mode example text:** an exception to "no grey in dark mode": example text in empty boxes gets a softer
  blue-grey that still reads easily, plus italics. App-wide.
- **Director edits:** directors can change or withdraw their group until registration closes. After that the page
  says "To change your registration, contact the organizer".
- **Event day buttons:** each group card keeps its own solid next-tap button (an exception to one main button per
  screen), because checking groups in fast on a phone matters more.
- **Everything else from the light check as recommended:** "Now" comes only from the team's marks; a break is a gap
  in start times, shown with the next group's start; per-day running orders; a draft copy while posted; the other
  fixes in the report.

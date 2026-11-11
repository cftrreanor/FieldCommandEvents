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

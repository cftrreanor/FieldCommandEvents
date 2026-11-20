# Design review: Duplicate event (final check on the changed screens)

| | |
|---|---|
| **What was reviewed** | The screens changed by the follow-up fixes (`2026-11-20-duplicate-event-built-3/`), and the code change |
| **Stage** | Screenshots before the PR |
| **Size** | Light check: Software Engineer (code), UI Designer, usability consultant |
| **Date** | 2026-11-20 |

## The consultant's verdict

Build after fixes; nothing blocks people. Each "[new date]" place is listed by page and links to its box with the
marker selected, and the "wasn't emailed" card turns a silent gap into a next step. What's left is repetition: the
copy's Publish page says the "[new date]" message three times. Keep one list, in "Not ready to publish yet".

## Blocks people (severity 3): bugs found in the code, fixed without a design choice

1. **Change email kept the invitation's link keys,** so a first email that did arrive could sign its reader in as the
   corrected address. Fix: new keys on Change email; a security test.
2. **Invitations already sent had no delivery time after the database update,** so they'd read "Not emailed yet" and be
   emailed again. Fix: the update fills it in for invitations already sent.
3. **Every confirm window in the app focused the main button,** so Enter would delete or cancel. Fix: "Never mind" first
   in focus order again, the same look.
4. **A job's old Location too long to mark could still block publishing.** Fix: the box shows whenever it's listed.

## Should fix (severity 2)

- The "[new date]" message three times on the Publish page; green "Duplicated" and "Published" banners outrank the amber
  work (consultant, UI)
- The amber note above the label reads as part of the field before it (UI); "redesign" in the Location help (consultant);
  the deadline and "[new date]" order on contest registration (consultant)
- Things that aren't dates still replaced ("Ages 5/6", "Grade 3 March"), and the original words not shown (engineer)
- A failed resend of a delivered invitation expires it (engineer); counts capped at 1,000 rows (engineer); older copy
  summaries still hold names (engineer)
- "Not emailed yet" uses the blocking diamond before publishing (UI); two link styles in the publish card (UI); four
  next-step looks on My events cards (UI); the weekday and contest warnings look like plain info (UI)
- No confirmation after Remove in Team setup (consultant, UI)

## Polish (severity 1)

The job-name link landing on another box; Volunteer Leads reading held invitations through the API; removal rows keeping
link keys; a retry after a drop making a second copy; one phrase for "asked again"; back-link names; the time zone cut
off on phone; the grey Send button; phone line breaks; indented text buttons; the calendar's focus ring; "Opened" by
color alone on phone.

Kept as the owner decided: "Duplicate event" only on past events and those within four weeks (the consultant suggested
every card).

## What's working well

"[new date]" places grouped by page with links that select the marker; the past-date error; "Use Sat, Apr 17 instead";
the contest warning before copying; the "wasn't emailed" card; status always in words; contrast in light and dark; the
copy-too-long handling; SQL and TypeScript date rules agreeing.

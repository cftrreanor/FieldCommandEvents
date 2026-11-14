# Light check: visitor check-in report and visitor list, built pages

| | |
|---|---|
| **What was reviewed** | Screenshots of the built pages: the form, Parent Registration (closed, event day, after), the front-office confirm window, the door (Host and Volunteer Lead), the report (day, searched, final, printed, PDF, deleted, empty), the privacy page, and the three emails |
| **Stage** | Screenshots before the PR |
| **Size** | Light check: UX Designer, UI Designer, UX Content Manager, usability consultant |
| **Date** | 2026-11-14 |
| **Not reviewed** | Pricing, walk-ups, Registration settings |

Screenshots: `docs/design-reviews/2026-11-14-visitor-attendance-built/`.

## The consultant's verdict

Ship after fixes. Registering with split names, downloading for the school's system, sending someone to the front
office, and keeping a record before deletion all work, and the page is honest about its state and about privacy. The one
finding that can put a wrong name into a school's background-check system is the names-to-check box. The change that
would help most: the name guesser keeps particles with the last name and offers the likely splits as a choice.

## Blocks people (severity 3)

### 1. Names to check offer a wrong guess as the one-tap answer · consultant
All the sample guesses were wrong ("Luis Von / Berg", "Victor De la / Cruz"), and the quickest action is "It's right";
"Download anyway" and two other download buttons skip the check, and an edited name that isn't saved is lost without a
word (UX). **Fix:** keep particles (von, van, de, de la, le, del, da, di, St.) with the last name; offer the likely
splits as choices plus Edit; every visitor-list download warns about unchecked names and unsaved edits.

### 2. The door note looks like a button · UI Designer (consultant: 2)
It sits in the button's place with the button's shape and no icon or color, so it reads as a control and is the
quietest thing in the row. **Fix (owner):** a soft amber note across the row, not button-shaped, a small warning icon,
bold "Send to the front office", then "Please ask Ben to go there". No red, no lock.

## Should fix (severity 2)

- **One action, three names** (UX, Content, consultant): "Send to the front office" everywhere; badge "Sent to the front
  office"; undo "Let Ben check in" (owner).
- **Undo at the door** (UX): Hosts and Co-hosts get "Let Ben check in" under the note at the door, with a confirm; the
  door team sees only the note (owner).
- **Download buttons** (UX, UI, Content, consultant): one main button that follows the state ("Download 5 new and
  changed names", then "Download all 481 adults (612 rows)"); the third button in the families card says "all".
- **Corrected rows don't show the old name** (UX): a "Was" column; adults removed since the last download listed.
- **Report order** (UX, consultant): Sent to the front office, then Checked in, then Not checked in, on screen and in
  print; the counts jump to their groups; search shows "6 of 298".
- **"Open registration"** (UX, UI, consultant): quiet "Reopen registration" with a confirm, hidden on and after the
  event day.
- **Save warning ends on a click** (UX): keep the warning until someone confirms the school has the copy; show who
  printed or downloaded inside it.
- **Co-host email** (UX, Content, consultant): name the Account Host; "through Tue, Nov 17" in subject and heading.
- **Privacy page** (Content): the Co-hosts-of-one-event exception in the first bullet; "Co-host" capitalized.
- **Small stop link** (UI): 44 px tap area.

## Polish (severity 1)

Search box names, "Closed" not "Closes" after closing, "Keep this split" wording, report footer wording, deleted-page
sentence order, after-event help lines, tabular figures widening hyphens ("Check - in", "Pre - K"), phone header order
and counts on one row, duplicate report button after the event, phone tab and link wrapping, "Show all" underlined,
privacy table column, page numbers in print, event-day bar at tablet width, system emails' sender name, "printed this
report" vs "downloaded the spreadsheet", "Families' and children's details" on the after-event line.

## What's working well

- The form's name boxes and hint (all 4)
- The confirm window: names the person, says what happens, no reason saved, how to undo (all 4)
- The status card changes with the event's stage, and "last downloaded … · 4 new and 1 corrected since" (UX, consultant)
- The report's honesty: "Updated", "In progress, as of", "Final"; counts that add up; the scope line (all 4)
- The printed copy is black on white from dark mode; emails with no family names and one button (UI, consultant)

## Limits

AI review of screenshots, not testing with real people. Before launch: the office administrator imports a real visitor
list, and a volunteer tries the door note on a phone outdoors. A keyboard pass on the confirm window is still owed.

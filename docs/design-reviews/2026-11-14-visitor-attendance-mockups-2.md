# Light check: visitor check-in report and visitor list, round 2 mock-ups

| | |
|---|---|
| **What was reviewed** | Round-2 mock-ups (10 boards) after the owner's decisions: the form, Parent Registration after registration closes, the "Send to the front office" window, the door, the visitor list file, the report on the day and after, the printed copy, the ends, and the emails |
| **Stage** | Mock-ups before building |
| **Size** | Light check (moved up from the full panel's fixes): UX Designer, UI Designer, Software Engineer, UX Content Manager, Marketing Manager, usability consultant |
| **Date** | 2026-11-14 |
| **Not reviewed** | Pricing, walk-ups, the rest of the form, Registration settings |

Screenshots: `docs/design-reviews/2026-11-14-visitor-attendance-mockups-2/`. Decisions on round 1:
`docs/design-decisions/2026-11-14-visitor-attendance.md`.

## The consultant's verdict

Build after fixes. Splitting names when people type them, a stop mark that replaces the door's button, a report that's
live on the day and final afterward, and calm, honest deletion reminders are sound. The weak point is the report screen:
it hides most of its rows, changes layout between the day and afterward, and treats a click on Print as proof a copy was
saved. The one change that would help most: show the whole report on screen, grouped the same way live and final, with
a find box.

## Blocks people (severity 3–4)

### 1. The stop mark has to be enforced by the database · severity 4 · Software Engineer
A door page that hasn't refreshed, a second tab, or a weak signal can still check a marked adult in, because today's
check-in function doesn't know about the mark. **Fix:** check-in refuses a marked adult; only Hosts and Co-hosts can
set or clear the mark; decide what marking someone already checked in does; security tests for each.

### 2. Other adults have no lasting identity · severity 3 · Software Engineer
Adults after the first are stored by position in a list and matched by name, so a parent fixing "Ben" to "Benjamin",
removing and re-adding someone, or cancelling and registering again loses or moves a stop mark, and a Host's name fix
has nowhere safe to go. **Fix:** each adult gets their own record (name parts, check-in, stop mark, when added and
renamed); a parent can't rename or remove a marked adult or cancel a marked registration ("contact the school").

### 3. "Only Hosts and Co-hosts" isn't true of the data · severity 3 · Software Engineer (Content, UX agree the line needs work)
Volunteer Leads can read every family's details, email and phone included, from registration until 10 days after;
Section Leads on the event day. **Fix:** build the downloads and report on the server through a Host-only check, and
either narrow Volunteer Leads' access to the check-in window or say exactly who sees what (owner decides). The door
stops sending emails to browsers.

### 4. "Final" isn't final · severity 3 · Software Engineer (Product Owner in round 1)
Check-ins can still be changed for 30 days, and the day-before practice run counts. **Fix:** check-ins and stop marks
lock after the event's last day (in its time zone), which is also when the report says "Final"; practice check-ins are
cleared when the event day starts (owner decides).

### 5. "New since the last download" needs a record of downloads · severity 3 · Software Engineer
Counting by registration date misses adults added to a family later, names changed, and families imported after
closing, and those people arrive at the door unchecked. **Fix:** a names-free log of downloads; "new or changed since"
counted per adult; changed names labeled in the file.

### 6. Names to check sit below the Download buttons, and a fix after a download never reaches the office · severity 3 · UX (UI, Content, consultant: 2)
**Fix:** the names to check go in the top card, above the downloads; until each is saved or confirmed the button reads
"Download anyway (1 name not checked)"; a corrected name counts as changed ("3 new and 1 corrected").

### 7. "Saved" claims more than the app knows · severity 3 · UX, Content (consultant, Software Engineer: 2)
A cancelled print dialog would show "Saved" and turn off the last reminder. **Fix:** "Pat Morgan printed or downloaded
this report on Fri, Dec 4. Check that your school has the copy."; the deletion date stays visible; the week-before
email always goes, gentler when someone already printed or downloaded.

### 8. The report screen hides most rows · severity 3 · consultant (UX: 2)
"…and 18 more" with no way to see them or find someone. **Fix:** every row on screen, a "Find an adult or child" box,
and the same grouping live and final (Not checked in, Sent to the front office, Checked in), in print too.

### 9. The printed copy can come out blank · severity 3 · UI Designer (others noted it)
In dark mode the mock-up's printed page was white text on white. **Fix:** fixed black-on-white colors for print and any
print preview, letter width, real margins.

### 10. The privacy page doesn't mention the stop mark · severity 3 · Marketing
**Fix:** the Student data privacy page and the district packet list the mark (no reason stored), who sees it (the door
team), and when it's deleted, plus "totals with no names are kept".

## Should fix (severity 2)

- **Door note:** strong enough to see at a glance in dark and sun (UI, consultant), but neutral, not "failed a check"
  (Marketing); one line the volunteer can say ("Please ask Ben to go to the front office") (UX, consultant). Owner decides the look.
- **Stop action on every row** is noisy and alarming (UX, UI, consultant, Marketing): move to a quiet per-adult control;
  wording "Stop Ben at the door" / "Let Ben check in" / "Cancel" (Content).
- **Badge and Undo** too small; tint lost in dark (UI).
- **Children in one cell** in the visitor list (consultant): separate child, grade, and teacher columns. Owner decides the shape.
- **One system, one name** (Content): "the school's visitor system" and "the front office" everywhere.
- **"Names to check" wording** (Content): "We guessed where this first name ends. Check which part is the last name." /
  "Save name" / "It's right"; file cell "Check first and last name".
- **Top card wording** (Content): "Pat Morgan last downloaded the list…" (not "You"); one download button per job.
- **Wall of help text** (UX, Content): each line beside what it explains.
- **Printed scope line** (Content, consultant): print "Counts check-ins at the event door only…" and the printed-records note.
- **"This report" on Parent Registration** (Content): name the report.
- **Email subjects and bodies** (Content, consultant): deadline and event in every subject; say how to save.
- **"The school checks each adult's name"** is a promise some schools won't keep (Marketing): "The school may check…".
- **Privacy page deletion row** covers children only (Marketing): families' details and the report too.
- **Website copy** says we replace "a spreadsheet of children's names that never gets deleted" (Marketing): update it now
  that the school can download lists.
- **Co-host link** works only for the Account Host (Software Engineer): others see "Ask [Account Host] to add your
  office"; whether full Co-host access is right for the office is logged as an owner question.
- **Who can set the mark, and on the day** (consultant): Hosts and Co-hosts; show it set after the door opens.
- **Columns jump between sections; deletion deadline looks different in two places; phone order** (UI).

## Polish (severity 1)

Email send time ("the morning after", not a clock time), empty report after the event offers "Copy registration link",
"not yet" stat needs a noun, "Remove Marcus Lopez" tap area, dark-mode muted text, tablet tile wrapping, the 11 px
"photo ID checked" line, amber row without words on phone, period on "All times are Central Time.", "event team" vs
"organizers" on the form, website could mention the visitor list.

## What's working well

- The form's name hint with real examples, at the moment of typing (all 6)
- "3 adults have registered since" with "Download the 3 new adults" fits the office's real job (UX, consultant)
- The confirm window says exactly what will and won't happen; no reason saved; Ben isn't emailed (all 6)
- The stop note takes the Check in button's place, so it can't be tapped through (UX, UI, consultant)
- The report's honesty about its state: "Updated 11:15 AM", "Final", "In progress, as of…" (Content, consultant)
- Emails carry no family names; dates match the database's deletion and Co-host rules (Software Engineer, Marketing)

## Limits

This is an AI review, not testing with real people. Before launch, have the office administrator import a sample visitor
list into their real system, and have a volunteer try the stop note at a real door.

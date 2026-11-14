# Design review: visitor registration's background-check download and attendance report

| | |
|---|---|
| **What was reviewed** | Mock-ups (7 boards): first and last name boxes on the registration form; Registered families with a new download; the download's contents; the attendance report on the day, after, empty, and after deletion; the after-event card and a reminder email |
| **Stage** | Mock-ups before building |
| **Size** | Full panel: Product Manager, Product Owner, UX Designer, UI Designer, Software Engineer, UX Content Manager, Marketing Manager, usability consultant |
| **Date** | 2026-11-14 |
| **Not reviewed** | Check-in at the door, the rest of the registration form, Registration settings, pricing, walk-ups (owner: walk-ups stay in the school's own system) |

Screenshots: `docs/design-reviews/2026-11-14-visitor-attendance-mockups/` (each board at 390, 820, and 1440 px, light and dark).

## The consultant's verdict

Build after fixes. The structure fits how a school office really works: one file to import, one record to print, and
clear words about the 30-day deletion. The serious gap is data quality at the handoff: names from older registrations
that split wrong, and people who register after the file is downloaded, slip silently into the school's
background-check system and its permanent record. The change that would help most is catching names that need
checking on Parent Registration, with a way to fix them there, before the download.

## Blocks people (severity 3–4)

### 1. Older names split wrong, can't be fixed, and land in the school's record · severity 3 · 7 of 8
- **Where:** Board 3 "Check name" column; boards 4–5 "Dyke, Mary Ann Van"; board 2 (no warning, no way to fix)
- **What happens:** Families who registered before the two name boxes get split at the last space. "Mary Ann Van Dyke"
  becomes "Mary Ann Van / Dyke". The flag is a long sentence in the file's last column, off-screen on phones, and it
  marks every older name, even ones that split cleanly. Nothing in the app lets a host fix a name, and the report prints
  and sorts the wrong split with no flag.
- **Who it hurts:** The front office (a wrong name can fail the background check or the ID match at the door), the
  parent waiting at the door, and the organizer whose printed record looks careless.
- **Suggested fix:** Flag only names the split could get wrong (three or more words, or a word like van, de, or la).
  Show "2 names to check" above the downloads on Registered families, with First and Last boxes to fix each one. The
  fix carries into both the download and the report. Until fixed, the report shows the name as typed. Imports gain
  First name and Last name columns too, so imported families don't all get flagged.

### 2. Added adults get the registering parent's email and phone in the file · severity 3 · 6 of 8
- **Where:** Board 3: Luis Alvarez with linda.alvarez@example.com, Ben Brooks with Angela's phone
- **What happens:** Visitor systems often match or merge people by email, so two adults can merge into one record, or
  one person's check result attaches to the other. The "Visiting" column also sends children's names into another
  company's system, where the 30-day deletion promise doesn't reach.
- **Who it hurts:** The front office (wrong person cleared or flagged), and families.
- **Suggested fix:** Email and phone only on the registering adult's row. "Visiting" left out by default, or cut down
  to grade and teacher (owner decides). Confirm the columns with the office administrator before building.

### 3. The download goes stale with no warning · severity 3 · 4 of 8
- **Where:** Board 2, the new download
- **What happens:** The office imports after registration closes, but the button works any time and says nothing about
  registration still being open, when it was last downloaded, or who registered since. Late registrations never reach
  the school's system and get treated as walk-ups at the door. Downloading again re-imports everyone as duplicates.
- **Suggested fix:** Under the button: "Registration is open until Mon, Nov 30. Download after it closes to get
  everyone", then "Last downloaded Dec 1 by Dana Ortiz · 3 adults registered since", with "Download only the 3 new
  adults". Once registration closes, a top card says "Send their names to your school's visitor system before Thu, Dec 3".

### 4. When the report is final, and practice check-ins · severity 3 · 5 of 8
- **Where:** Board 4 note and buttons; board 5 status column
- **What happens:** Check-in opens the day before as a practice run and stays open all of the event day, not just until
  1:00 PM. Practice taps carry into the record, a late check-in flips "Didn't come" back, and the filled "Print or save
  as PDF" button invites printing a partial report that could be filed as final. "Not yet" people are scattered through
  the list, so "who isn't here?" means reading every row.
- **Suggested fix:** The report becomes final when check-in closes at the end of the event day; until then it says
  "Not yet" and shows "Updated 11:15 AM". Practice check-ins from the day before are left out. On the day, both buttons
  are secondary, printed copies say "In progress, as of 11:15 AM", and "Not yet (11)" is listed first.

### 5. "Didn't come" claims more than the app knows · severity 3 · 4 of 8
- **Where:** Boards 4–5 status column, summary line, email
- **What happens:** A parent sent to the front office, or missed by a volunteer, is printed as "Didn't come" on the
  school's record.
- **Suggested fix:** "Not checked in" everywhere, in regular weight: "28 of 34 registered adults checked in · 6 not
  checked in". "Adults who came" becomes "Adults checked in".

### 6. Co-hosts of one event lose access before the reminder and the deletion · severity 3 · 2 of 8
- **Where:** Board 7 email "To: hosts and co-hosts"; boards 2, 4, 5 access line
- **What happens:** A co-host of one event can see it only until 10 days after (the app's rule and the Student data
  privacy page both say so). The report lives until day 30 and the email goes out on day 23, so they'd get an email
  for a page that refuses them.
- **Suggested fix (owner decides):** (a) only people who can still open it get the email (Account Host and co-hosts of
  every event), and co-hosts of one event get a "save it before your access ends" note around day 7; or (b) let them
  open this one report until day 30, and update the privacy page in the same change.

### 7. Families aren't told their names go to the school's visitor system · severity 3 · 2 of 8
- **Where:** Board 1, the form; its footer "Only the school's event team sees these details"
- **What happens:** The download exists to put every adult into the school's background-check system, where the
  school's rules apply. The form still says only the event team sees the details and that they're deleted in 30 days.
- **Suggested fix:** Under the name boxes: "The school checks these names in its visitor system before the event." The
  footer and the Student data privacy page say the same.

### 8. The office that runs the checks may not be able to get the file · severity 3 · 1 of 8 (UX Designer)
- **Where:** Board 2, board 7
- **What happens:** At a class party the host is often a PTO parent or teacher. Nothing tells them the office needs
  this file or how to give the office access, so they email a spreadsheet of families around, or the office never gets it.
- **Suggested fix:** Under the downloads: "Does your school office run the background checks? Add them as a co-host so
  they can download this list and the report", linking to the co-host invitation.

### 9. A failed background check never reaches the door · severity 3 · 1 of 8 (UX Designer)
- **Where:** The whole flow: download, the school's system, then check-in
- **What happens:** If the school's system flags someone, there's no way to mark them in the app, so a door volunteer
  checks them in after a normal ID check.
- **Suggested fix (owner decides):** either hosts can mark an adult "Send to the front office" and Check-in shows a stop
  note with no Check in button, or a line under the download says "If someone doesn't clear, tell your door volunteers
  directly. The app can't stop a check-in."

### 10. The deleted page can't show what it promises · severity 3 · 1 of 8 (Software Engineer)
- **Where:** Board 6, "What's kept: 28 of 34"
- **What happens:** The daily clean-up deletes every registration row, so nothing is left to count, and "nobody
  registered" and "deleted" can't be told apart.
- **Suggested fix:** Keep a small totals record (counts only, no names) when the clean-up runs, readable only by the
  event's hosts, with a security test. Or drop the "What's kept" line.

### 11. Spreadsheet formulas typed by the public · severity 3 · 1 of 8 (Software Engineer)
- **Where:** Every download (including today's "Download list")
- **What happens:** A name typed on the public form as `=HYPERLINK(...)` runs as a formula when the office opens the
  file in Excel. Without a byte-order mark, names like José or Nguyễn can come out garbled.
- **Suggested fix:** One shared spreadsheet writer that neutralizes formulas and adds the byte-order mark, made on the
  server, with a test.

### 12. One reminder, during winter break · severity 3 · 4 of 8
- **Where:** Board 7 email, sent Sun, Dec 27, before Jan 3 deletion
- **What happens:** December and June events put the only reminder and the deletion inside a school break. Once
  missed, the record is gone. Nothing records that someone already saved it, so co-hosts can't tell it's handled.
- **Suggested fix:** First email the morning after the event ("Your attendance report is ready to save"); a second a
  week before deletion only if nobody has downloaded or printed it. The top card shows "Saved by Dana Ortiz on Dec 4"
  once someone has.

## Should fix (severity 2)

- **13. Name it what schools call it** (Marketing): "Attendance report" next to a privacy page that says "we never
  collect school attendance" may read as student attendance. Suggest "Visitor check-in report" (owner decides). Download
  names too (Content, Marketing): "Download list" → "Download class list"; "Download for background checks" → "Download
  visitor list", since the app doesn't run background checks itself.
- **14. "by Dana Ortiz" can go blank** (Software Engineer, Product Owner): some hosts can't read the door volunteer's
  name, and removed or deleted people disappear. Save the volunteer's name at check-in; show the time alone when unknown.
- **15. Who-can-see line isn't fully true** (Software Engineer, Marketing, Content): Volunteer Leads can already read
  families' details for check-in. Say exactly who sees what, with "Host" and "Co-host" capitalized, once on Parent
  Registration (not repeated in the report footer).
- **16. Phone rows lose their labels** (UI, Content): stacked rows read "11:04 AM by Dana Ortiz" with nothing saying
  what happened. Use the Meeting summary's labeled cells ("Checked in 11:04 AM by Dana Ortiz").
- **17. Event-day Parent Registration and print layout aren't drawn** (Product Owner, UI): show the event-day button
  ("Open attendance report · 23 of 34 checked in so far"), a disabled-looking button before the day, and a print preview
  with repeating headers, whole rows, "Printed {date} · Page N", and every row (not "…and 20 more").
- **18. The deletion warning looks routine** (UI, Consultant, Content): use the warning style, date first and bold:
  "Save a copy before Sun, Jan 3, 2027. That day [brand] deletes families' and children's details, including this
  report." One wording everywhere; drop "30 days after" wherever a date is shown.
- **19. More missing states** (Product Owner): no families (hide downloads), a failed download, multi-day events
  (dates on times), the top card after deletion, no reminder when nobody registered.
- **20. Help with compound last names on the form** (Content, UX): "Put your whole last name in Last name, like Van Dyke
  or García López."
- **21. "By class" table** (Product Manager: leave out of the first version; Software Engineer: teacher names typed by
  parents split one class into several, so use the existing normalizer). Owner decides.
- **22. Search box has no label** (Consultant): add "Find a family".
- **23. Many registrations** (Software Engineer): the real report lists every adult (about 600 rows for the 400-family
  demo): render on the server and test with the demo event.

## Polish (severity 1)

- Sample data: board 1's Tom Lopez vs board 2's Marcus Lopez (Product Owner)
- Captions and access line at 12 px; use 14 px (UI, Consultant)
- Alignment: name and email grids 2 px apart; By class numbers not right-aligned (UI)
- "Remove Tom Lopez" needs a 44 px tap area (Consultant)
- Empty and deleted states end with no next step (UI, Consultant, Marketing)
- Same label in the email and the app: "Open attendance report" (Content, Consultant, Marketing)
- Measure whether it works: downloaded, saved before deletion; ask the administrator after the first event (PM)

## What's working well

- The flow follows the office's real routine, and walk-ups stay out, said in plain words (all 8)
- "Your name, as it's on your photo ID" over two boxes asks for the right thing at the right moment (6)
- Each download says what it's for; fixed columns keep a saved import setting working (6)
- One report page that changes through the day (before, during, after, deleted), with the deletion date always a real date (7)
- The reminder email has no names and asks people to sign in (6)
- Statuses in words, not color; works in light and dark at every width (UI, Consultant)
- The data needed for the report (each adult's check-in time and who checked them in) is already stored (Software Engineer)

## By role

- **Product Manager:** the feature fails if the file doesn't import; test it with the real administrator before
  building. Only reviewer to question the By class table and to ask how we'll measure success.
- **Product Owner:** the "final" moment must match when check-in actually closes; practice taps leak in. Wrote the
  acceptance criteria below.
- **UX Designer:** the only reviewer to raise the handoff to the office (#8) and the failed-check loop (#9); pushed for
  a top card when the download is due.
- **UI Designer:** event-day hierarchy (Print shouldn't lead), the "Not yet" list, print layout, and phone labels.
- **Software Engineer:** most of the engineering risk: the name split touches about 20 files, the clean-up deletes the
  counts (#10), spreadsheet formulas (#11), co-host access ends at day 10 (#6), and email recipients settings.
- **UX Content Manager:** "Not checked in", clearer download names, one deletion wording, compound-name help.
- **Marketing Manager:** two promises at risk: families aren't told about the school's system (#7), and co-hosts'
  access on the privacy page (#6). Suggested renaming away from "attendance".
- **Consultant:** build after fixes; names that need checking are the top priority.

## Acceptance criteria (from the Product Owner)

- Given a family registering, when they fill in the You card, then First and Last name are separate required fields,
  for them and each other adult, with errors beside each field.
- Given 24 families with 34 adults, when a host downloads the visitor list, then a file downloads with 34 rows, one per
  adult, sorted by last name, in a fixed column order.
- Given a registration from before the split, when downloaded, then the name is split at the last space and flagged
  only if the split could be wrong; a split registration is never flagged.
- Given registration is still open, when a host views the downloads, then they see that it's open and when it closes.
- Given a volunteer who isn't a Host or Co-host, when they open the download or the report, then they're refused,
  enforced in the database with a case in security_test.sql.
- Given the day before the event, when a host opens the report, then they see when it opens.
- Given the event day, when a host opens the report, then counts and "Not yet" update as check-ins happen, and an
  undone check-in disappears from the report.
- Given check-in has closed, when a host opens the report, then everyone not checked in reads "Not checked in", the
  page says it's final, and printing gives every row.
- Given the event is over, when the reminder runs, then hosts get an email with no names and a sign-in link, and none
  is sent when nobody registered.
- Given the deletion date has passed, when a host opens the report, then they see the deleted state.
- Given no families, when a host opens Parent Registration or the report, then no downloads show and the report says
  no families registered.

## Limits

This is an AI review, not testing with real people. For anything rated 3, try it with two or three real people before
launch: above all, have the office administrator import a sample file into their real system.

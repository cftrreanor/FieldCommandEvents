# Decisions: visitor registration's background-check download and attendance report (2026-11-14)

Review: docs/design-reviews/2026-11-14-visitor-attendance-mockups.md

Owner request: an office administrator retypes every registered adult into the school's background-check system,
and wants a record of who came. Owner decisions before the mock-ups:
- One row per adult in a download made for the school's visitor system ("I don't think the system is that
  sophisticated"; still confirming what the office's system needs).
- No walk-ups: they go to the front office and are scanned in the school's own system.
- The registration form asks first and last names in separate boxes; older registrations are split automatically and
  marked to check.
- Only Hosts and Co-hosts open the report and the downloads.

Full panel on the mock-ups. Owner decisions:

| # | Finding | Severity | Decision | Notes |
|---|---|---|---|---|
| 1 | Older names split wrong, can't be fixed | 3 | Take the advice | Flag only risky splits; hosts fix First/Last on Registered families; report shows the typed name until fixed; imports gain First/Last columns |
| 2 | Added adults get the registering parent's email and phone; children's names in the file | 3 | Fix it differently | Email and phone only on the registering adult's row. **Keep children's names** in the visitor list ("Zoe Van Dyke (2nd, Lee)"), owner's choice: most useful to the office. The form and privacy page say names go to the school's own system (see 7) |
| 3 | Download goes stale | 3 | Take the advice | Registration state, last downloaded, "only the N new adults", and a top card once registration closes |
| 4 | When the report is final; practice check-ins | 3 | Take the advice | Final when check-in closes; practice check-ins left out; on the day both buttons secondary, "In progress, as of" on printouts, "Not yet" first, "Updated" time |
| 5 | "Didn't come" overclaims | 3 | Take the advice | "Not checked in" everywhere |
| 6 | Co-hosts of one event lose access at day 10 | 3 | Take the advice (a) | Privacy promise unchanged. Co-hosts of one event get a "save the report before your access ends" email by day 7; the Account Host and co-hosts of every event get the later reminders |
| 7 | Families aren't told about the school's visitor system | 3 | Take the advice | Line under the name boxes; footer and Student data privacy page match, including that children's names go to the school's system with the adult's |
| 8 | The office may not get the file | 3 | Take the advice | "Add your school office as a co-host" line, linking to the invitation |
| 9 | A failed check never reaches the door | 3 | Fix it differently | **Add a stop mark** (owner's choice over a note): Hosts can mark an adult "Send to the front office"; Check-in shows a stop note and no Check in button for them. Enforced in the database, with security tests |
| 10 | Deleted page can't show its count | 3 | Take the advice | Keep a names-free totals record at clean-up, hosts only, with a security test |
| 11 | Spreadsheet formulas typed by the public | 3 | Take the advice | One shared spreadsheet writer for every download, made on the server |
| 12 | One reminder, during winter break | 3 | Take the advice | First email the morning after; second a week before deletion only if nobody saved it; "Saved by … on …" on the card |
| 13 | Names | 2 | Take the advice | "Visitor check-in report"; "Download class list" and "Download visitor list" |
| 14 | "by" name can go blank | 2 | Take the advice | Save the volunteer's name at check-in; time alone when unknown |
| 15 | Who-can-see line | 2 | Take the advice | Exact wording, once, "Hosts" and "Co-hosts" capitalized |
| 16 | Phone rows lose labels | 2 | Take the advice | Labeled cells like the Meeting summary |
| 17 | Event-day page and print layout not drawn | 2 | Take the advice | Drawn in round 2 |
| 18 | Deletion warning looks routine | 2 | Take the advice | Warning style, date first, one wording |
| 19 | Missing states | 2 | Take the advice | No families, failed download, multi-day, after deletion, no reminder when nobody registered |
| 20 | Compound last names | 2 | Take the advice | Hint under the name boxes |
| 21 | By class table | 2 | Take the advice | Left out of the first version |
| 22 | Search box label | 2 | Take the advice | "Find a family" |
| 23 | Hundreds of rows | 2 | Take the advice | Server-rendered; tested with the 400-family demo |

Severity 1 items: all as recommended.

Next: round-2 mock-ups of the changed parts (including the stop mark at Check-in), a light check, then build.

## Round 2: light check on the revised mock-ups (2026-11-14)

Review: docs/design-reviews/2026-11-14-visitor-attendance-mockups-2.md (UX, UI, Software Engineer, Content, Marketing,
consultant). Owner decisions:

| # | Finding | Severity | Decision | Notes |
|---|---|---|---|---|
| 1 | Stop mark enforced by the database | 4 | Take the advice | Check-in refuses a marked adult; only Hosts and Co-hosts set or clear it; security tests |
| 2 | Other adults have no lasting identity | 3 | Take the advice | Each adult gets their own record; parents can't rename or remove a marked adult or cancel a marked registration |
| 3 | "Only Hosts and Co-hosts" isn't true of the data | 3 | Take the advice, narrowed | **Owner: Volunteer Leads (and the door team) see families only from the day before the event through the event day, and never email addresses.** Downloads and report built on the server behind a Host/Co-host check |
| 4 | "Final" isn't final | 3 | Take the advice | Check-ins and stop marks lock after the event's last day; practice check-ins from the day before are cleared when the event day starts |
| 5 | "New since" needs a download log | 3 | Take the advice | Names-free download log; new or changed adults counted per adult; changed names labeled |
| 6 | Names to check below the download | 3 | Take the advice | In the top card, above the download; corrected names count as changed |
| 7 | "Saved" overclaims | 3 | Take the advice | "printed or downloaded by…"; the week-before email always goes |
| 8 | Report hides rows | 3 | Take the advice | Every row, a find box, same grouping live and final, in print too |
| 9 | Printed copy can come out blank | 3 | Take the advice | Fixed black-on-white print styles |
| 10 | Privacy page and the stop mark | 3 | Take the advice | Privacy page and district packet updated in the same change |
| — | Door note look | 2 | Owner's choice | **Clear but neutral:** as big as the Check in button, strong border in both themes, "Please ask Ben to go to the front office." No red or lock |
| — | Children in the visitor list | 2 | Owner's choice | **One row per adult per child**, with Child name, Grade, and Teacher columns |
| — | All other severity 2 and 1 findings | 2/1 | Take the advice | As written in the report |

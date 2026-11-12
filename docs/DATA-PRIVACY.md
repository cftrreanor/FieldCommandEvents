# Student data privacy: district packet and Texas agreement exhibits

**Draft for attorney review, October 2026.** Facts are taken from the code and database as of
this date. Items marked **[confirm]** need a check outside the code (a vendor setting or a
business decision). Keep this file current: any change to what's collected, who can see it, or
when it's deleted must be reflected here and on the website's Student data privacy page.

- **Part 1** is the packet to send a district's technology or legal team.
- **Part 2** is the draft content for the Texas Student Privacy Alliance's data privacy
  agreement (TX-NDPA, built on the Student Data Privacy Consortium's national template).
- **Part 3** is what to close before signing the first agreement.

---

# Part 1: District packet

## Summary

Field Command Events is a web app that schools, PTOs, and booster clubs use to run events:
contests and festivals, volunteer events, school fairs, family visitor days, and
parent-teacher conferences.

- We collect only what each event needs. Most events collect no student information at all.
- Student information, where an event needs it, is limited to a name and, for visitor days,
  the child's teacher and grade. It's deleted 30 days after the event.
- The information belongs to the school or organization running the event. We store it for
  them, use it only to run their event, never sell it, and never show ads.
- Data is stored in the United States.
- Families, volunteers, and visitors don't make accounts and never pay.

## What we collect, by kind of event

| Event | About students | About adults |
|---|---|---|
| Band contests and choir, orchestra, and group festivals | **None.** Headcounts only (students, chaperones, vehicles). | Directors' names, school email addresses, and phone numbers; school name and address |
| Volunteer events and fair volunteer stations | Under-18 helpers: **first name and last initial only** (for example "Emma R."), signed up by a parent or guardian | Volunteers' names, email addresses, and phone numbers; shift check-in times |
| School fairs | None | Booth partners' contact name, email address, and phone number |
| Family visitor days (lunches, open houses, class parties) | Each child's **name, teacher, and grade** | Parent's name, email address, and phone number; other adults' names; door check-in times |
| Parent-teacher conferences | The child's **name** and the parent's optional note to the teacher | Up to four parents' names, email addresses, and phone numbers; for phone calls, the number the teacher calls; whether the meeting happened |
| Organizer and team accounts | None | Name, email address, phone number (optional), and sign-in history |

We don't collect student ID numbers, dates of birth, addresses, grades or scores, attendance,
health, discipline, or special education information, and students never have accounts.

## Who can see it

Access is enforced by the database itself, not just by the app's screens, and every rule has an
automated test.

- **Families' and children's details (visitor days):** the event's Hosts, Co-hosts, and
  Volunteer Leads (who run the door desk), and Coordinators on event day only.
- **Conference bookings, parents' notes, and the number to call for phone calls:** only the teacher who set up the conference and the hosts and co-hosts on their account (20261228000000_reschedule_meetings.sql), who can reschedule or cancel a meeting. Hosts can also send booking emails to up to five other addresses they choose (20261230000000_notification_recipients.sql, Event settings → Notifications); when they do, the family's privacy note and booking emails say their details go to the people the teacher chose to notify. The same setting can send a daily summary of volunteer sign-ups and cancellations (names and shifts) to the hosts, Volunteer Leads, or addresses they pick. A cancelled sign-up is kept for that summary (the volunteer's name, the shift, and when) in volunteer_dropped_shifts, which only the server can read, and deleted after 7 days. Cancelled items to bring are noted there the same way. A switched shift is noted the same way in volunteer_changes (20270102000000_group_signup.sql), also deleted after 7 days. Each person picks what their summary includes (new bookings, changes, cancellations) in volunteer_digest_prefs; they see only their own choices, and hosts see everyone's on their events.
- **Feedback** (feedback, 20270103000000_feedback.sql): what someone sends from the Feedback button, the page path (private links replaced by ":link"), their browser type, an optional screenshot (private storage), and, for signed-in people, their name, email, and account; others may give an email for a reply. Only platform admins can read it. The GitHub issue made from it holds the message, page, and role only, never a name, email, or screenshot.
- **Guardian confirmations for under-18 volunteers** (minor_consents, 20270102000000_group_signup.sql): when someone signs up a minor, the booker's name and email, the minor's first name and last initial, the time with its time zone, and the exact words they confirmed are kept permanently, so organizers can show who gave permission. No one can edit or delete them; only the event's hosts and Volunteer Leads can read them. A minor's age is kept on their volunteer record to check shifts with a minimum age.
- **Items to bring (20261231000000_items_to_bring.sql):** when a volunteer signs up to bring something, the public sign-up page shows their first name and their short note (like "Brownies") next to the item, so others can see what's covered; the sign-up form says so. Their full name, email, and phone are seen only by the event's hosts and Volunteer Leads. Item sign-ups are deleted with the volunteer, 10 days after the event.
  Other hosts on the same account see how many times are booked, not who booked
  (database update `20261209000000_conference_teacher_only.sql`).
- **Volunteers' phone numbers:** Hosts, Co-hosts, and Volunteer Leads; Coordinators only on
  event day.
- **Visiting directors:** see their own registration, never other schools' contact details.
- **The public:** sees only what the organizer publishes, such as the schedule. Families never
  see who else booked or registered.
- **Our staff:** a small number of platform administrators can access accounts to provide
  support. Account changes they make are logged.

## Where it's stored, and who else handles it

All data is stored in the United States. **[confirm]** the data region chosen for Sentry
(US is the default) and Resend's sending region.

| Service provider | What it does | What it receives |
|---|---|---|
| Supabase | Database, sign-in, and file storage (US region) | Everything listed above |
| Vercel | Hosts the website and app (US) | Requests as they pass through; short-term server logs |
| Resend | Sends email | Recipients' addresses and each email's content, which can include a child's name in that family's own confirmation, and in the teacher's booking notice (subjects never name the child) |
| Sentry | Error alerts | Technical error details only. Names of people, email addresses, phone numbers, form contents, and private links are removed or never collected. |
| Cloudflare Turnstile | "Not a robot" check on public forms | The visitor's IP address and browser signals, for that check only |
| Google Maps Platform | Venue address search for organizers | The address text an organizer types. No personal information. |

We don't use advertising, analytics, or tracking services.

## How it's protected

- **Encryption:** in transit (HTTPS everywhere) and at rest (Supabase encrypts stored data).
  **[confirm]** the encryption standard in Supabase's current security documentation.
- **Database privacy rules** on every table, so one school can never read another's data, and
  signed-out visitors can't change anything. Independent review: penetration test, October 2026
  (no critical, high, or medium issues in the database).
- **Private links** for families and volunteers use long random keys, not guessable numbers.
- **Files** (maps, packets) are stored privately and opened through links that expire after 60
  seconds (30 minutes on the volunteer badge print page, for a map printed on the back).
- **Abuse limits:** bot protection on public forms, and limits on how often links and
  invitations can be re-sent.
- **Pages can't be embedded** in other sites, and the app sends standard security headers.

## When it's deleted

Deletion runs automatically every day.

| Information | Deleted |
|---|---|
| Children's details from visitor days | 30 days after the event |
| Conference bookings (child's name, parents, notes, number to call) | 30 days after the conference; for weekly hours, 30 days after each meeting (`20261211000000_conference_weekly_hours.sql`) |
| Volunteers, including under-18 helpers | 10 days after the event (shift totals are kept, without names) |
| Files shared with an event | 30 days after the event |
| Booth partners' contact details | 15 months after the event |
| Band directors' contact details | 2 years after the event (so a contest can invite them back) |
| A closed account and everything in it | 90 days after it's closed |
| Email delivery records | 14 to 180 days |

An organizer can also delete an event at any time, which removes everything attached to it
right away. Emails and calendar invites already sent (to families, volunteers, directors, and
conference teachers, whose invite names the child by first name and last initial and, for phone
calls, gives the number to call) stay in each
recipient's inbox and calendar. Copies an organizer prints, downloads, or copies out of the app are the school's own
records, kept under the school's policies.

## Ownership and how we use it

- The school or organization owns the information. We act on their instructions.
- We use it only to run their events: sign-ups, confirmations, reminders, and check-in.
- We never sell it, never use it for advertising, and never send marketing to families,
  students, or volunteers.
- We don't build profiles of students or use student information to train AI models.
- Sponsors (an add-on we switch on per account, 20270201000000_sponsors.sql): organizers can thank their own sponsors
  on the main public page of a band contest, festival, or school fair, never on sign-up or registration pages,
  private links, or emails. We never sell or place sponsors. Logos are stored and served by us, links carry no
  tracking and aren't counted, and no family, student, or volunteer information is shared with sponsors.

## Requests and incidents

- **Access, correction, or deletion:** the school or organization can make changes in the app,
  or email product@fieldcommandevents.com and we'll do it. **[confirm]** the response time to
  promise.
- **Security incidents:** if student information is involved in a breach, we notify the
  district within the time its agreement requires (72 hours in the Texas agreement; **[confirm]**
  with the attorney) and work with them on notifying families.

---

# Part 2: Texas agreement (TX-NDPA) draft exhibits

Plan: sign the Texas Student Privacy Alliance's standard agreement when a district asks, so
districts can say yes quickly. **[confirm]** with the attorney the current version and its
exhibit letters; the outline below follows the national template.

## Exhibit A: Description of services

Field Command Events is a web application for planning and running school events. Organizers
(school staff, PTO and PTA leaders, and booster club volunteers) create events and share sign-up
links. Families, volunteers, and visiting directors sign up without an account. On event day,
the organizer's team checks people in on their own phones. Types of events: band contests;
choir, orchestra, theater, and academic festivals; volunteer events; school fairs and
fundraisers; family visitor days; and parent-teacher conference scheduling.

## Exhibit B: Schedule of data

Check marks show data the service can collect when a district uses the matching kind of event.

| Category | Element | Collected | Notes |
|---|---|---|---|
| Application technology metadata | IP addresses | ✓ | Passed to Cloudflare for bot checks on public forms; short-term hosting logs |
| | Browser, device, cookies | ✓ | Sign-in cookie for account users only; no tracking cookies |
| Application use statistics | Meta data on user interaction | | Not collected (no analytics) |
| Assessment | Any | | Not collected |
| Attendance | Student school attendance | | Not collected. Event check-in times are recorded for adults. |
| Communications | Online communications | ✓ | Emails the service sends (confirmations, reminders, organizer announcements); a parent's optional note to a teacher |
| Conduct | Any | | Not collected |
| Demographics | Date of birth, gender, ethnicity, language, and the like | | Not collected |
| Enrollment | Grade level | ✓ | Visitor days only, entered by the parent |
| | Homeroom or teacher | ✓ | Visitor days only, entered by the parent |
| | Student school, enrollment, ID | | Not collected |
| Parent or guardian contact information | Name, email address, phone number | ✓ | Visitor days and conferences |
| Parent or guardian ID | Any | | Not collected (ID is checked in person at the door, not recorded) |
| Schedule | Student scheduled courses | | Not collected. Conference meeting times only. |
| Special indicator | Disability, health, special education, and the like | | Not collected. The two optional free-text boxes ask people to leave health details out (Part 3). |
| Student contact information | Address, email address, phone number | | Not collected |
| Student identifiers | Local, state, or vendor IDs | | Not collected |
| Student in-app performance | Any | | Not collected |
| Student program membership | Band, choir, and other groups | | Group-level only (a band's name and headcounts); no individual students |
| Student name | First and last name | ✓ | Visitor days and conferences: full name. Under-18 volunteers: first name and last initial. |
| Student survey responses | Any | | Not collected |
| Student work | Any | | Not collected |
| Transcript | Any | | Not collected |
| Transportation | Bus routes and the like | | Not collected. Contests record how many buses and trucks a band brings. |
| Other | Conference outcome | ✓ | Whether a scheduled meeting took place (met or no-show), visible only to the teacher who set up the conference |

## Exhibit D: Directive for disposition of data

Default: data is disposed of automatically on the schedule in Part 1. On a district's written
request, or when the agreement ends, we delete all of that district's data from the live
database within **[confirm]** days and confirm in writing. Data in backups expires on the backup
provider's schedule (**[confirm]** Supabase backup retention for the current plan).

## Exhibit E: General offer of privacy terms

Recommended: after the first Texas district signs, sign Exhibit E so other Texas districts can
adopt the same terms without negotiating again.

## Exhibit F: Data security

**[confirm]** with the attorney which framework to name (the template offers several, such as
the NIST Cybersecurity Framework). Controls in place today are listed in Part 1, "How it's
protected." Supporting documents: docs/SECURITY-REVIEW-2026-10.md and
supabase/tests/security_test.sql.

## Subprocessors

Supabase, Vercel, Resend, Sentry, Cloudflare, and Google (Maps Platform, no personal
information), as described in Part 1.

---

# Part 3: Before signing the first agreement

1. **Records with no automatic deletion yet.** These are about adults, not students, but a
   district may ask for deletion of everything:
   - admin activity log;
   - records of removed team members;
   - directors' sign-in accounts;
   - names on contest-day activity notes, which go when the event is deleted;
   - unused invitations;
   - Supabase's sign-in audit log.

   **Owner decision (October 2026): no "delete everything" tool for now.** A district's
   deletion request is handled by hand with the developer, case by case, until the
   implications are clear. Decide with the attorney how long Exhibit D should allow for that.
2. **No self-service account deletion.** Today an administrator closes accounts on request. This
   is acceptable if the agreement allows email requests.
3. **Free-text fields** (band "accessibility or staging needs" and a parent's note to a
   teacher) could receive health or disability details. ✅ Each now asks people to leave
   students' names (bands) and health details out.
4. **Email content at Resend.** Confirmation emails to a family can include their child's name.
   **[confirm]** how long Resend keeps email content, and shorten it if the setting allows.
5. **Service provider agreements.** Accept each provider's data processing agreement (Supabase,
   Vercel, Resend, Sentry, and Cloudflare publish them) and keep copies.
6. **Backups.** **[confirm]** the Supabase plan's backup retention, so Exhibit D states how long
   deleted data can remain in backups.
7. **Insurance.** Many districts ask for cyber liability insurance. **[confirm]** with the
   attorney or an insurance agent.
8. ✅ **Fixed:** visitor-day and conference deletion now counts days in the event's own time
   zone, like volunteers' (database update `20261201000000_retention_event_time_zone.sql`).

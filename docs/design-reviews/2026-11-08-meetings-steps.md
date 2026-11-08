# Design review: Meetings, set up in steps (built, before the PR)

| | |
|---|---|
| **What was reviewed** | The new stepped setup for Meetings and parent-teacher conferences (Details, Meeting times, Where you'll meet, More options, Publish), Meeting setup after publishing, changing hours after people book, and the changed booking, cancel, full, summary, and email screens (18 screens) |
| **Stage** | Built pages with sample data, before the PR |
| **Size** | Full panel: Product Manager, Product Owner, UX Designer, UI Designer, Software Engineer, UX Content Manager, Marketing Manager, usability consultant |
| **Date** | 2026-11-08 |
| **Screenshots** | `docs/design-reviews/2026-11-08-meetings-steps/` (108: 18 screens, phone, tablet, desktop, light and dark) |
| **Not reviewed** | The rest of the app, the website page, phone-call bookings, the reminder and reschedule emails, and "Make a weekly copy" after pressing it |

**Coverage:** every reviewer opened what their role requires; the UI Designer and the consultant opened all 108.
Several reviewers noted the sample data was inconsistent (a leftover "Test Person 0", 10 booked on one
screen and 12 on the next). Reseed before the PR screenshots.

## The consultant's verdict

**Fix first.** The person booking is well served: the booking page, "You're booked", the email, the cancel
windows, and the full page are clear and calm. The organizer's setup has one structural flaw: the most basic
choice, one day or every week, sits in the optional More options step, while Meeting times asks only for one
day and step 1 says the switch is in Meeting times. A booster president setting up weekly office hours will
publish one Saturday without knowing it. **The one change that would help most:** put "One day / Every week"
first on Meeting times, carry the hours over when switching, and leave only true extras in More options.

## Blocks people (severity 3)

### 1. Every week is in the optional step · 7 of 8
- **Where:** 04 Meeting times (one day only), 06 and 06b More options, 03 step 1 ("switch … in Meeting times")
- **What happens:** weekly hours are the usual case for advisers, coaches, and office hours, but the choice is in a
  step labeled optional with "Skip to Publish". Switching throws away the hours already set, opens with a red
  "Last day" before anything is typed, and blocks the "optional" step. Step 1 points to the wrong step. Once
  people book, the event is locked to one day.
- **Suggested fix:** "When can people meet with you? One day / Every week" first on Meeting times, with the
  weekly fields there; switching ticks the chosen day's weekday and keeps its hours; no red until a field is
  left empty; More options keeps phone calls (see the theme below), time between meetings, breaks, the booking
  window, and days off. This reverses part of the owner's earlier "extras" choice, so it needs a decision.

### 2. Changing hours after people book: the reason Save won't work is out of view, and there may be nowhere to move people · 6 of 8
- **Where:** 09
- **What happens:** Save turns into the "not ready" style; the reason and the "Save anyway" tick are below the bar
  (and under it on tablet). When every time is booked, "reschedule them" has nothing to move them to. After
  saving, the organizer fixes each person one at a time, with no list to work from.
- **Options:** (a) the bar says "4 booked meetings don't fit · Review" and jumps to the box; after saving, Your
  meetings opens with those people pinned at the top; (b) also offer "Save and email these 4 a link to pick a
  new time" (or "Cancel all 4 and email them"), and say when no open times are left.

### 3. People are told two different things about the video link, and the removed option still works in the database · 2 of 8
- **Where:** 13 and 14 ("in your confirmation email") vs the change-or-cancel page ("will send you the link in a
  calendar invite"); the publish check still lets old "I'll add it to each invite" events through
- **Suggested fix:** one sentence about the video link, used everywhere; a database update that drops the old
  option (old events with it go back to needing a pasted link, with a note), with a test; a "Join video
  meeting" button on the person's own booking page.

### 4. "Meetings" means two things on the organizer's screens · UX Content Manager
- **What happens:** "12 meetings · 12 booked" (openings) next to "4 booked meetings don't fit" (people) on the
  page where hours change.
- **Suggested fix:** "times" for openings everywhere ("16 times · 3:00 PM – 7:00 PM"), "meetings" only for what's
  booked, as Your meetings already does ("10 / 12 times booked").

### 5. Bugs in the new build · Software Engineer, UI Designer
These are mistakes in what was just built, not design choices:
- "Make a weekly copy" doesn't make a copy; it re-saves the times (and would fail for a co-host, carry over a
  video link for a meeting that's over, and drop "ask for the child's name")
- Moving a one-day event to a new day lists every booking as "doesn't fit", though they move with the day
- The printable summary shows a parent's mobile, not the number to call, for phone calls; and it scrolls
  sideways on a phone
- A self-saving step can stick on "Saving…" when its own check fails (no day tapped)
- Where you'll meet saves all or nothing, so an address typed before the video link is ready is lost
- The weekly From and To boxes cut off AM/PM on tablet and desktop

### 6. "Your number isn't shared" isn't true when calling from your own phone · Marketing Manager
- **Suggested fix:** "We never show your number. Calling from your own phone? Dial *67 first to hide it, or use
  a work phone."

## Should fix (severity 2)

**Setup**
- Phone calls belong with In person and Video on Where you'll meet, not in More options (6 of 8). This also
  reverses part of the owner's earlier choice
- Three progress trackers on one page (the step bar, the Event setup panel, and a phone bar), plus a second
  menu on step 1; "Add the date, time, and place" points to the wrong place (6 of 8)
- A "Saved." toast and the bar's "✓ Saved" at once; the toast covers text (5 of 8)
- No way to preview the booking page before publishing (3 of 8)
- After publishing, "Your meetings" is the smallest button and Unpublish the biggest; the second tab is cut
  off on phones (4 of 8)
- On phones the step bar's strips read as belonging to the wrong step
- "Not ready" buttons look three different ways; the dashed one looks pressable in dark mode
- Saves from two steps or two people can overwrite each other's settings (drafts only)
- The "doesn't fit" check misses new bookings, counts past meetings, and ignores days off
- If the cancel email fails, the person's contact details are only in a message that fades

**Booking and after**
- "You choose below" stays after booking and on the full page (5 of 8)
- The full page publishes the organizer's account email without asking (3 of 8)
- The booking page and email lead with our brand, not the organizer's group
- "Everything is permanently deleted" goes further than what happens (copies stay in inboxes, email records
  for two weeks)
- The tagline in emails and the line on booking pages aren't the brand tagline (2 of 8)
- The Meetings and conferences cards still read almost the same (4 of 8)
- In dark mode, windows blend into the page and open times look booked
- The email shows the place in light gray, like fine print

**Ideas raised, for later**
- Book a time for someone who calls or stops by; start from an earlier meetings event; a short "what people
  should know" note; "email me if a time opens" on a full page; measures to tell if the steps work

## Polish (severity 1)

Open times wrap ("12:00 / PM"); preview time chips look like buttons; "Phone calls" twice on one card;
"(optional)" marked two ways; periods on short labels; the green Publish button; "Now · ready"; "New meetings"
heading; the summary's "Met" circles look tappable on screen.

## What's working well

- One layout for every step, one "Next up", status in words, and 44 px targets
- The conflict warning names each person and time, and the server checks it too
- Locking Every week after bookings explains why and offers a way forward
- The Publish card and Unpublish say exactly what happens ("Nobody is emailed")
- The cancel windows: "Keep my meeting" / "Cancel my meeting", "Cancel and email them"
- The booking page is short, needs no account, and shows only open times
- The live preview of bookable times on every times screen

## Limits

An AI review of built pages with sample data, not testing with real people. For finding 1, have two or three
organizers set up weekly office hours from scratch and see where they look.

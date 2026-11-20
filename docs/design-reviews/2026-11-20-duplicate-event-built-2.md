# Design review: Duplicate event (built pages, after fixes)

| | |
|---|---|
| **What was reviewed** | The fixed build: the same boards as the first built check, plus "[new date]" markers (event page, publish blocker, Jobs and shifts, Details), a contest close to its day, a past date refused, and a Publish button elsewhere opening the publish window |
| **Stage** | Screenshots before the PR (follow-up after the owner's decisions) |
| **Size** | Light check moved up after three severity-3 findings: Product Manager, Product Owner, UX Designer, UI Designer, Software Engineer (code too), UX Content Manager, Marketing Manager, usability consultant |
| **Date** | 2026-11-20 |
| **Not reviewed** | Pricing and plans, the rest of Event settings and Team setup, public pages |

Screenshots: `docs/design-reviews/2026-11-20-duplicate-event-built-2/`. Boards 09a and 10b were taken before the note
above "Information for directors" was added (the Product Owner and UX Designer saw no note there; it's in the code).

## The consultant's verdict

Ship after small fixes. Every screen says what comes over and what doesn't, who gets emailed and when, and what happens
to the original, and "[new date]" can't reach the public. The weak spot is tracking the "[new date]" places: one is
counted under a step that doesn't show it, the Jobs tabs don't say which jobs have one, and the event page lists them
twice. The one change that would help most: one list, each place counted under the page where it's fixed.

## Blocks people (severity 3–4)

### 1. A job's old Location can block publishing for good · severity 3 · Software Engineer
Jobs made before the job redesign can have a Location; the job form no longer shows it. A date there becomes
"[new date]" in a box nobody can reach, and publishing is refused. **Fix:** for these kinds, keep Location out of the
markers (or show the box when it holds one); a test.

### 2. Long text can stop duplicating with only "Try again" · severity 3 · Software Engineer
"[new date]" is longer than "11/7". Information for directors near its 3,000-character limit, or a long file name,
goes over and the whole copy fails, every time, with no reason. **Fix:** never let a marker push text past its limit,
and name the field if anything still doesn't fit; a test.

## Should fix (severity 2)

- **"[new date]" tracking** (consultant, PO, UX, Content, PM): a map's name counted under Details; Jobs tabs not marked;
  the list shown twice on the event page; "spot" also means a shift opening. Fix: count each place under where it's
  fixed (Maps and documents its own line), ◆ on each tab that has one, the list once (in the publish card), "place"
  instead of "spot".
- **A contest close to its day: three rules for one deadline** (UX, PO, Content): the Duplicate page says directors get
  14 days; the registration step's two-week rule leaves 1. Owner decides which rule wins.
- **"[new date]" replaces things that aren't dates** (Software Engineer): "Grades 4/5", "10/10", "march 8 to 5", a
  name like "Jan", parts of links. **And misses some dates**: "7 November", "2026-11-07", job and room names. Fix the
  patterns and scan names, with tests.
- **Privacy page promise** (Software Engineer): the stored copy summary keeps copied Coordinators' addresses, and the
  removal record is only cleared by the next removal. Fix: counts only in the summary; clear removals daily; a test.
- **Re-adding a removed Coordinator from "From your team" emails them right away** on a draft (UX, PO, consultant).
- **The "wasn't emailed" card can't be cleared** when someone was left out on purpose (UX, PO); the toast points to
  Team setup with the button right below it, and covers the title or Event settings (UI, consultant, Marketing).
- **Duplicate event on every upcoming card** on My events (PM): noisy; suggests past events and those coming up soon.
- **Two errors for one past date** (all but the engineer); **counts differ** between the panel and the Duplicate page
  ("2 Coordinators" vs "1 comes over"; files) (Content, Marketing, PO, PM); **the calendar covers the contest warning**
  (UI, PM); **an expired invitation red in one place, amber elsewhere** (UI); **Volunteer Leads told to "Resend" a held
  invitation** they can't see (Software Engineer); **after day 7 the email's button needs a sign-in** (PM).

## Polish (severity 1)

Diamond colors in blocker cards; "[new date]" cut off in a phone row; three dialog button layouts on phone; one-word
lines in the step bar at 820; Remove's position; "Use Sat, Apr 17 instead" in the weekday warning; the back link from
New event; naming who loses access in "Starts fresh"; dense Pending text; "unticked"; "Next:"/"Now ·" capitals; "Each
is asked again" for one person; awkward marker labels; "1 file" vs "map or document"; commas after years; a factual
"what's ready" toast; the Co-host-of-one panel says "create" for "duplicate"; Change email on expired rows; a Co-host
of only the copy and names; jobs matched by name; the request id after a name change; the old copy functions still
callable; the Description box's 4,000-character cut; success measures logged; missing boards (no past event, multi-day,
server failure); meetings and visitor events can't be duplicated (say so).

## What's working well

- "[new date]" can't reach the public, and each link lands on its box with the marker selected (all 8)
- The Duplicate page's "Comes over / Starts fresh", "Nothing on Fall Park Cleanup changes", and "Nobody is emailed" (all 8)
- The weekday warning, and contest dates left blank with the reason (7 of 8)
- The publish window names who is emailed in its title and button (all 8)
- One row and one status per Coordinator; Undo with a time; expired invitations offered again (6 of 8)
- Delete and start over as a model confirmation (consultant, Marketing, UX)
- Contrast passes in light and dark; status always has words (UI, consultant)
- Rules in the database: the publish block covers every button and the API; names only for the account's team; no
  double emails (Software Engineer)

## By role

- **Product Manager:** the button on every My events card; the list twice; signing in after day 7; success measures.
- **Product Owner:** contest deadline rules; the map counted under Details; the card that can't be cleared; re-adding
  emails at once.
- **UX Designer:** contest deadline rules; Jobs tabs; Remove on the card; a decline link (decided earlier: email line).
- **UI Designer:** two errors; the calendar over the warning; toasts; colors for one state.
- **Software Engineer:** the Location dead end; long text failing; wrong and missed dates; the privacy promise.
- **Content Manager:** "spot"; contest wording; counts; small wording.
- **Marketing Manager:** two errors; counts; a factual "what's ready" toast.
- **Consultant:** ship after small fixes; one "[new date]" list.

## Limits

AI review of screenshots and code, not testing with real people. Before launch, have one or two organizers who run a
repeat event duplicate last year's event, fill in the new dates, and publish it. Keyboard order, focus after the three
dialogs, and screen-reader announcements weren't tested live.

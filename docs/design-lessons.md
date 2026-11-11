# Design lessons

What the design review panel keeps finding, written as rules so we stop getting dinged for the
same thing twice. Each lesson came from at least two reviews (listed under "Seen in").

**How this file is used** (see `.claude/skills/design-review/SKILL.md`):
- **Before** mocking up or building anything people see: read it.
- **Before** every panel or light check: go through the self-check at the end, and fix what fails.
- **After** every review: a finding seen for the second time becomes a lesson here. A lesson that
  gets dinged again gets a sharper rule, or an automatic check.
- **Never** show this file to the reviewers. They review cold; this file only changes what we do
  before they look.

Lessons marked **Checked automatically** fail `npm run lint` (scripts/design-lint.mjs).

---

## L1. One fact, one source
Every count or status (bands registered, spots filled, ready jobs, plan state) is worked out once
per page and shown from that one result. Don't repeat the same fact in three places; repeat a
**link** to it instead.
- **Why:** the moment two numbers disagree, people trust neither.
- **Seen in:** event setup (four different step counts), My events (three names for what ended),
  volunteer jobs v1 (totals: "2 of 8" vs "2 of 20"), band contest v2 ("0 bands" next to
  "12 registered", 8 of 8 reviewers), band PR3 ("2 already invited" in one card, "1 of 3 invited"
  in the next: both true, counted differently, 4 of 4 reviewers).
- **Same word, same count:** if two cards say "invited", they count the same people. Define the
  count once, in one helper, and say what it is ("invited who haven't registered").
- **Mock-ups too:** sample data follows one timeline. Check every number against every other screen.
- **Again in:** My team mock-ups and built pages (team spots: "invitations count until they're
  accepted" next to a rule where accepting keeps the spot; the built "8 of 8" sample showed 6 rows).
  **Sharper rule:** a limit's rule is written once (in `src/lib/team-words.ts` or the database
  message) and every screen, window, and email quotes it. Sample data adds up row by row.

## L2. Design every state, not just the happy one
For each screen, show: empty, first time (no history), in progress, saved, **failed**, already
done (invited, registered), full, closed and reopened, ended or past, and the blocked version.
- **Why:** the missing state is where people get stuck, and builders guess it differently.
- **Seen in:** setup redesign (live with sign-up closed missing), volunteer jobs (failed save,
  name-only), band contest v1 (no first-time host, no close/reopen, no already-invited).
- **Again in:** My team built (an expired invitation looked like a live one and offered Copy link
  for a dead link, 7 of 8 reviewers). Anything with an end date (a link, an invitation, a pass)
  has its own expired look: its own badge word, and only the actions that still work.

## L3. Saving never loses work
Automatic saving shows **Saving…, Saved, Couldn't save (Retry)**, and **typed but not added**.
Leaving waits for pending saves; if one failed, stay and say which field. Mark the failed field
itself, not only the bar. Save one field at a time, so two co-hosts don't undo each other.
- **Why:** "Saved" while something wasn't is the worst kind of surprise.
- **Seen in:** setup redesign v2 and v3 (three kinds of saving), volunteer jobs v3 and v4 (lost
  edits, offline, typed shifts), band contest v1 and v2 (Next up leaves with a failed save), band
  PR 1 built (failed field's red border hidden by the focus ring; "Please try again. Retry"; errors
  shown mid-typing; leaving the box added half-typed text), start from a previous contest (filling
  in from another contest replaced typed times and venue without asking; now asks, naming each field).
- **Sharper rules:** the failed box stays red *while it has focus* (`aria-invalid` plus an
  important border). Offer Retry only when trying again can work (a dropped connection), and name
  the connection. Check a value's format before saving; say what's wrong when the person leaves the
  box, never while they type. Nothing typed is added or saved on leaving the box: it waits for Add,
  and leaving the page asks.
- **Build with:** `src/components/pending-edits.ts` (`setPending`, `useLeaveGuard`).

## L4. The screen's rules are the database's rules
Anything the page says can't happen ("publishing needs a deadline", "can't delete a job with
sign-ups", "can't remove a classification with bands") is refused by the database, with a case in
`supabase/tests/security_test.sql`. Hiding a button is not enforcement.
- **Why:** a second tab, a co-host, or an old link goes around the page.
- **Seen in:** event setup (drafts went live), setup redesign v3 (hidden jobs), volunteer jobs v1,
  band contest v1 and v2 (publish rule, classifications, reopen), band PR 1 built (any deadline
  date accepted; clearing a number box saved 0).
- **Every date and number has limits:** a date picker gets `min`/`max` and the database agrees
  (a deadline before the event); an empty number box is not 0; a limit can't drop below what
  people already signed up for.
- **Again in:** My team built (resending an expired invitation skipped the team limit; the page
  said past helpers "can't see those events" while the database still let them in).
  **Sharper rule:** every path that gives something back (resend, re-invite, undo) runs the same
  check as the first time, with its own test.

## L5. One word per thing, one thing per word
Pick one name and use it everywhere: in buttons, headings, emails, and the website. Never reuse
a word for two things on one screen.
- **Why:** people act on words, not on our intentions.
- **Seen in:** "Ready" (job vs event), "Hidden/Draft", "Check-in" (stage, stop, and arriving),
  "Parking" (stop and job), "Import" (three names), "post" vs "publish" the schedule, role names
  ("Volunteer Lead", "Coordinator"), "sign-up" vs "job" on volunteer events.
- **Before naming:** check `docs/brand-voice.md` and grep the app for the word.
- **Again in:** band PR 4 ("Check-in" for volunteers and for bands on one screen, 4 of 4 reviewers).
- **Again in:** positioning pages, 2026-11-10 (one kind called "Family visitor days", "Family visitor day", and
  "Parent & visitor check-in"; "leads", "Volunteer Leads", "Coordinators", and "event team" undefined; 5 of 8).
  Name each side by who it's for: "Volunteer check-in", "Band check-in stop".
- **Also seen in:** band PR 1 built ("Publish and open registration" next to a checklist step
  "Open band registration"; "emailed when you publish" meaning the *schedule*). When one button
  does two things, no other step may offer either one again, and "publish" always names its object.
- **Again in:** My team mock-ups ("Cancel" for a window and for an invitation) and built ("hosts"
  meaning both the Account Host plus co-hosts and something separate; messages pointing to a
  "Pending" list that only another page has; two names for where Coordinators are added).
  Messages shared between pages name what's on every page that shows them ("on their invitation").
- **Again in:** Meetings as built ("Your meetings" was also "See your meetings", "Meetings list",
  and "Meetings page"; "Manage meetings" opened setup, 7 of 8). **Sharper rule:** a page has one name,
  used on every button and link that opens it; a button's words name the page it opens.
- **Again in:** setup alignment (the volunteer area was "Volunteer Setup" in the step bar and "Jobs and
  shifts" on the card; "Publish" vs "Publish registration"; a card, its button, and a page all called
  "Meeting setup", 7 of 8). **Sharper rule:** across kinds of event, the same step has the same name, and a
  section on the event page is named like the step it opens.
- **Again in:** Meetings final check ("confirmation email" and "calendar invite" for the same email on
  one page, so people expect two; 2 of 3). One email, one name, with what's in it listed once.

- **Again in:** co-hosts of one event as built ("Fall Cleanup Day only" meant "off this event" in Remove and "only
  this event" in Change…, on the same row). Choices that remove say "Just from"; choices that keep say "only".
## L6. Dark mode: muted text is white
In dark mode `--muted` is pure white, so anything that relies on grey looks live or filled in.
- Greyed-out controls use `text-disabled` and a dashed border, plus a reason in words.
  **Checked automatically** (muted-disabled).
- Placeholders must look empty; long example text goes in a hint under the label.
- Text on red buttons uses `text-danger-foreground`, never white. **Checked automatically**
  (white-on-danger).
- Checkboxes and radios follow `color-scheme` and the brand accent.
- **Seen in:** setup redesign v1 and v3, volunteer jobs v3 and v4, band contest v1 and v2.
- **Always:** look at the dark screenshot of every screen before a review.
- **Again in:** My team built (windows the same navy as the page behind them; outlined buttons at
  1.25:1 in light and 1.43:1 in dark). Outlined buttons use `border-field-border` (3:1 or more),
  not `border-border`.
- **Again in:** date and time pickers built (the "Pick a date" hint and locked boxes used `text-muted`,
  so in dark mode an empty box looked filled in). `placeholder:text-muted` and
  `aria-disabled:text-muted` are now **checked automatically** too, even outside `className=`.

## L7. Don't fade things people can still use
Fading means "you can't". If it still works (an ended shift, a ready card), keep it full strength
and add a word like "Ended". Only disabled controls fade, and they say why.
**Checked automatically** (faded-container).
- **Seen in:** volunteer jobs v3 (faint buttons that worked), check-in desk (ended shifts looked
  disabled), badges (Print faded with no reason).
- **Again in:** Meetings final check (the not-ready Book button was a dashed outline, the same as open
  times and a locked choice, 2 of 3). Not ready keeps the button's shape with a solid muted fill;
  dashed outlines mean open or empty slots only.

## L8. Promise only what the app does
Every claim on a screen, in an email, or on the website must be true in the code today: "one
tap", "directions", "in one step", "the order is filled in", "add a plan", "last year's contest".
- **Why:** a broken promise costs more trust than a modest one earns.
- **Seen in:** setup redesign v1 (plan words), My events ("free" claim), band contest v1 and v2.
- **Check:** for each promise, find the code that keeps it.
- **Again in:** positioning pages, 2026-11-10 (website said "up to four others" when the product allows six; "leads
  see contact details only on event day" when Volunteer Leads always do; "children's names stay with your team"
  while the public bring list showed under-18 first names; a 2-year history promised on every package). Promises
  that depend on a package or role must say so, or be read from the code.
- **Again in:** My team built ("can't see those events anymore" and "only hosts see these details"
  were both untrue in the database). A privacy sentence gets the same check as a feature claim:
  find the policy that keeps it.
- **Again in:** My team part 3 built ("puts them back as before" while the offer they'd had stayed
  ended, and screens still said they "stopped being a co-host"). **Sharper rule:** after an Undo
  or any other way back, re-read every message about the thing undone; each must still be true.

## L9. Warnings are earned
Amber and warning icons only for things that are due soon or block the current step. Anything
else is a calm "Before contest day" item with a due date and the reason for the date.
- **Why:** warnings that cry wolf get ignored when one matters.
- **Seen in:** volunteer jobs (amber marks with no reason), band contest v1 and v2 (check-in stops
  flagged a month early, unexplained "due Mar 6").
- **Again in:** My team part 3 built ("Offer waiting" in amber for a normal pending offer).
  **Sharper rule:** waiting on someone else is neutral, never amber; amber means you need to act.

## L10. No doors to empty rooms, no dead ends
Don't offer a link or action before there's something behind it (a volunteer link with no jobs,
"Move people" with no move page, a step link before the step exists). Every blocked state names
the one missing thing and gives one button to fix it.
- **Seen in:** setup redesign v2 (Move or remove leads nowhere), volunteer jobs v3 (dead Next),
  band contest v1 ("open later") and v2 (volunteer link before jobs).
- **Good model:** "Not ready to publish yet. Publishing needs a registration deadline. Everything
  else can wait. [Add a deadline]"
- **Again in:** My team built (Invite again disappeared on a full team with no reason; "Ask us
  about a bigger team" was a bare email link that does nothing without a mail app).
  **Sharper rule:** a button that can't be offered leaves its reason in its place ("Free a team
  spot to invite again"). An email link always shows the address as text beside it.

## L11. Show who gets emailed before anything is sent
Before an email goes out, the sender can see and untick every recipient. Mark people already
emailed. Say "Sending…" until it's sent, and show what couldn't be delivered. Sending again never
breaks the link in an earlier email.
- **Seen in:** event setup (try-it events emailing outsiders), My events, band contest v1 (and 14
  more, 8 of 8 reviewers) and v2 (re-sent links, "Sent" too early), band PR 2 built (ticked
  directors hidden in a scrolling box; the question didn't name them; reminders to failed addresses).
- **Sharper rule:** no list of recipients scrolls inside its own box, and the question before
  sending names them. Claim each email before sending, so two senders never double up.

## L12. Phone basics
Buttons and links people tap are 44 px tall with 14 px words. **Checked automatically**
(small-control). Status is said in words, never by color alone (keep "✓ Done" on phones). No
sideways scrolling; long words and links wrap cleanly; tab rows don't wrap into two rows.
- **Seen in:** every review.

## L13. One main action; keep destructive actions apart
One filled button per view. Delete and close sit away from it, in red, with a confirmation that
says what happens to the people involved (and offers the way back, like "You can reopen it").
- **Seen in:** volunteer jobs (Delete job next to Add another job), check-in desk, band contest
  v1 and v2 (Close registration).
- **Again in:** My team mock-ups (too many red buttons) and built (two window styles; "Leave this
  event" blue while "Cancel invitation" was red; three different ways out). **Sharper rule:** one
  confirm window per page (question as title, bullets, an outlined way out that names what you
  keep, red for anything that takes access away), passed `danger` explicitly, never guessed from
  the words.

## L14. Line icons, not emoji
Use `LineIcon` and `IconTile` (src/components/line-icon.tsx). **Checked automatically** (emoji).

## L15. The same kind of page looks the same
Setup steps share one layout: back link, step bar, title, then the card. Footers share one
pattern: status on the left, one button on the right. Status lines, badges, and notes use one
style each.
- **Seen in:** setup redesign, volunteer jobs v3, band contest v1 (three layouts for three steps).
- **Again in:** Meetings as built (tabs and a Save button, while volunteer and band setup use steps
  that save themselves). **Sharper rule:** every event type sets up with the same stepped shell; a type
  that hasn't moved to it yet is listed as a known gap, not left to be found in review.

## L16. Say who can see personal details
Wherever a phone number, email, or child's details are entered or shown, say in one line who
sees them and when. Defaults filled in from someone's profile are suggestions until saved.
- **Seen in:** setup redesign v3 (Coordinators and phone numbers), volunteer jobs v4 (phone note
  promised the wrong people), band contest v1 and v2 (director contact).
- **Again in:** Meetings as built ("seen only by you" when creating the event, "you and your
  co-hosts" everywhere else). One sentence about who sees what, quoted everywhere.

## L19. A state that depends on a date is a state everywhere
When something can be "scheduled" or "opens later", every badge, button, count, email, and
background job says so. No screen falls back to the open or closed wording, and no button acts on
a state that hasn't started (no "Close" before it opens). Moving the date, or starting early, also
moves everything waiting on it.
- **Seen in:** band PR 2 built ("Registration open" and "Close registration" before the opening
  day, 8 of 8 reviewers; "Open now" left scheduled invitations waiting for the old date).
- **Again in:** My team part 3 built (when Undo's 10 minutes ran out, the note went away but rows
  still said "Undo is at the top of the page" until a reload). **Sharper rule:** anything that ends
  on a timer refreshes the page when it ends, so every line about it changes together, and focus
  moves somewhere sensible if it was on the part that went away.

## L17. When a step is ready, its one action comes first
Once everything a step needs is in place, the button that finishes it moves to the top of the
page, not below the cards. While it isn't ready, the same spot names what's missing, with one
button to fix it. One prompt for "what next", not four.
- **Seen in:** volunteer jobs (publish card leads the page), band PR 1 built (publish button
  1,500 px down once ready, 5 of 8 reviewers; step bar, sidebar, Next step card, and publish card
  all pointing at the same task).

## L18. Sibling steps save the same way
Steps in one flow use one save model and one "next" spot: they all save themselves with the same
bar (status left, Next up right), or they all use a Save button.
- **Seen in:** setup redesign (three kinds of saving), band PR 1 built (Details had Save changes
  and a Next link at the top; Registration saved itself with Next in the bar, 5 of 8 reviewers).
- **Again in:** Meetings final check (Meeting setup's bar said "All changes saved" over a contact email
  card with its own Save button, 2 of 3). **Sharper rule:** this holds within one page too: a card on a
  self-saving page saves itself.
- **Again in:** setup alignment (live Meeting setup said "All changes saved · … until you save", 4 of 5).
  A page that saves by button says why only once there's something to save, and never shows a grey Save.

## L20. Reorder arrows stay put and say what they moved
Up and down arrows sit in two fixed columns (an unusable one keeps its space), look like buttons,
carry their name on the button ("Move Parking earlier"), and after a move say where it went and
keep focus on that item.
- **Seen in:** band PR 4 Check-in order (arrows swapped places row to row, label on a span, no
  confirmation, 4 of 4 reviewers).

---

## L21. Pinned bars and panels never hide content
A bar pinned to the screen leaves room under everything after it (the footer included), and keyboard
focus stops above it (`scroll-padding`). A panel that scrolls on its own fits the visible screen, keeps
its heading pinned, and shows a fade with "More below" while there's more, so it never just ends at the
screen's edge.
- **Why:** content under a pinned bar, or a list cut off with no cue, looks like the end of the page.
- **Seen in:** band contest mock-ups (sticky bar covers content; sidebar clipped with no cue), band PR 1
  built (phone setup bar covers buttons), layout fixes 2026-11-09 (footer under the bar; panel heading
  scrolled away; fade covered the focused step).

## Self-check before a review

Go through every screen, in light **and dark**, at phone **and** desktop. Fix anything that fails
before the panel sees it.

- [ ] **L1** Every number agrees with every other number, on this screen and the others
- [ ] **L2** Empty, first-time, failed, already-done, closed, and blocked states exist
- [ ] **L3** Saving shows its states; nothing typed can be lost by leaving
- [ ] **L4** Every "can't" on screen has a database rule and a security test (or is planned)
- [ ] **L5** No word means two things; no thing has two names
- [ ] **L6** Dark mode: greyed-out looks greyed out, empty looks empty, red buttons readable
- [ ] **L7** Nothing faded that still works
- [ ] **L8** Every promise is true in the code
- [ ] **L9** Amber only for what's due or blocking
- [ ] **L10** No link to an empty page; every blocker names its fix
- [ ] **L11** Recipients visible before sending; re-sends keep old links working
- [ ] **L12** 44 px targets, status in words on phones, no sideways scroll
- [ ] **L13** One filled button; destructive actions apart and confirmed
- [ ] **L14** No emoji
- [ ] **L15** Same layout as its sibling pages
- [ ] **L16** Personal details say who sees them
- [ ] **L20** Reorder arrows in fixed columns, named on the button, and confirm the move
- [ ] **L21** Nothing under a pinned bar (end of page, keyboard focus); a scrolling panel keeps its heading and says "More below"
- [ ] **L17** A ready step's action is at the top; a blocked one names its fix there
- [ ] **L18** Sibling steps save the same way, with Next in the same place
- [ ] **L19** Every date-based state (opens later, scheduled) shows on every badge, button, and job; a timer that ends refreshes the page
- [ ] **L25** Every screenshot matches its words, is seen as its people see it, and is cropped on white space
- [ ] `npm run lint` passes (includes the automatic checks)

## L22. Nothing is red until someone has had a go
A box turns red only after someone leaves it empty or tries to move on, never because a form opened or an
option was picked. Each red box says why underneath, in words, not color alone. Never prefill a choice the
person has to make (a day, hours): an empty box is honest; a suggestion gets saved by accident.
- **Seen in:** meetings start light check (Every week turned four empty boxes red on picking it, 3 of 3;
  suggested hours saved themselves the moment Meeting times opened, owner).

## L23. A flow's first screen is step 1 of the same steps
The screen before an item exists shows the same step bar, back link, and title as the steps after it, with
step 1 "Now" and the rest "Not yet", so filling it in never feels like the whole job.
- **Seen in:** meetings start (owner: "I don't want people to think that they are only filling out that
  screen"; step 1 had its own header, 3 of 3).

## L24. One tracker, and "Back" goes back
While something is being set up, the step bar is the only progress tracker: no checklist panel beside it,
and a settings menu is a plain menu (no done circles, no "Optional" under items). A "Back" link never jumps
forward: during setup the step bar is the way around, so step pages don't carry "Back to [event]".
- **Seen in:** setup alignment (Event setup checklist beside the step bar; Event settings' circles read as a
  second checklist and hid the open section on phones, 6 of 8; "Back to [event]" on step 1 opened step 3).

## L25. Product pictures match the words beside them
Every screenshot on the website shows what its words describe, in the audience's own world (a potluck page
for potlucks, not a band contest), as the people it describes really see it (a volunteer's view never shows an
organizer's "Sign out"), and is cropped on white space, never through a button, a word, or a list.
- **Why:** a picture that contradicts the copy, or looks broken, undoes the promise next to it.
- **Seen in:** positioning pages, 2026-11-10 (band and school screens on the sign-up sheets page, 6 of 8;
  "Sign out" on a page promising no accounts, half-cut buttons and an empty phone outline, 4 of 4 in the light
  check).
- **Check:** open each screenshot at phone width next to its section, top and bottom edges included.

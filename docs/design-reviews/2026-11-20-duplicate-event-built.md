# Design review: Duplicate event (built pages)

| | |
|---|---|
| **What was reviewed** | The built feature: Event settings panel (Account Host; Co-host of one event), My events, New event's "Start from one of your events", the Duplicate event page and its states, the new draft, Coordinators on the copy in Team setup, the publish window (volunteer, later, contest, expired), after publishing with someone not emailed, a contest copied with a blank deadline, a festival copy, Delete and start over, and the invitation emails |
| **Stage** | Screenshots before the PR |
| **Size** | Light check: UX Designer, UI Designer, UX Content Manager, Product Owner, Software Engineer (code too), usability consultant |
| **Date** | 2026-11-20 |
| **Not reviewed** | Pricing and plans, the rest of Event settings and Team setup, public pages, setting up a new event from scratch |

Screenshots: `docs/design-reviews/2026-11-20-duplicate-event-built/` (every board at 390, 820, and 1440, light and dark).
Before the panel, 11 problems found while capturing were fixed (unticked people named after publishing, one rule for
steps to check, account-member Coordinators listed, tabs at phone width, "You were the Coordinator", and others).

Three findings were rated 3, so by the routing rule this light check moves up: the fixes get a check from the roles
that raised them, plus the Product Manager and Marketing Manager, who didn't see this round.

## The consultant's verdict

Build after fixes. The design is careful and honest about what's copied, who is emailed and when, and what happens to
last year's volunteers; the weekday warning, the blank contest deadline, and the publish window's checklist are better
than most products. The serious problem is the one the feature exists to prevent: opening a step clears its old-date
warning even when the old date is still in the text. The one change that would help most: keep each old-date warning
until the text no longer has the old date, or the organizer says "This date is right".

## Blocks people (severity 3–4)

### 1. Opening a step clears its old-date warning · severity 3 · consultant
- **Where:** 05b, 07d (compare 05a, 07a)
- **What happens:** the publish window and Ready card stop warning about Jobs and shifts once it's opened, while the
  shift notes still say "by 7:45 on Nov 7" (the copied note on the same page still knows).
- **Who it hurts:** the PTO president working in short bursts; volunteers who get the wrong date.
- **Standard:** error prevention; visibility of system status
- **Suggested fix:** keep old-date warnings (note, Ready card, publish window) until the text no longer has the old date
  or the organizer marks "This date is right". "Opened" only clears "Copied: check it".

### 2. Three other publish buttons skip the copy's publish window · severity 3 · Software Engineer
- **Where:** Volunteering's "Publish and open sign-ups", Band registration's "Publish" (where a contest copy lands),
  Event settings' "Publish event"
- **What happens:** Team setup says "sent when you publish", but publishing from these buttons emails nobody and shows
  no "who gets emailed" window.
- **Who it hurts:** last year's Coordinators never hear about it; organizers trust the words.
- **Suggested fix:** every publish button on a never-published copy with Coordinators waiting opens the same publish
  window.

### 3. "Fix the address" can show the name of anyone with an account · severity 3 · Software Engineer (privacy)
- **Where:** the copy's Coordinator list (`copy_coordinators`, the duplicate summary), with "Fix the address"
- **What happens:** the name shown for an invitation not yet accepted is looked up by email across every account, so
  typing any address shows that person's name if they use the app anywhere.
- **Who it hurts:** everyone with an account (directors, parents, organizers).
- **Suggested fix:** show a name only once they accept or when they're already on this account's team; otherwise the
  email. A security test for it.

## Should fix (severity 2)

- **One person, several places in Team setup** (UX, UI, Content, PO, consultant: 5 of 6): "Pending: No invitations
  waiting" under a waiting invitation; Ana in "From your team" with a 6-line role list; still under "Removed" after
  Undo or re-sending; after accepting, not in Current members. Fix: one row, one status, one next action; copied
  invitations count as pending; Removed cleared on re-invite; accepted people move to Current members.
- **One action, five names** (all but the engineer): "Send now", "Send", "Send again", "Resend", "Re-invite"; "Fix the
  address" when nothing's wrong, and before Send on the event page. Fix: "Send invitation now" / "Send invitation" /
  "Send a new invitation"; "Change email" as a quiet link after the main button; same order everywhere; the card's
  after-sending state.
- **Copies look alike** (UX, PO, consultant): the name starts as the old name; My events shows look-alike drafts. Fix:
  suggest next year's name when there's a year, otherwise select the name so typing replaces it; "Copied from Fall
  Park Cleanup (Nov 7, 2026)" on draft cards until published.
- **New event: two paths after picking an event** (UI, consultant): the outlined "Duplicate event" is weaker than the
  blank form's "Save and continue". Fix: once picked, "Duplicate event" is the filled button and the form folds away
  behind "Or fill in the details yourself".
- **The "looks right" link** (UX, PO, Content): visiting already marks "Opened", so the link has no visible effect; it
  sits above the content; it's offered when a required field is blank. (Tied to finding 1 and an owner decision.)
- **Words about access** (Content, consultant, PO): "Nobody can open the event until they accept" on a public event;
  "On your account" is internal, and why Sam skips the invitation but Ana (a Co-host of other events) doesn't is never
  said. Fix: "They can't help run it until they accept. Your public page isn't affected"; "Already on your team, so
  they keep leading Litter pickup"; one line for why someone needs an invitation.
- **"The email is from you"** (PO): the From line is the app's no-reply; Dana is in the body and replies go to her.
  Fix: "The email names you and gives your address for replies."
- **Two time limits in the email** (Content, PO, consultant): "Works until Dec 20" and "signs you in for the first 7
  days". Fix: one date first; the 7-day note next to the button in plain words.
- **Contest wording** (Content): "Publish … and registration opens Jul 31?", "opens on … through …", "Registration opens
  would have been …", "Every shift moved" on contests and festivals. Fix: wording as in the Content report.
- **One state, three wordings** (Content, UX): "Copied: check it", "Copied, not opened yet", "Copied, and nobody has
  opened these steps yet"; "copied" lowercase after "Optional ·". Fix: one wording.
- **Markers** (UI, UX, Content): ◆ on the tab, ● on the row, and the legend says ● means "not emailed yet" beside an
  expired row. Fix: one marker; drop the legend (every row says it in words).
- **Step pages for contests and festivals repeat the whole copied note** (UI): the blank deadline is the third screen
  down on a phone. Fix: the short line on step pages, plus "The deadline is blank: pick a new one below".
- **The Duplicate button is 2–3 screens down on a phone** (UI). Fix: fold the two lists, or a sticky bar like the step
  pages.
- **A contest copied close to its day** (UX): a first day 15 days out makes a deadline that must be tomorrow; nothing
  warns until after copying, and the publish blocker mentions classifications that exist. Fix: warn on the Duplicate
  page; the blocker names only what's missing.
- **Coordinators can't say no** (UX): only "let Dana know at …". Fix: a "Can't help this time" link recorded in Team
  setup. (An earlier decision chose the email line; recommend keeping it for now.)
- **Missing states** (PO): a past or same-day date, the Duplicate page failing, the draft after every step is checked,
  Delete and start over after Send now, and the ways in for a Co-host of one event on My events and New event. (Some are
  built but weren't photographed.)
- **Engineering** (Software Engineer):
  - A send cut off partway can read "Invitation sent" with no email delivered. Fix: send after publishing in small
    batches with more time, and let "Send again" work when delivery is unknown.
  - Publishing errors can say "still a draft, nobody was emailed" when it published. Fix: read the event's state before
    choosing the words.
  - A Volunteer Lead can't see held invitations but is told to "Resend" them, and can delete one directly. Fix: a clear
    message, and held invitations deletable by hosts only, with a security test.
  - A contest copy brings last year's "Contact for directors" (their phone and email) without saying so. Fix: list it
    under "Check what came over", or don't copy it.
  - The heaviest check runs several times per page load while checking a copy. Fix: run it once per request; a light
    check for the step bar.

## Polish (severity 1)

Expired dot vs the legend; "Keep Cedar Ridge Marching Classic 2027" wraps (use "Keep this copy" as an outline button);
an empty gap in the contest publish window; Duplicate panel right above Delete in Event settings (move it up); the
Duplicate button jumps sides on My events cards; small row alignment in Team setup; three nested boxes in the date
preview; "outlined in red above" relies on color; the toast covers the header menu; "On your account" vs "already
leading" wording; the name hint goes stale after a rename; long "Starts fresh" sentences; "first day" vs "New date";
"You see who before anything is sent"; two "as" phrases in the Send now confirm; file copying on a retry; the stored
summary keeps source invitation emails; removed-person email kept until the next removal; the request id reused after
changing the name or date; status dates by UTC day; a failed re-send of an expired invitation reads "Not emailed yet".

## What's working well

- "Comes over / Starts fresh" side by side, "Nothing on Fall Park Cleanup changes", "Nobody is emailed" (all 6)
- The weekday warning with every shift's "was Sat, Nov 7" (all 6)
- Old dates quoted with the snippet and a link (5 of 6)
- The publish window names who is emailed in its title and button, and drops it when unticked (all 6)
- A contest's past deadline left blank with the reason, and one clear next action (5 of 6)
- The Co-host of one event told who to ask, with an Email button (5 of 6)
- Contrast passes in light and dark; status always has words, not color alone (UI, consultant)
- The rules in the database: one transaction, named columns, no copied-from on the public events row, held invitations
  with no token, no double emails on publish again (Software Engineer)

## By role

- **UX Designer:** Team setup's several statuses for one person; Undo and Removed disagree; a contest copied close to
  its day; Coordinators can't decline.
- **UI Designer:** two paths on New event; the Duplicate button far down on a phone; the long note on contest step
  pages; markers.
- **Content Manager:** one action with five names; "Fix the address"; "Nobody can open the event"; contest wording; one
  state with three wordings.
- **Product Owner:** contradictory statuses; the email isn't "from you"; missing states; "looks right" has no visible
  effect; 13 acceptance criteria.
- **Software Engineer:** other publish buttons skip the window; the name lookup across accounts; partial sends;
  publishing error words; Volunteer Leads and held invitations; the directors' contact copied; speed.
- **Consultant:** build after fixes; old-date warnings must outlast "Opened".

## Acceptance criteria (from the Product Owner)

- Given an Account Host or a Co-host of every event, when they use any of the three ways in, then they reach the same
  Duplicate page for that event.
- Given a Co-host of one event, when they look at any way in, then they see who to ask and can't start a copy.
- Given no new date, when Duplicate event is pressed, then nothing is created and the field says what to do.
- Given a new date on a different weekday, then the warning and the moved shifts show before the copy is made.
- Given the copy succeeds, then exactly one draft exists, every date moved by N days, and no volunteers, sign-ups,
  bands, groups, or personal details are on it.
- Given the copy fails, then no partial draft exists and the organizer can try again.
- Given copied Coordinators not on the account, then they show "Not emailed yet", get no access, and get no email until
  publish or Send now.
- Given Send now is confirmed, then one email goes, the row shows "Sent … works until", and publishing doesn't email
  them again while it works.
- Given a Coordinator unticked in the publish window, then the button drops "and email N", and afterwards the event page
  names them with one way to send.
- Given an invitation is accepted, then the person appears once, in Current members, with their job.
- Given someone removed is invited again or restored, then they're no longer under Removed.
- Given a contest copy whose deadline would be past, then it's blank and publishing waits until it's set.
- Given Delete and start over after someone was emailed, then the confirm says so.

## Limits

This is an AI review of screenshots and code, not testing with real people. Before launch, have one or two organizers
who run a repeat event duplicate last year's event, check it, and publish it.

# Design review: co-hosts for just one event

| | |
|---|---|
| **What was reviewed** | Mock-ups: the event's Co-hosts tab (Account Host, and a co-host of one event), the two remove windows, My team, the invitation email, and the dashboard of a co-host of one event |
| **Stage** | Mock-ups before building |
| **Size** | Full panel: all seven roles plus the consultant |
| **Date** | 2026-11-11 |
| **Not reviewed** | The Volunteer Leads and Coordinators tabs, the rest of My team and event setup |

Screenshots: `docs/design-reviews/2026-11-11-event-cohosts-mockups/`. The "desktop" shots were a 736 px column, so the
real 1440 px layout wasn't reviewable (fixed next round).

## The consultant's verdict

Build after fixes. Inviting is clear, the safe choice is picked to start, and a co-host of one event gets a private,
well-scoped view. Two things need deciding first: removing a co-host of every event from one event quietly stops them
being added to future events, and nothing tells an organizer when to pick a co-host of one event instead of a Volunteer
Lead. The one change that would help most: treat "remove from just this event" as an exception ("every event except
Drumline Invitational"), not a switch to one-by-one events.

## Blocks people (severity 3–4)

### 1. "Just this event" quietly changes a co-host of every event for good · severity 3 · found by 6 of 8
- **Where:** 02, the remove window, "Just Drumline Invitational"
- **What happens:** Cleave becomes a co-host of the other 5 events one by one, and stops being added to new events.
  The warning is the second half of a bullet. Months later he can't see the spring concert, and nobody knows why.
  There's no way back to "every event". On My team he'd scatter across 5 event teams.
- **Who it hurts:** The organizer at a laptop and the PTO president (both forget between seasons), and Cleave
- **Standard:** Error prevention, match with the real world, user control
- **Suggested fix:** Keep him a co-host of every event, with an exception: "Co-host of every event except Drumline
  Invitational". New events still include him. Undo or "Invite again" removes the exception.
- **Decision:** _pending_

### 2. When to pick a co-host of one event instead of a Volunteer Lead · severity 3 · found by 2 of 8
- **Where:** 01, the invite form; 05 My team; today's hint "Need help with just one event? Add a Volunteer Lead…"
- **What happens:** Two ways to get help with one event, and no word on which. "Co-host" sounds bigger and safer, so
  a parent who only runs volunteers gets publishing and every family's contact details. Today's hint says the opposite.
- **Who it hurts:** The organizer, the PTO president, and the families whose details are shared
- **Standard:** Help in context, privacy
- **Suggested fix:** One line under "Invite a co-host": "Co-hosts run the whole event. If they only need to run
  volunteers, add a Volunteer Lead instead." Rewrite the hint on My team to match.
- **Decision:** _pending_

### 3. Co-hosts can delete events today · severity 3 · found by 1 of 8 (Software Engineer, checked in code)
- **Where:** the database rule for deleting events (any account member)
- **What happens:** Every co-host can delete every event on the account today. The design promises co-hosts of one
  event can't delete; that must be enforced. For co-hosts of every event it's an owner call.
- **Who it hurts:** The organizer (an event deleted by mistake, with its sign-ups)
- **Suggested fix:** Only the Account Host deletes events, with a security test. Or keep co-hosts of every event able
  to delete, and block only co-hosts of one event.
- **Decision:** _pending_

### 4. The invitation email drops what keeps it trustworthy · severity 3 · found by 1 of 8 (Marketing)
- **Where:** 06
- **What happens:** No product name, no "no password needed", and no "if you weren't expecting this" footer, which
  today's invitations all have. To a parent who's never heard of us it looks like a scam.
- **Suggested fix:** Keep today's invitation email and change only its middle paragraph (in plain words, no
  "Account Host": "You can do everything Pat can on this event, except delete it or invite or remove co-hosts").
- **Decision:** _pending_

### 5. The remove window isn't fully drawn · severity 3 · found by 5 of 8
- **Where:** 02
- **What happens:** The window as it opens (nothing picked) isn't shown; the "All 6 events" version drops the choices
  and the email box; "Jobs they lead on this event will need a new Coordinator" is missing from "Just this event".
- **Suggested fix:** One window: choices at the top, email box always, the button off until a choice ("Choose what to
  remove"), and the jobs bullet whenever it applies. Mock it next round.
- **Decision:** _pending_

### 6. Building it safely (Software Engineer) · severity 3
- **What happens:** A co-host of one event can't be stored where co-hosts are today without risking other events'
  details. Removal records, Undo, "Invite again", one-open-invitation rules, and handing on the Account Host role all
  assume co-hosts are on every event.
- **Suggested fix (how it will be built):** store them with the event's team (like Volunteer Leads), so anything
  account-wide stays closed to them by default; give each account-wide check a security test; teach removal records,
  Undo, "Invite again", and invitations about one-event co-hosts; leave them out of handing on the Account Host role.
- **Decision:** _pending_ (no product choice needed beyond 1 and 7)

## Should fix (severity 2)

7. **After the event** (3 of 8). Does a co-host of one event keep a team spot and access after it's over? Suggested:
   the same as Volunteer Leads: the spot frees when the event is over, and access ends 10 days later.
8. **Changing how far a co-host reaches** (2 of 8). Only Remove exists. Suggested: "Change…" on a co-host's row, with
   the same two choices as inviting (this event only / every event).
9. **One name for each kind** (6 of 8): "Co-host of every event" and "Co-host of [event name] only", on every screen
   and email; "Removed or left recently on My team" for the removed list; one sentence for what co-hosts can't do.
10. **My team** (3 of 8). Keep the built list and badges; one row per person with their events listed; Remove on a
    Hosts row means all events, on an event row that event only.
11. **What a co-host of one event sees of others** (2 of 8). Names and emails of the event's hosts, not phone numbers,
    and "Co-host" without saying how far others reach. Enforced in the database.
12. **States not drawn** (6 of 8): the page the invitation opens (and expired), team spots full, "already on your
    team", "Stop co-hosting…" and where it lands, an empty dashboard, a person on two events, an every-event co-host's
    view, and the real 1440 px layout.
13. **The team-spot line** (3 of 8): "It takes 1 of your 5 team spots as soon as it's sent (3 in use now). Inviting
    someone already on your team doesn't take another." And the link works for 30 days.
14. **The privacy page** (1 of 8): "Who can see it" names co-hosts; separate the two kinds so it stays true.
15. **Dashboard card** (3 of 8): reuse the built event card, with its status and next step and the role badge.
16. **Sample data** (1 of 8): the mock-ups used the owner's real email and phone; use example data.

## Polish (severity 1)

- Phone numbers and "Co-host" split across lines on phones; keep each detail whole.
- Use the real step tabs; shorten the Co-hosts tab's status to "2 co-hosts".
- Pending invitation buttons look like text; "Cancel" should say "Cancel invitation".
- Remove windows stack their buttons differently on phones.
- How we'll know it worked: share of "Just this event" invitations, removals from one event, team-spot limits hit,
  and support questions about access, after the next contest season.
- After launch, the Administrators page could say "Bring in a co-host for one event."

## What's working well

- Inviting starts on the smaller choice, and removing starts with nothing picked.
- Each choice says in plain words what the person will see ("…and nothing else on the account").
- The team-spot cost shows where the decision is made.
- Remove buttons name their reach ("Remove from all 6 events"), and the way out names the person ("Keep Cleave").
- A co-host of one event is told what they can do and who to ask, and can leave on their own.
- The email names the one event and says they won't see the account's other events.
- Phone widths and dark mode hold up.

## By role

- **Product Manager:** the "one by one" switch, team spots after the event, and changing reach.
- **Product Owner:** undrawn states and two rules open to two readings; acceptance criteria below.
- **UX Designer:** the switch, a "Change…" action, names, and the invite form low on phones.
- **UI Designer:** match the built My team, dashboard, and step tabs; one visual mark for each kind.
- **Software Engineer:** where to store it safely, deleting events, removals and Undo, invitations, hand-on.
- **Content Manager:** exact wording for names, limits, the email, and the team-spot line.
- **Marketing Manager:** the email's trust signals, the privacy page, and the sample data.
- **Consultant:** the switch and the co-host-or-Volunteer-Lead question (both severity 3).

## Acceptance criteria (from the Product Owner)

- Given the Account Host on an event's Co-hosts tab, when they open the invite form, then "Just this event" is picked.
- Given an invitation for just this event, when it's accepted, then the person sees and runs only that event, and the
  account's other events appear nowhere for them.
- Given someone already on the team (any role), when they're invited as a co-host, then no extra team spot is used.
- Given full team spots, when inviting a new person, then they're told before sending and shown what to do.
- Given Remove… on a co-host of every event from an event, when the window opens, then nothing is picked and the
  remove button can't be pressed.
- Given a co-host of one event, when they try to invite or remove a co-host or delete the event, then the option isn't
  there and the database refuses it, with a security test.
- Given "Let them know by email" ticked, when someone is removed, then they get an email naming what they lost.

## Limits

This is an AI review, not testing with real people. For the severity 3 findings, try the invite and remove windows
with two or three organizers before launch.

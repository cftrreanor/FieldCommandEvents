# Co-hosts for just one event (2026-11-11)

Owner request: removing a co-host from an event's team setup took them off every event ("only a nuclear option").
The owner wants co-hosts who are on just one event, as well as co-hosts of every event.

Owner decisions before the mock-ups:
- **What a co-host of one event can do:** everything the Account Host can on that event, except delete it or invite
  or remove co-hosts. They don't see the account's other events.
- **Team spots:** they use one, like co-hosts. Each person counts once, however many events they co-host.
- **Inviting from an event's team setup:** a choice, "Just this event" (picked to start) or "All your events". My team
  keeps inviting co-hosts of every event.
- **Removing a co-host of every event from an event's team setup:** two choices, "Just this event" (they stay a
  co-host of each other event) or "All events".

Full panel on the mock-ups (`docs/design-reviews/2026-11-11-event-cohosts.md`). Owner decisions:

| # | Finding | Severity | Decision |
|---|---|---|---|
| 1 | Removing a co-host of every event from one event changes them for good | 3 | **Keep as is, made plain:** they become a co-host of each current event, one by one, and aren't added to new events (owner's choice, against the panel's exception idea). The window says so first, in its own line, and "Change…" can make them a co-host of every event again |
| 2 | Co-host of one event or Volunteer Lead | 3 | Take the advice: one line under inviting, and the old hint rewritten |
| 3 | Co-hosts can delete events | 3 | Take the advice: only the Account Host deletes events |
| 4 | The invitation email | 3 | Take the advice: today's email, new middle paragraph |
| 5 | The remove window | 3 | Take the advice: the choices first, then what happens, the buttons at the bottom as today |
| 6 | Building it safely | 3 | Take the advice. Inviting says plainly whether it's for this one event or to join the team as a co-host of every event |
| 7–13 | After the event, Change…, names, My team, what one-event co-hosts see, undrawn states, smaller fixes | 2 | All as recommended |

New, from the owner: **pick from your team.** Every team tab on an event (Co-hosts, Volunteer Leads, Coordinators)
offers a list of people already on your team as well as inviting someone new by email. Picking someone adds them right
away and emails them that you did, as picking a Coordinator for a sign-up does today. Mock-ups again before building.

Light check on the round-2 mock-ups (UX Designer, UI Designer, Content Manager, Product Owner, consultant;
`docs/design-reviews/2026-11-11-event-cohosts-mockups-2/`). Owner decisions:
- **A co-host of one event's "From your team" list:** only people already on their event. Nothing about the account's
  other events or wider team shows (severity 3, the consultant and UX Designer).
- **A Volunteer Lead made co-host of the same event:** co-host replaces the Volunteer Lead role (it includes it). Jobs
  they coordinate stay theirs.
- **People from past events when team spots are full:** shown with "Takes a team spot", their Add turned off.
- **Everything else as recommended:** a "Some events" group for co-hosts of a few events; Change… both ways, listing
  what's lost; the 10 days after the event shown with the end date (email, invitation page, dashboard, the host's
  row); today's team-spot rule written down (the Account Host, co-hosts of every event, waiting invitations, and people
  on events that aren't over each count once); a check before adding someone as co-host of every event; the same
  "Let them know by email" box in Change…; the wording fixes ("other events from North Ridge Band Boosters", "plan"
  not "package", "Remove Sam from the team", and the rest).

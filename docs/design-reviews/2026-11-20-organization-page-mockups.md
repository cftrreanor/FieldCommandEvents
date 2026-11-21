# Design review: More ways to help, and the organization page (mock-ups, checked against the brief)

| | |
|---|---|
| **What was reviewed** | Mock-ups: a volunteer event's sign-up page with "More ways to help" (open, one shift full, every shift full, closed, signed up, another event's confirm step), the public organization page (full list, one event, nothing coming up, off, today and opens later, 320 px, no logo or color), the organizer side (Account card, turn on, on, Help anytime, Event settings and the Publish step for the Account Host and for a Co-host of one event), and the My events card |
| **Stage** | Mock-ups before building, checked against the kickoff brief (`docs/design-briefs/2026-11-20-organization-page.md`) |
| **Size** | Full panel: Product Manager, Product Owner, UX Designer, UI Designer, Software Engineer, UX Content Manager, Marketing Manager, usability consultant |
| **Date** | 2026-11-20 |

Screenshots: `docs/design-reviews/2026-11-20-organization-page-mockups/`.

## The consultant's verdict

Build after fixes. The design keeps the brief's main idea: the block sits on the event's own page below the parent's
sign-up, the confirm step carries details over, the public page is a calm list of facts, and every organizer switch is
explained. The change that would help most: when every shift is full or sign-up is closed, drop the dead shifts and
form and put "More ways to help" right under the top note.

## Against the brief

Met by all: the block below the shifts, facts not pressure, no Notify me, a list not a grid, no upkeep, "Anyone with
the link can still open it". Partly met: one tap (it's two, accepted by all: "two taps, no typing"), nothing public
unless chosen (a Co-host of one event's publish; a person's name), only what you can do now (dead rows in full and
closed states; Help anytime first). Missed: measuring success, a full year, every event full, `missing()`, a device
with no remembered details.

## Blocks people (severity 3)

1. **A person's name can head the page and its web address, and the organizer can't change it** (PM, PO, UX,
   consultant, engineer). Fix: a group name box at turn-on, required when it matches a person's name; the address is
   set fresh from that name at turn-on, then kept.
2. **The organizer's personal email can show on the "sign-up closed" note** (engineer; 5 others at severity 1–2).
   Fix: the page's contact email when the page is on, otherwise only an address someone typed for replies; never the
   sign-in fallback; a security test.
3. **A Co-host of one event can put an event on the public page** (consultant, PM, engineer: the lock can be bypassed
   from outside the app). Fix: their events start off with "1 new event to review" for the Account Host; the switch
   changes only through a database function; tests.
4. **No path when the device remembers nothing** (PO, UX). Fix: the same confirm card with the shift chosen and the
   three fields (name, email, phone), nothing else.
5. **Sign-up closed still looks pickable; dead rows above the alternatives** (consultant, UX, UI, PM). Fix: in full and
   closed states, shifts read-only behind "See the shifts", no form, the block right under the note.
6. **A failed save says the opposite of what's true** (consultant). Fix: the switch snaps back; "Still on your page.
   Couldn't turn this off".
7. **Organizer rows break one letter per line at tablet widths and zoom** (UI, consultant, PO). Fix: the save status
   on its own line.
8. **Confirming quickly is refused by the bot traps** (engineer). Fix: its own action, an invisible bot check, limits
   per device.
9. **The full phone number shows on any device that remembers it** (engineer). Fix: "Phone ending 0142", server-held,
   "Forget this device".
10. **"People only find out when you share your link" is false once shown** (Marketing). Fix: "Nobody is emailed.
    People find it from your link, your organization page, and your other sign-up pages."

## Should fix (severity 2)

- **Coming up before Help anytime** (PM, UX, UI, Marketing, consultant; PO and Content would keep it): parents arrive
  looking for a shift.
- **"Opens later" needs a new "Sign-up opens" date**: build it as its own first step (UX, consultant, engineer,
  Marketing), or leave events that aren't open yet off the page in v1 (PM, PO).
- **Who turns the page on and sets its name and contact**: the Account Host only (PO), or the Account Host and
  Co-hosts of every event (engineer).
- Preview before turning on, a guard for nothing ticked, and the "new events start on" rule above the list (PM, UX,
  consultant); measuring sign-ups from these links with no names (PM, PO, engineer: a daily count by source, Admin only
  at first); words that fit any group ("Fair or fundraiser", "Select the ones to show", a footer for schools, PTOs,
  clubs, and community groups); "{brand} never handles money or donations"; "Show on organization page"; the Co-host
  sentence; "Add another shift here"; a "Things to bring" row's destination; Help anytime in the block when shifts are
  full; suggestions skip overlapping or already-held shifts; the confirm button above the fold; the retention line
  from the real sign-up form; carry-over words only when true; minors and added people not carried over; fairs drop
  off on fair day; the brand color in dark mode reaches 4.5:1 on cards too; one save model for Help anytime with undo
  on Remove; a why-line on the Account card ("When a shift is full or someone can't make it, they see your other open
  spots instead of leaving"); the full year, all-full, and `missing()` states drawn.

## Polish (severity 1)

Link button names the site ("Open on amazon.com"); "Today" once; "We ask search engines not to list it"; a link out of
the page-off screen; affiliate and tracking parts stripped from links; http upgraded to https; logo tile not stretched;
a locked On switch that looks on; the arrow kept with its word; Remove confirm; name the item on the My events card.

## What's working well

The block never pushes a parent's own sign-up down; the confirm step's "Nothing was saved" and nearby alternative;
"Not Priya? Use different details"; every "not listed" reason in plain words; the turn-on list starting with nothing
ticked; the turn-off window; facts with no guilt; 320 px and dark mode on the public page; nothing about the group on
the page-off screen.

## Size (Software Engineer)

About five PRs: "opens later" (if chosen), the database (switches, Help anytime, the public function, counting, and
tests), the organizer screens, the public block and page, and the confirm step with the remembered device.

## Limits

AI review of mock-ups, not testing with real people. Before launch, have one PTO try it on a real set of spring events.

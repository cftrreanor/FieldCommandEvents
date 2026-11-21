# Design review: "More ways to help" and the organization page (built pages)

| | |
|---|---|
| **What was reviewed** | The built volunteer sign-up page with "More ways to help" and the confirm step (1a–1g), the public organization page (2a–2f), the organizer's Organization page, Account and My events cards, Event settings, and Publish step (3–4), at 320/390/1440 in light and dark; and the code |
| **Stage** | Screenshots before the PR |
| **Size** | Light check: UX Designer, UI Designer, UX Content Manager, Software Engineer (code), usability consultant |
| **Date** | 2026-11-21 |

Screenshots: `docs/design-reviews/2026-11-21-organization-page-built/`.

## The consultant's verdict

Ship after fixes. The parent's path is the strongest work in the feature: from "can't" to a real open spot, details
carried over, no account, and a clean recovery when a shift fills mid-confirm. The organizer side is honest and hard to
misuse. The change that would help most: the group's color in dark mode must reach 4.5:1 on cards and on the main
button.

## Blocks people (severity 3)

1. **A first-time visitor on the confirm step is booked as an adult** (engineer; UX at 2): age rules and the guardian
   box are skipped. Fix: a required "I'm 18 or older" with "Under 18? Use the full sign-up form"; the server refuses
   without it; a test.
2. **Dark mode: the group's color is below 4.5:1 on cards and on the Confirm button** (consultant, UI). Fix: check
   against the card surface and the button text; a unit test with sample colors; axe on the dark screens.
3. **The preview before turning on doesn't look like the real page** (UI; UX, consultant, Content at 2). Fix: build it
   from the public page's own parts, with the group's color and logo.

## Should fix (severity 2)

- **Search engines** (engineer): the robots rule hides the page's noindex tag, and "More ways to help" puts other
  events on volunteer pages that search engines read. Owner decides how far to go.
- **Carried-over details from another group** on a shared device (engineer): only the same account's sign-ups.
- **The per-device limit resets after every sign-up** (engineer): key it on something stable; a per-shift limit.
- **Shifts already started are offered** (consultant): leave them out of the block; "Happening now" on the page.
- **"Forget this device"** one tap next to "Pick a different shift" (UX, consultant): move it and ask first.
- **"End today" keeps the item up until midnight** (UX): "Take off the page now" with Undo.
- **Two groups** (UX, UI, Content, consultant): name the group on the cards; one card per group; both pages reachable.
- **A draft said to be open to anyone with the link** (Content, consultant): draft wording.
- **Who reviews a Co-host of one event's event** (Content): "the Account Host or a Co-host of every event".
- **"1 new event to review" buried** (UI, consultant): first, with a Review link, also on the Account card.
- **A locked "off" switch looks usable** (UI); **heading levels skip** (UI); **one word for "full"** (Content);
  **the confirm step's fine print** (Content); **one footer line** (Content, UI, consultant); missing security tests
  (closed account, two accounts don't mix, signed-out calls, a Host's rename); check the Help anytime note saves and the
  tapped row opens that exact shift.

## Polish (severity 1)

Group name saves on blur, not mid-typing; the page shows "You're signed up" on rows this device holds; the phone carried
over on the full form; the kicker repeating the note; heading punctuation; the why-line; "Past events drop off";
plain-word link hint; the person-name error; "Your page's link" before the first turn-on; the turn-off bullets; one
"Opens amazon.com"; "Cashier" once; the extra My volunteering link; the Active badge; the off-line marker; the
replacement shift keeps its highlight; Things to bring gets its own icon; the logo route's lighter query; the event
lookup filtered by account; the link check refuses "@"; counts labeled as an estimate.

## What's working well

The block never pushes a parent's own sign-up down; "Phone ending 0142" and "Not Priya?"; the just-filled recovery;
turn-off lists every consequence; failed saves snap back with Retry; status in words, never color alone; 320 px with no
sideways scroll; empty months hidden; the switch guard and the pass safeguard in the database; names-free counting.

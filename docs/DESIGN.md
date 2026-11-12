---
version: beta
name: Field Command Events (restrained blue)
description: "A calm, dependable look: white pages with warm off-white panels, near-black text, one deep blue for actions, selection and the header, and the darkest navy for the closing band. Soft corners and very soft shadows. Adapted from a DESIGN.md the owner supplied (an interpretation of a scheduling brand); its proprietary faces are replaced by Inter."
colors:
  primary: "#0B3558"        # deep blue: buttons, links, selection, header (white on it 12.6:1)
  primary-deep: "#071A31"   # hover, and the closing band
  on-primary: "#FFFFFF"
  sky-soft: "#B9D3F0"       # the hero's pill button (deep blue on it 8.2:1)
  accent: "#1A5C8F"         # sparingly: finalists, the pilot pill (white on it 7.1:1)
  canvas: "#FFFFFF"
  surface: "#FCFBF8"        # warm off-white panels and cards
  hairline: "#DFE3E8"
  field-border: "#5F6D77"   # text-box, option and panel edges (5.3:1 on white); dark mode #5F7489
  ink: "#0A0A0A"            # 19.8:1 on white
  ink-mute: "#4B5F72"       # slate blue, 6.6:1 on white, 6.4:1 on surface
  on-dark-mute: "#C8D4E0"   # 8.4:1 on primary; white in dark mode
  success: "#16794A"
  warning: "#854600"
  danger: "#B42318"

typography:
  display:
    fontFamily: "Inter (variable), system-ui, sans-serif"
    fontSize: 48-64px
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: -0.04em
  heading:
    fontFamily: "Inter (variable)"
    fontSize: 20-28px
    fontWeight: 540
    lineHeight: 1.15
    letterSpacing: -0.015em
  body:
    fontFamily: "Inter (variable)"
    fontSize: 16px
    fontWeight: 460
    lineHeight: 1.5
  button:
    fontFamily: "Inter (variable)"
    fontSize: 14px
    fontWeight: 600
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace"

spacing:
  base: 8px
  scale: [2, 4, 8, 12, 16, 24, 32, 64]

radius:
  sm: 8px    # small controls, tags
  md: 12px   # buttons and inputs (pills only in the home page hero and header)
  lg: 20px   # cards and panels
  xl: 24px   # dialogs
  full: 9999px

shadows:
  card: "0 4px 5px rgba(95,109,119,.04), 0 8px 15px rgba(95,109,119,.03), 0 15px 30px rgba(95,109,119,.06)"
  elevated: "0 4px 5px rgba(95,109,119,.04), 0 8px 15px rgba(95,109,119,.03), 0 30px 50px rgba(95,109,119,.08)"

motion:
  duration: 150ms
  easing: "cubic-bezier(0.4, 0, 0.2, 1)"
---

# Field Command Events design system

The tokens above are implemented in `src/app/globals.css` (colors, dark theme,
font weights, radius, shadows, focus ring, reduced motion), the fonts in
`src/app/layout.tsx`, and the shared components in `src/components/ui.tsx`.

## How the colors are used in the code

| Token (Tailwind class) | Role |
|---|---|
| `brand` (`bg-brand`, `text-brand`) | Deep blue: main actions, links (always underlined), selected controls. Hover `brand-hover` (darkest navy). |
| `brand-soft` | A whisper of blue: info panels, the selected row or current item, the "schedule updated" banner. |
| `violet` | Pale sky blue (the token keeps its old name): the pill button in the home page hero and the header's "Request a pilot spot". Nowhere else. |
| `accent` / `accent-soft` | A brighter blue, sparingly: finalists, the pilot pill. Never routine status. |
| `teal-deep` | Darkest navy (the token keeps its old name): the closing band at the bottom of marketing pages. |
| `success` / `success-soft` | Done, confirmed, saved. |
| `warning` / `warning-soft` | Needs attention: due soon, unsaved changes, demo mode. |
| `danger` | Late, blocked, failed, destructive. Always with text. |
| `muted`, `border`, `field-border`, `surface`, `raised`, `background`, `foreground` | Neutrals: white canvas, warm off-white panels, near-black ink, slate-blue supporting text, slate edges on fields. |
| `header` | The header bar and the phone outlines around screenshots: deep blue, always dark so the white logo reads. |

Status colors always come with a text label; never rely on color alone. No
other accent colors.

## Type

- **One face**: Inter, loaded as a variable font so the in-between weights render: 460 for body (`font-normal`), 540 for headings and emphasis (`font-medium`), 600 for buttons and labels (`font-semibold`), 700 only for emphasized inline text (`font-bold`).
- **Page titles (`h1`)**: weight 500, 1.1 leading, tight tracking (-0.04em). Don't go heavier.
- **Tabular numbers** in tables, times, and number boxes, and with the `tabular-nums` class wherever digits stack in a column. Not on all text: in Inter it also widens hyphens ("Check - in"). Codes and IDs use JetBrains Mono (`font-mono`).

## Home page

Three canvases: a deep-blue hero with a soft sky glow (`.hero-sky`) and one
pale-blue pill CTA; white and off-white body sections; and a darkest-navy
closing band with one white button. One call to action per band. Screenshots
sit in a deep-blue phone outline (`PhoneFrame`) and use made-up sample data.

## Admin (back office)

The admin dashboard (`/admin`) is a desk tool for FieldCommand staff, styled like a CRM rather
than the customer app: a deep-blue sidebar, a search bar, then dense sortable tables and record
pages (a main column with a timeline, a 20rem side column of panels). Its pieces live in
`src/app/admin/kit.tsx`: small headers, flat panels with uppercase labels, tables with
sticky headers, square-cornered tags, and health dots (green healthy, blue new, amber watch,
red at risk, always with a word). Controls are 32px tall there, since it's used at a desk; the
customer app keeps its 44px touch targets. Same tokens, fonts and dark theme.

## Required answers (every form)

Mark a box `required` and the pattern comes for free (`src/components/required-fields.tsx`, mounted
in the root layout; styles at the end of `globals.css`):

- The form's submit button looks faded (50%) until every required box is filled in. It still works.
- Nothing turns red while they're typing. Only tapping save with a required box empty outlines each box still needed in red (`danger` border and a soft red ring), says
  "Fill in the boxes outlined in red." under the form ("Check…" when something's in the wrong
  format, like an email), and jumps to the first one. No browser pop-ups.
- Optional boxes are never outlined. Say "(optional)" in their label or hint instead.
- A form that checks everything itself (`noValidate`, like the pilot request) is left alone.

## Setup pages

How a host sets something up (Volunteer Setup, Band Registration). Same feel everywhere:

1. **Numbered steps.** Break the job into steps in the order it's done, each a `SetupStep` accordion
   (`src/components/setup-step.tsx`) titled "1. Registration settings", "2. Open registration"…, with
   one line under the title saying what the step is for.
2. **Progress at a glance.** Each step's title shows `StepStatus`: a green ✓ "Done" (or a better
   word: "Open", "Published") or a muted "Needs to be done". An optional step says "Optional" and
   never holds the others back. Only the first step still to do starts open; finished ones fold
   away. A list of things that each need setting up (stations) gets tabs with a green ✓ or a
   yellow dot.
3. **Ask once.** Never ask again for something an earlier step already has (the station name),
   and fill in what we can work out (shift titles from their times, the host's own contact details).
4. **Actions where the thing lives.** Each row carries its own buttons (Assign a Coordinator,
   Rename, Delete). Show a button only when it can be used; otherwise say how to make it possible
   ("Invite Coordinators below").
5. **A quick way and a careful way.** Where both make sense, a simple toggle between them (Auto
   create shifts / Create single shift). Redoing the quick way replaces what it made, as long as
   no real people depend on it yet.
6. **Required answers turn red only after a save attempt** (see above).
7. **Gentle reminders, not alarms.** Leaving a step unsaved or unfinished shows a light red note
   by its save button (`border-danger/30 bg-danger/5`) saying what's left, with a way to go anyway
   ("leave without saving", "finish it later"). Nobody gets trapped.
8. **Destructive means red, and honest.** Delete buttons are red and say exactly what they do
   ("Delete Station"); the confirmation says what really happens. If it would hurt people who've
   already signed up, refuse and say why.
9. **Save with the boxes, publish in its own bar.** Save, Cancel and Update are plain buttons
   right under the boxes they save. The one exception is a long form with lists of its own below it
   (a sign-up's tab in Volunteer Setup): a footer pinned to the bottom of the screen for the whole
   sign-up says what's left and holds its Save, with "Save for later" beside it until it's finished. Going live (Publish, Unpublish,
   Reveal) is a separate, outlined bar that's always on screen: pinned under the page title on a
   computer, pinned to the bottom on a phone. While something is being edited its buttons wait
   ("Save or cancel your changes first, then publish.").
10. **Plain, matching names.** A page's title matches the card that links to it. Buttons say what
   they do ("Create shifts", "Open band registration"), never "Submit".

### Tabs or one page

Pick by how the host uses the page:

- **A flow gets tabs.** The setup has parts done in turn, each with its own status, that the host
  comes back to until they're all done (Band Registration, Performance schedule, Rooms & schedule,
  Conference and Meeting Setup, Parent Registration, Booths & Partners, Volunteer Setup, Team setup).
  - A status card sits on top, with the link, Copy link, Preview page, any extra buttons, and the
    main action in one row and the QR code folded underneath.
  - Below it are tabs (`SetupTabs`), each with a ✓ or a yellow dot and a status line.
  - Each tab has a footer pinned to the bottom of the screen that holds its Save.
  - Leaving a tab with unsaved changes asks "Save your changes first?"
  - Day-of work (check-in) is its own page, not a tab.
- **Information gets one page.** Short settings the host reads and adjusts, and needs to see
  together, stay on one page with no tabs (Email settings, Maps & documents, Publishing &
  more). Splitting them would only hide things.

## Event settings (Event settings)

An event's global settings live on one page with a section menu: down the side on wide
screens, a row of tabs on phones. One section shows at a time, each with its own link
(`?section=details`, `files`, `team`, `emails`), and a ✓ in the menu once it has something in
it. Leaving a section with unsaved changes asks first. Before the event is published the page
is called "Set Up Your Event"; after, "Edit Event Details".

- **Event details**: name, dates, venue, the logo and color, and the kind of event.
- **Maps & documents**.
- **Team setup**: one tab per role (Co-hosts, Volunteer Leads, Coordinators), each with a ✓ and
  how many people. Leaving a tab with an invitation typed but not sent asks first. Coordinators
  can also be picked on each sign-up in Volunteer Setup.
- **Email settings**: where replies go, and who gets notifications.

Type-specific setup (bands, stations and shifts, conference times) stays on its own pages.

## Dark theme

Background `#06121F`, surface `#0C1F33`, raised `#132A42`, border `#253A51`,
text `#FFFFFF`, muted `#FFFFFF` (dark mode has no grey text: supporting text is white too, and opacity-faded text shows at full strength), primary `#9CC3EE` (on-primary `#071A31`),
accent `#7FB6E0`, success `#64D69A`, warning `#FFC266`, danger `#FF8A80`.
Header and closing band `#071A31`.

**The one exception to "no grey in dark mode": example text in empty boxes** (placeholders) is a softer
blue-grey `#A3B5C9` in italics (7.9:1 on a box), so an empty box never looks typed in (owner, 2026-11-11; lesson
L27). It's set once in `src/app/globals.css` (`--placeholder` and `::placeholder`); light mode uses `#5B6B7B`,
also in italics. Nothing else in dark mode uses grey text.

## Accessibility

- Touch targets at least 44×44px (buttons and inputs are `min-h-11`).
- Focus: 2px `primary` outline with a 2px offset (light blue in dark mode); inputs show a 3px focus ring.
- Respects `prefers-reduced-motion`.
- Normal text meets WCAG AA or better against its background.

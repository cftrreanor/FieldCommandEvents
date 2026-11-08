# Design review: one setup pattern for volunteer events, band contests, and meetings (mock-ups)

| | |
|---|---|
| **What was reviewed** | Volunteer and band drafts with the step bar as the one tracker, the Details step without Event settings' menu, step titles matching step names; meetings once live (Unpublish only in Event settings, the event page card with a fullness bar), and the meetings "Not ready" box |
| **Stage** | Mock-ups built from the real components, with sample data |
| **Size** | Full panel: Product Manager, Product Owner, UX Designer, UI Designer, Software Engineer, UX Content Manager, Marketing Manager, usability consultant |
| **Date** | 2026-11-08 |
| **Screenshots** | `docs/design-reviews/2026-11-08-setup-alignment-mockups/` (11 screens, phone, tablet, desktop, light and dark) |
| **Not reviewed** | Booking and sign-up pages, emails, event day |

**Coverage:** every reviewer opened what their role requires; the UI Designer and the consultant opened all 66.
The Software Engineer opened light only.

## The consultant's verdict

**Build after fixes.** One step bar, one "not ready" box, and the meetings card matching the volunteer card do
make the three kinds teach each other. The alignment isn't finished: Event settings' menu still acts like a
second tracker, and several names still differ by kind. **The one change that would help most:** make Event
settings' section menu a plain menu (no done/not-done circles), and keep the open section visible on phones,
where Unpublish now lives.

## Blocks people (severity 3)

### 1. Event settings' menu is a second tracker, and on phones it hides where you are · consultant 3, UI 3; 6 of 8
- **Where:** 04, 11 (desktop side list; phone and tablet chip row)
- **What happens:** each section has a check circle and "Optional / Default / Draft / Live", so it reads as a
  second checklist. On a phone the chips scroll sideways and the open section ("Publishing & more", the only
  place to unpublish) is off-screen.
- **Suggested fix:** plain labels with no circles; on phones a wrapping list or a "Section" menu, or scroll
  the open chip into view.

### 2. The volunteer area has two names on band contests · Marketing 3; 7 of 8
- **Where:** 05–07 step bar "Volunteer Setup" (title case) vs the card's "Jobs and shifts"; a volunteer
  event's logo card says "Print badges from Volunteer Setup", a step it doesn't have; a band contest's
  Volunteer Setup page is titled "Jobs and shifts" (Software Engineer)
- **Suggested fix:** one sentence-case name everywhere. Reviewers split: "Jobs and shifts" (PM, Marketing),
  "Volunteers" (Content), "Volunteer setup" (PO, UI).

### 3. Unpublishing a meetings event uses volunteer words and doesn't say what happens to people who booked · Content 3; 6 of 8
- **Where:** 11, the Publishing card and its confirmation
- **What happens:** "stops every sign-up and registration"; nothing says the 12 people who booked keep their
  times and aren't told. The confirmation drops the count and says it even when nobody has booked.
- **Suggested fix:** wording for each kind, with the count: "Your booking page is live, and 12 people have
  booked. Unpublishing hides the page and stops new bookings. Their times stay booked, and nobody is emailed."

## Should fix (severity 2)

**Names**
- The last step is "Publish" for volunteer events and meetings but "Publish registration" for band contests (6 of 8)
- Other old names: tab titles ("Volunteer jobs", "Registration"), "Go to registration", "Back to Volunteer
  jobs", "Broadcast Message", "Maps & documents", the draft state said three ways ("Draft…", "Event not
  published", "Not published") (5 of 8)
- "Meeting setup" is a card, a button in that card, and a page, but not a step name (4 of 8)

**Setup flow**
- Event settings opened during setup drops the step bar, has no way back to the step, and the details form
  lives in two places; step pages other than Publish have no Event settings button (5 of 8)
- Two filled main buttons do the same thing on the meetings Publish step ("Go to meeting times", "Add your
  hours"); the box names one thing while the line under it names two (5 of 8)
- Jobs and shifts has no "Next up" bar (3 of 8)
- The label under the current step differs ("Now · ready", none, "Now") (2 of 8)
- Old `?step=` links open a settings section titled "Event details" with no menu (Software Engineer)

**The event page**
- Drafts show a wall of zeros and later-stage cards (0 of 0 spots, Contest day, Broadcast) under the Not
  ready box (4 of 8)
- The live meetings page keeps the "Setup complete · Show the checklist" panel on desktop only (5 of 8; it is
  the same panel live volunteer events and band contests show, which the set didn't include)
- Weekly meetings get no fullness bar; a one-day event with no times would show "0 of 0" (Software Engineer)

**Live Meeting setup**
- It saves with a button ("All changes saved" beside a grey "Save meeting times") while every other page
  saves itself, and it doesn't say why (6 of 8)

**Phones and look**
- The pinned save bar takes too much of a phone screen (3 of 8)
- Small targets ("Copy link", "QR code", Host/Guest pills); "Add job" looks disabled; the empty progress
  track barely shows; Unpublish and Delete look equally dangerous (UI Designer)

**Copy from another context**
- Band contests' time zone help says "volunteer pages"; "Tap to add" on desktop; "Boxes marked * are
  required" on a page with no boxes; "Logo and color" with no color control; Jobs and shifts' first-job
  instructions in the wrong order; the schedule sentence on band contests has no verb (Content, Marketing)

**Ideas**
- A calm "every time is booked" line with "Add more times" (Marketing); "1 step left" instead of "needs
  work" (Marketing); success measures by kind (PM)

## What's working well

- The "Not ready to publish yet" box: the same on all three kinds, one named problem, one button, and "When
  you publish" bullets that answer "what happens?"
- The step bar as the one tracker on drafts; its needs-work line in words, and the phone summary
- Step titles matching step names, and "Next up: [step]"
- Unpublish in one place, beside Delete, in Event settings
- The meetings card now reads like the volunteer card
- Dark mode holds up everywhere

## Limits

An AI review of mock-ups with sample data, not testing with real people. For finding 1, ask two or three
organizers to find Unpublish on a phone.

## Light check on the built pages (2026-11-08)

UI Designer, Software Engineer, UX Content Manager, Marketing Manager, usability consultant, on
`docs/design-reviews/2026-11-08-setup-alignment-built/`. Consultant: "fix one thing, then ship".

- **Severity 3:** live Meeting setup's bar said "All changes saved · … until you save" (4 of 5); the empty
  Volunteers card said sign-up opens on publishing for kinds where it doesn't (Software Engineer). Both fixed.
- **Bugs fixed:** wording for non-job kinds, job names lowercased after "Now", old `?step=` links, quick-link
  names for parents and booths, leftover names.
- **Severity 2, done (owner: "1–9 now"):** the pinned bar on Jobs and shifts and a filled "Add job"; no
  "Back to [event]" on step pages; the band schedule card says "Opens after you publish"; section names match
  steps ("Jobs and shifts", "Meetings", "Change times or place", "Booking page"); "Now" first on phones;
  dark-mode checkboxes and radio buttons; pinned bars never cover the box being typed in; unpublish and delete
  say how many people and what happens; "When you publish" says what opens for every kind.
- **Later (owner):** the nav's "Volunteers" vs "Volunteer tracking", two bus-booking rules, the band logo
  card's wording, the cut-off contact email, dashed borders meaning three things, a few small targets, the
  demo card's chips.

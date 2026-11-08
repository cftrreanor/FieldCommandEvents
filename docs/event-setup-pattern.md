# The event setup pattern

Every kind of event that's set up in steps (volunteer events, band contests, and meetings, and every new
kind after them) is created and run the same way, so an organizer who has set up one already knows their
way around the next. Agreed with the owner on 2026-11-08, from the design reviews of meetings and the setup
alignment (`docs/design-reviews/2026-11-08-*`, decisions in `docs/design-decisions/`).

A new kind of event starts from this pattern. A design that departs from it needs the owner's decision,
logged in `docs/design-decisions/`. The rules behind it, with where each was found, are in
`docs/design-lessons.md` (lesson numbers in brackets).

## 1. Starting an event
1. **The first screen is step 1 of the same steps.** "New event" shows the same step bar, back link, and
   "Event details" title as the later steps, with Details as "Now" and the rest "Not yet". Filling it in
   never feels like the whole job. [L23]
2. **Ask only what's needed now.** Name and time zone (plus date and place where the event has them). Never
   suggest a day or hours the organizer has to choose: an empty box is honest, and a suggestion gets saved
   by accident. [L22]

## 2. The step bar
3. **One tracker.** While setting up, the step bar along the top is the only progress tracker: no checklist
   panel beside it, and no second menu on the Details step. [L24]
4. **The same shape for every kind:** Details, then the event's own step or steps, then Publish. Optional
   steps are marked "Optional" and never block.
5. **Every step says where it stands, in words, not color alone:** "Done", "Now", "Not yet", "Optional", or
   what it needs ("Add a job"). The step you're on always says "Now" first ("Now · add a job"). On phones,
   the steps that need work are named in a line under the bar.
6. **Event settings is one link away from every step,** but it's a separate page with its own plain menu
   (no done circles, no "Optional" under items). Opened during setup, it says "Back to setup".
7. **"Back" never jumps forward.** Step pages have no "Back to [event]" link; the step bar is the way
   around. [L24]

## 3. Each step page
8. **The same layout every time:** step bar, title, a short line about the step, then the form at the step
   bar's width, centered. [L15]
9. **The page title is the step name,** and the same name is on every button, link, card, and quick link
   that leads there. [L5]
10. **Steps save themselves, the same way:** a pinned bottom bar says "Saves as you go" on the left and has
    "Next up: [step]" on the right. One save model across sibling steps. [L18]
11. **A step with nothing saved says so** ("Not saved yet. Add your day and hours") instead of "Saves as
    you go", and its Next button is lighter until then.
12. **Nothing turns red until someone has had a go.** A box turns red only after it's left empty or Next is
    pressed, and it says why underneath ("Fill this in"). [L22]
13. **The pinned bar never covers the box being typed in,** and stays one line on phones. [L21]

## 4. Publishing
14. **The Publish step is the event page.** While it can't publish, it says "Not ready to publish yet",
    names the first missing thing, and gives one button to it. There's no Publish button until it's ready.
    [L17]
15. **"When you publish" says exactly what happens:** the page goes online, what opens (sign-up,
    registration, booking), that nobody is emailed, and that you can unpublish. [L11]
16. **One main button per screen.** Other cards on the same page use outline buttons. [L13]
17. **Drafts aren't dashboards.** An empty card is one line with its first action ("No jobs yet", "Add a
    job"); cards for later stages (Contest day) wait until they're useful; the draft state is said once, at
    the top. [L10]

## 5. Once it's live
18. **The event page is home.** Each area is a card named like its step, showing how full it is (a bar and
    two counts) and a button that says what it does.
19. **Each area's management page:** a status card with the link to share, Copy link, and Preview, then
    the settings (often in tabs).
20. **Unpublish and Delete live only in Event settings, Publishing and more.** Unpublish says, for each
    kind, what it stops, how many people are affected, and that they keep their place with nobody emailed.
    Delete names what it removes. Unpublish is an outline; only Delete is red. [L13]
21. **Changes that affect people who signed up are explicit.** A page where saving changes things for
    people already booked uses a Save button, says why only once something has changed, and warns about
    anyone the change affects before saving. [L3, L18]

## 6. Words
22. **One word per thing, one thing per word,** across every kind of event and every screen. [L5]
23. **Each kind uses its own audience's words:** bookings for meetings, sign-ups for volunteers,
    registration for bands. Never one kind's words on another's page.
24. **House style:**
    - follow `docs/brand-voice.md`;
    - sentence case;
    - "and", not "&";
    - no exclamation points;
    - Oxford comma;
    - no periods on buttons or labels;
    - "organizer" for the role.
25. **Promise only what the app does,** and say who sees personal details and when they're deleted. [L8, L16]

## 7. Every screen
26. **Phone (390 px), tablet (820 px), and desktop (1440 px), light and dark,** every time, with 44 px tap
    targets and nothing hidden off-screen. [L12]
27. **Status is never shown by color alone,** and controls stay readable in dark mode. [L6, L7]
28. **Design every state:** empty, partway done, ready, live, full, and over. [L2, L19]

## 8. How a new kind of event gets built
29. **Mock-ups first, from the real components:**
    - a full panel review;
    - the owner's decisions logged in `docs/design-decisions/`;
    - then build;
    - then screenshots, a light check, and the owner's decisions on that;
    - then the pull request.
30. **Anything rated serious waits for the owner's decision.** Repeat findings become design lessons, so
    the next build starts ahead.

## Where the pieces live (reuse them; don't copy them)

| Piece | Where |
|---|---|
| The steps for each kind (names, paths, which are optional) | `src/lib/setup-steps.ts` (`SETUP_STEPS`) |
| The step bar, including the phone layout, the "Event settings" link, and the new-event preview | `src/components/volunteer-steps.tsx` (`SetupSteps`) |
| Which kinds show the step bar, and what each step still needs | `src/app/dashboard/events/[eventId]/layout.tsx` (`volunteerSteps`, `bandSteps`, `meetingSteps`) and `src/lib/setup-facts.ts` |
| Step 1 before the event exists | `src/app/dashboard/events/new/page.tsx` (`FirstStep`) |
| The Details step vs Event settings (`stepOnly`, `steppedSetup`) | `src/app/dashboard/events/[eventId]/edit/page.tsx` |
| Event settings' plain menu | `src/app/dashboard/events/[eventId]/edit/settings-nav.tsx` |
| A step page's layout | `src/app/dashboard/events/[eventId]/conferences/step-page.tsx` (`StepPage`) |
| Saving as you go, with the pinned bar | `src/components/autosave.tsx` (`useAutosaveForm`, `AutosaveBar`) |
| Red boxes only after a try, with a reason under each | `src/components/required-fields.tsx` and `src/app/globals.css` |
| "Not ready to publish yet" and "When you publish" | `src/app/dashboard/events/[eventId]/page.tsx` (`PublishPanel`) and `src/lib/setup-checklist.ts` (`publishEffects`) |
| No second tracker on drafts | `src/app/dashboard/events/[eventId]/page.tsx` (`steppedSetup`) |
| The setup checklist and My events step count | `src/lib/setup-checklist.ts` |

### Checklist for a new kind of event
- [ ] Its steps are added to `SETUP_STEPS`: Details, its own step(s), Publish.
- [ ] The layout shows the step bar for it while it's a draft, with what each step still needs.
- [ ] It's added to `steppedSetup` and `stepOnly`, so drafts have one tracker and the Details step has no
      second menu.
- [ ] Its "New event" screen uses `FirstStep`.
- [ ] Each step page uses the step page layout, with its step name as the title and the self-saving bar
      with "Next up".
- [ ] `PublishPanel` names what's missing with one button to it, and `publishEffects` says what opens.
- [ ] Unpublish and Delete say what happens to its people, in its own words.
- [ ] The setup checklist counts the same steps as the step bar.
- [ ] Mock-ups and screenshots at three widths, light and dark, through the design-review skill.

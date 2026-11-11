# Design review: our own date and time pickers (issue #347)

| | |
|---|---|
| **What was reviewed** | Mock-ups of the new date box (type a date, or pick from a calendar) and time box (type any time, or pick from a list every 15 minutes), on a sample form: empty, filled, calendar open, time list open, typing a time, and a date typed wrong. The Software Engineer also tried them in a browser |
| **Stage** | Mock-ups before building (before they replace the browser's pickers on about 15 screens) |
| **Size** | Full panel: all seven roles plus the consultant |
| **Date** | 2026-11-11 |
| **Not reviewed** | The screens they'll go on, one by one (checked after building), and the admin banner's date-and-time box |

Screenshots: `docs/design-reviews/2026-11-11-date-time-pickers-mockups/` (five states, phone, tablet, and
desktop, light and dark).

## The consultant's verdict

Build after fixes. The boxes are calm and consistent in light and dark, and much clearer than the browser's
pickers: a chosen date reads "Mon, Nov 16, 2026", and typing is forgiving ("330p", "Nov 16", "noon"). The
serious problems are all cases where the box quietly saves something other than what the person meant. The
one change that would help most: the highlighted time in the list is always the time that gets saved.

## Blocks people (severity 3–4)

Nothing here gets built until the owner decides.

### 1. The highlighted time isn't the time that gets saved · severity 3 · found by 8 of 8
- **Where:** Time box while typing (screenshot 04: "4" typed in "To")
- **What happens:** The list highlights 4:00 AM at the top, and a screen reader says "4:00 AM". Pressing Enter or leaving the box saves 4:00 PM. Someone who trusts the highlight clicks 4:00 AM, or someone who wanted 4 PM goes looking for it.
- **Who it hurts:** The organizer at a laptop, the teacher in a rush, the front office administrator, and screen reader users
- **Standard:** Visibility of system status, error prevention, consistency
- **Suggested fix:** Put the time that will be saved first and highlight it: what was typed, read as a time (owner's request: "4" shows 4:00 PM, "3:20" shows 3:20 PM even though it isn't in the list), then the nearby list times. The top row is always what Enter saves.
- **Decision:** _pending_

### 2. A bare "7" means 7:00 AM, even for evening events · severity 3 · found by 2 of 8
- **Where:** Typing a time with no AM or PM
- **What happens:** Today 7 to 11 is morning and 12 to 6 is afternoon. An organizer typing "7" for a 7 PM concert or PTO meeting gets 7:00 AM, and the wrong time goes out to families.
- **Who it hurts:** The PTO president late at night, the teacher, and then every family who comes at the wrong time
- **Standard:** Error prevention, match with the real world
- **Suggested fix:** An end time ("To", "Ends") reads a bare hour as the first one after the start (start 3:30 PM, "7" means 7:00 PM). A start time keeps today's rule. Either way, the guess shows at the top of the list before it's saved (finding 1).
- **Decision:** _pending_

### 3. A date typed without a year can land in the past · severity 3 · found by 3 of 8
- **Where:** Typing "1/15" or "Jan 15"
- **What happens:** A date with no year uses this year. In December, typing "1/15" for a spring event gives January 15 of this year, already gone, and saves it where there's no earliest date.
- **Who it hurts:** The organizer and the PTO president setting up spring events in the fall
- **Standard:** Error prevention
- **Suggested fix:** With no year typed, use the next time that date comes around (today or later). A typed year is always kept.
- **Decision:** _pending_

### 4. Keyboard users lose their place in the calendar · severity 3 · found by 3 of 8
- **Where:** Calendar, keyboard
- **What happens:** Arrowing or paging onto a crossed-out day drops focus off the calendar, and then Esc stops working. Pressing Enter on "Next month" moves focus into the days, so a second Enter picks a day by accident. Esc only works while on a day.
- **Who it hurts:** Keyboard and screen reader users; anyone setting a deadline weeks ahead
- **Standard:** WCAG 2.1.1 and 2.4.3
- **Suggested fix:** Crossed-out days can be reached with the arrows and are read as "not available", but can't be picked. Focus stays on the month buttons when they're used. Esc closes the calendar from anywhere in it, or from the date box.
- **Decision:** _pending_

### 5. Picking a time can leave the list stuck open on real screens · severity 3 · found by 1 of 8
- **Where:** Any time box inside a labeled field (every real screen; the mock-up wasn't)
- **What happens:** Reproduced in a browser: clicking "4:00 PM" saves it, but the list reopens at once and covers the next box.
- **Who it hurts:** Everyone who taps; on a phone it hides the next field
- **Standard:** It's a bug
- **Suggested fix:** Fix it, and test each box inside the real form layout.
- **Decision:** _pending_

### 6. Earliest and latest dates no longer stop a save · severity 3 · found by 3 of 8
- **Where:** Date boxes with an earliest or latest date (end dates, deadlines); end times
- **What happens:** The limit is only checked when someone types. If "First day" moves past "Last day", the old "Last day" is saved without a warning. Today the browser blocks that save on seven screens. Time boxes have no limits at all, and "To" offers times before "From".
- **Who it hurts:** Organizers, who could publish an end before a start or a deadline already past
- **Standard:** Error prevention
- **Suggested fix:** Check the limit whenever the value or the limit changes, show "Pick a date on or after Mon, Nov 16" in red, and block the save as today. Give time boxes a "starts after" option for end times, and say so in red when the end is before the start.
- **Decision:** _pending_

## Should fix (severity 2)

7. **Boxes that can't be changed look like working ones** (7 of 8; the Software Engineer disagreed). Same border and icon, only greyer text, and the text is the same grey as the hint in an empty box. Fix: a tinted background, a lighter border, a faded icon, and a small lock. Keep the value readable, and let keyboard and screen reader users still reach it.
8. **Empty boxes still show the browser's hints** (4 of 8). "mm/dd/yyyy" suggests only one way of typing works, and "--:-- --" means nothing. Fix: "Pick a date" and "Pick a time" in the house hint grey, darkened to readable contrast.
9. **On phones, a tap brings up the keyboard, not a picker** (3 of 8). The time list opens behind the keyboard, and only the small icon opens the calendar. Fix: on touch screens a tap opens the calendar or the time list without the keyboard, with "Type it instead" for anyone who wants it. Test on a real iPhone and Android phone.
10. **The time list opens with the chosen time at the bottom** (5 of 8, one rated it 2). The later times people want next are hidden. Fix: open with the chosen time near the top, showing the times after it.
11. **"Today" replaces the chosen date** (1 of 8). Someone browsing ahead loses the date they had. Fix: "Today" moves the calendar back to this month without choosing a day. Picking today is one more tap.
12. **Errors aren't read aloud** (3 of 8). A screen reader user who leaves the box never hears the message. Fix: messages are announced as they appear.
13. **Screen readers hear the wrong names** (2 of 8). The calendar button says "Choose a date" without saying which date, and each box's name picks up the button's words. Fix: "Choose the first day" or similar, named from the field's label; the box's name is only its label.
14. **The calendar's structure is wrong for screen readers** (2 of 8). The chosen day is read as "toggle button, pressed". Fix: plain day buttons read as "Monday, November 16, 2026, selected".
15. **Esc doesn't undo, and can close the whole window** (3 of 8). Esc after typing over "3:30 PM" doesn't bring it back, and in the meeting windows Esc on the calendar's month buttons closes the window and loses what was typed. Fix: Esc closes the open calendar or list first; with nothing open, it puts the saved value back. It never closes the window behind.
16. **What Save does while a box shows an error isn't designed** (1 of 8). The browser's own bubble shows, and screens that save as you go would keep the old date while the box shows a red one. Fix: the save is blocked, the page says which box needs fixing, and focus goes there, the same way required fields already work.
17. **The boxes don't drop into some screens as they are** (1 of 8). Band contest settings save when you leave a box, and show a red border on a problem; the meeting windows count time steps in seconds; one form focuses its first box on opening. Fix: the boxes support all of these, so no screen changes behavior.
18. **Narrow boxes cut the date off** (1 of 8). "Mon, Nov 16, 2026" becomes "Mon, Nov 16, 2…" in two narrow spots. Fix: widen those spots.
19. **The calendar and list can be cut off inside windows and at the right edge** (1 of 8). In the meeting windows the calendar opens inside the window's scrolling area. Fix: pop-ups float above everything and open upward when there's no room below.
20. **The focus ring on the boxes is faint** (1 of 8). Fix: the same solid ring the calendar button has.
21. **Some states weren't shown** (4 of 8): crossed-out days, the range message, the time error, an empty box opening the calendar, a phone with the keyboard up, and 200% zoom. Fix: include them in the screenshots after building.
22. **The admin banner's date-and-time box** (1 of 8). It's one box for a date and a time with a time zone, and there's no matching new box. Options: keep the browser's box there (admin only), or use a new date box and time box side by side.

## Polish (severity 1)

- Say what's wrong in date errors ("November has 30 days"), and use an example date that won't go out of date.
- A shorter range message.
- A short reason under boxes that can't be changed, where the screen knows one.
- The focus ring in the error state sticks out past the box; the error border is thin in dark mode.
- Pop-ups blend into the card behind them; give them a raised surface and a stronger shadow.
- The calendar icon is small.
- Time rows have no hover style, and the highlight doesn't follow the mouse.
- Opening the list can scroll the whole page.
- "Today" is the browser's day, while some events have their own time zone.
- The note composer's small date box becomes full size.
- How we'll know it worked: fewer edited dates and times after publishing, and no "wrong time" support notes.

## What's working well

- Dates and times read back in words ("Mon, Nov 16, 2026", "3:30 PM"), so nobody wonders whether 11/12 is November or December.
- Typing is forgiving: "330p", "3pm", "15:30", "noon", "Nov 16", "11/16/26". Any typed time is saved, even one not in the list.
- Error messages sit under the box, use words as well as red, and say how to fix it.
- Every tap target is 44 px, the calendar fits a 390 px phone, and the text is 16 px so phones don't zoom.
- Selected and today use shape (filled and ringed), not just color, in light and dark.
- The boxes send the same values the browser's pickers did, so nothing changes in how events are saved, and dates can't shift by a day across time zones.
- No new libraries.

## By role

- **Product Manager:** the "7 means 7 AM" rule (severity 3) for a product full of evening events; end times should follow start times. Asked how we'll know it worked.
- **Product Owner:** dates without a year in the past, keyboard focus in the calendar, Save while a box shows an error, Esc, and a full set of acceptance criteria.
- **UX Designer:** phones getting a keyboard instead of a picker, and "Today" replacing the chosen date.
- **UI Designer:** the highlight (severity 3), the switched-off look, the list's scroll position, pop-up surfaces, and the error focus ring.
- **Software Engineer:** tried it in a browser. Found the stuck-open list and the unchecked limits (both severity 3), and everything needed for the boxes to drop into the real screens. Disagreed with the panel on the switched-off look, which they found clear enough.
- **Content Manager:** the placeholders, the calendar button's name, and the error and range wording.
- **Marketing Manager:** no blockers; the placeholders still look like the old browser boxes.
- **Consultant:** the highlight, keyboard focus, and past-year dates as the three that must be fixed; the screen reader structure and the focus ring.

## Acceptance criteria (from the Product Owner)

- Given an empty date box, when I type 11/16/2026, 11/16/26, 2026-11-16, "Nov 16 2026", or "16 Nov 2026" and press Enter or Tab, then it reads "Mon, Nov 16, 2026" and the form value is 2026-11-16.
- Given today is Dec 3, 2026, when I type "1/15", then it reads "Fri, Jan 15, 2027".
- Given I typed "4", then the first, highlighted option is 4:00 PM, and Enter saves 4:00 PM.
- Given I type "3:20 pm", when I press Enter, then it reads 3:20 PM.
- Given I type 2/30 or 25:00, then a message says how to fix it, the border turns red, and the message is announced.
- Given a calendar on the first allowed day, when I press ArrowLeft, then focus stays in the calendar.
- Given an end before its start, then a message says so next to the end, and Save doesn't go through.
- Given a box shows an error, when I press Save, then I'm told which box needs fixing and focus goes to it.
- Given I'm typing over a saved value, when I press Esc, then the saved value comes back.
- Given a form reset, or a value changed by the screen, then the box shows the new value with no leftover text or error.
- Given a box that can't be changed, then it looks clearly different from an empty box.
- Every control has a visible focus ring, in light and dark.

## Limits

This is an AI review, not testing with real people. The phone behavior (finding 9) especially needs a real
iPhone and Android phone before the boxes go on every screen.

## Follow-up light check

**Round 1** (consultant, UI Designer, Software Engineer), on `2026-11-11-date-time-pickers-built/`, after the
owner took every recommendation. The Software Engineer drove the real screens: values save, autosave and
unsaved-changes tracking notice a pick, required and invalid boxes block a save, and the pop-ups work in
windows and on touch screens. One severity 3: Tab from the calendar left the page (now Tab stays in the
calendar until it closes). Severity 2s, all fixed: dark-mode hints and locked text were white (L6 again; now
checked automatically), a faint list highlight (now a bar on the left), "Fill this in" under a filled-in box,
a required date marked red while its calendar was open, "2/29" jumping to 2028, the volunteer shift's end time
not following its start, focus dropped after a tap-pick, the calendar opening upward over its label, the
admin banner's boxes cutting off text and saving midnight for an empty time, and the missing states (now
screenshots 08–10, including 200% zoom, where the pop-ups scroll inside themselves). Polish fixed: 44 px days,
the icon button no longer covers the box's border, and the chosen time is in its row's name. Left for later
(severity 1): two messages on the band contest deadline after a refused save and then a typo.

The last round of fixes was checked against fresh screenshots by the builder, not by the panel again.

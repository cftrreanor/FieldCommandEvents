# Our own date and time pickers (2026-11-11)

Owner request: issue #347, replace the browser's date and time pickers with our own.

Owner decisions before building:
- Ours everywhere, phones included.
- Times: type any time, or pick from a list every 15 minutes. Any typed time is saved, even one not in the
  list (3:20 PM), and it shows at the top of the list while typing.
- Dates: a calendar pop-up, with typing allowed.

Full panel on the mock-ups (`docs/design-reviews/2026-11-11-date-time-pickers.md`). The owner took every
recommendation ("All as recommended, build it"):

| # | Finding | Severity | Decision |
|---|---|---|---|
| 1 | The highlighted time wasn't the time saved | 3 | Take the advice: the time that will be saved is first and highlighted |
| 2 | A bare "7" meant 7:00 AM for evening events | 3 | Take the advice: end times read a bare hour as the first one after the start |
| 3 | A date with no year could land in the past | 3 | Take the advice: the next time that date comes around |
| 4 | Keyboard users lost their place in the calendar | 3 | Take the advice |
| 5 | Picking a time left the list stuck open in real forms | 3 | Take the advice (bug) |
| 6 | Earliest and latest dates no longer stopped a save; no end-after-start for times | 3 | Take the advice |
| 7 | Boxes that can't be changed looked like working ones | 2 | Take the advice: tinted, dashed, faded icon, lock; still reachable |
| 8 | Browser hints in empty boxes | 2 | Take the advice: "Pick a date", "Pick a time" |
| 9 | Phones got the keyboard instead of a picker | 2 | Take the advice: a tap opens the calendar or list, with "Type it instead" |
| 10 | The list opened with the chosen time at the bottom | 2 | Take the advice |
| 11 | "Today" replaced the chosen date | 2 | Take the advice: it moves the calendar to this month |
| 12 | Errors weren't read aloud | 2 | Take the advice |
| 13 | Screen readers heard the wrong names | 2 | Take the advice |
| 14 | Calendar structure wrong for screen readers | 2 | Take the advice |
| 15 | Esc didn't undo, and could close the window behind | 2 | Take the advice |
| 16 | Save while a box shows an error | 2 | Take the advice: blocked, with the form's "Check this answer" pattern |
| 17 | The boxes didn't drop into some screens | 2 | Take the advice |
| 18 | Narrow boxes cut the date off | 2 | Take the advice |
| 19 | Pop-ups cut off inside windows | 2 | Take the advice |
| 20 | Faint focus ring | 2 | Take the advice |
| 21 | Missing states | 2 | Take the advice: in the screenshots after building |
| 22 | The admin banner's date-and-time box | 2 | A new date box and time box side by side |

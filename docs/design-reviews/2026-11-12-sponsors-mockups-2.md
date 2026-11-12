# Light check: round 2 of the Sponsors mock-ups

| | |
|---|---|
| **What was reviewed** | 8 round-2 boards (`docs/design-reviews/2026-11-12-sponsors-mockups-2/`), with levels first on the Sponsors page |
| **Size** | Light check: consultant, UX Designer, UI Designer, Software Engineer, Content Manager |
| **Date** | 2026-11-12 |

## Verdict

Build with fixes (consultant). Nothing blocks people in the design; the serious items are what the build must do.

## Severity 3

- **Year two** (UX): an event copied from last year leads with typing levels again; bringing back last year's
  sponsors and levels should come first.
- **Build requirements** (Software Engineer): the step bar holds at most 5 steps and gives unknown steps the middle
  step's status; logo resizing and checks must happen on our server (sharp, pixel limits, sizes per tile); sponsors
  must load only in the main public page, never in shared headers or the layout; the add-on switch, reads, writes,
  hidden and removed sponsors enforced in the database with security tests.

## Severity 2

Arrows that cross levels; Remove next to Edit with a timed Undo; Presented by pushing Up next down on phones on the
day; screen-reader names on repeated controls; the Levels card's height on later visits; the live line repeating the
thank-you heading; hiding the Presented by sponsor; a failed save far from its row; the fair's partner merge not shown
to organizers; too many red Remove links; the live line's ring looking like focus; mixed light and dark tiles in dark
mode; dialog buttons that don't match; long "no ads" line and "Ask us when you join" not answering first; "event
page" and "live line" words; two logo minimums; the email to sponsors; storage cleanup, reuse permissions, link
safety, and Presented by edge cases.

## Owner decisions

See `docs/design-decisions/2026-11-12-sponsors.md` (light check on round 2).

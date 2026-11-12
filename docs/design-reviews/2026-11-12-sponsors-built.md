# Light check before the pull request: the built Sponsors add-on

| | |
|---|---|
| **What was reviewed** | Screenshots of the built add-on (`docs/design-reviews/2026-11-12-sponsors-built/`, 30 screens) and the code |
| **Size** | Light check: consultant, UX Designer, UI Designer, Software Engineer, Content Manager |
| **Date** | 2026-11-12 |

## Verdict

Ship with fixes (consultant). The privacy promises hold on screen and in the database; no sponsors on registration
pages; the switch, host, and kind checks are enforced in the database.

## Severity 3

- **"Add sponsors from other events" when levels don't match** (consultant, UX): the level pickers sit below the whole
  list, out of sight; the hint "Pick a level for each first" points nowhere; the main button is disabled with no way
  forward in view.

## Severity 2

- Reuse: a level from another event can be attached through a direct call (database check missing); hidden sponsors
  come back showing; copied sponsors go live before their logo files exist; reuse should arrive hidden on a live event;
  "last year's" can name an event from this season; reuse across accounts for co-hosts (limit to the same account).
- Public pages: the thank-you line names the account, not the event; the day's line breaks on a dangling comma; the
  dark-mode sponsor wall is the brightest thing on the page; linked tiles signal links three ways; on festivals the
  day's line sits above the volunteer card.
- Logos: public logos not cached at the edge (every phone hits the server); large uploads decoded four times at once.
- The edit window: a red Remove in the phone footer; a missing level is a dead end; errors that don't say what to fix;
  the logo size rule said three ways; developer words ("tile", "live line"); fair partners with three names; reuse
  statuses that read like riddles; "Presented by" as a bare noun.

## Severity 1

Undo after the overnight cleanup; the "too big" message; an extra wait on event pages; Presented by's place on long
phone pages; "Add 0 sponsors"; the privacy page paraphrasing the promise; "Volunteer sign-up" in the never list;
"Change" with nobody chosen; level help in the add window; the website hint; the logo warning; thanks said twice;
the email to sponsors; the "Sponsors are off" line; rows that don't line up; small Presented by logos on phones;
uneven lower-level tiles; the fair's day line grouping; the logo error's place.

## Owner decisions

None needed: all fixes follow earlier decisions. Arrows still cross levels (owner's choice); an Undo is added when a
move changes a sponsor's level.

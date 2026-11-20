# Design review: volunteer sign-up that opens on a set day (built pages)

| | |
|---|---|
| **What was reviewed** | The built "Sign-up opens" date: Publish step, volunteering step, Event settings (draft and live), the event page and its Jobs card, Jobs and shifts while waiting, My events cards, the public sign-up page and event page before the day; and the code |
| **Stage** | Screenshots before the PR |
| **Size** | Light check: UX Designer, UI Designer, UX Content Manager, Software Engineer (code), usability consultant |
| **Date** | 2026-11-20 |

Screenshots: `docs/design-reviews/2026-11-20-signup-opens-built/`.

## The consultant's verdict

Build after fixes. Every organizer screen tells the same story from one helper, and "Open sign-up now" asks first. The
change that would help most: before the day, don't let volunteers fill in a form they can't send.

## Blocks people (severity 3), each with one clear fix

1. **Before the day the public form looks open** (all four design reviewers): shifts read-only with spots left; no
   details form or buttons; "Sign-up opens Mon, Jan 4. Come back then to pick a shift"; a calendar reminder link.
2. **"Clear" on a live event quietly closes sign-up** (UX, UI, Content, consultant): ask first; "Saved. Sign-up stays
   closed until you open it".
3. **A copied or unpublished event keeps a hidden opening day, and the Publish buttons say the wrong thing** (engineer):
   one rule, a day is set only when sign-up is switched on; a test.
4. **A fair can get an opening day that never comes** (engineer): online sign-up closes on fair day, so the day must be
   before the fair.

## Should fix (severity 2)

"12:00 AM Central Time, the start of Mon, Jan 4" instead of "midnight (CST)"; the public event page card looks
tappable ("See the shifts →"); the waiting badge next to "Published" on the event page and My events cards; one short
badge everywhere; "Open sign-up now" in Event settings too; moving the event's dates moves or clears the opening day;
missing security tests (a Co-host can change it, a Coordinator can't, walk-ups still work); clear "Saved" lines for
draft and live; check the sticky save bar doesn't cover fields.

## Polish (severity 1)

The time on organizer lines; "Share the link from the top of this page"; the badge before its label in Settings; "No
volunteers signed up yet" hidden while waiting; one range message; the draft hint; the step bar's "Now ·"; the field on
the Jobs step placed above the footer or dropped; two organizers saving at once; the time zone label on a
daylight-saving day; "This is a volunteer event."; "Next up:" at both widths; "at any time".

## What's working well

One story from one helper; the Publish button names the day; "Open sign-up now" confirms; the field saves and
announces; the public notice answers "when" first; pages refresh at the opening moment; every rewritten database
function kept its later changes; time zones worked out in the event's own zone.

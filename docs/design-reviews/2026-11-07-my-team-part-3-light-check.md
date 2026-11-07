# Design review: My team, part 3 (built, light check)

| | |
|---|---|
| **What was reviewed** | The built Undo note and handing on the Account Host role: My team (Account Host, co-host, and Volunteer Lead views), the offer and withdraw windows, and the offer page from the email link (open, sign-in, declined, expired, accepted), plus the emails and messages |
| **Stage** | Built pages, before the PR |
| **Size** | Light check: UX Designer, UX Content Manager, UI Designer, Software Engineer, usability consultant |
| **Date** | 2026-11-07 |
| **Screenshots** | `docs/design-reviews/2026-11-07-my-team-part-3-built/` (84: 14 screens, phone, tablet, desktop, light and dark; retaken after the fixes) |

## The consultant's verdict

Build after fixes. The handover is explained at each step, the windows guard the one choice you
can't take back, and every state of the offer page has a way forward. What's left is timing: what
the page says and where focus goes when Undo runs out, and status lines that don't stand out.

## Should fix (severity 2)

- **When Undo ends** (4 of 5): the note goes away but rows still say "Undo is at the top of the
  page" until a reload; removals made at different times share one Undo; focus can be lost.
- **Who pays after handing on** (2 of 5), and "You can't take this back" next to a Withdraw button.
- **How the last offer ended** is plain text that reads as help text (3 of 5).
- **After undoing a co-host's removal**, both screens say the offer ended because they left (Engineer).
- **Engineering** (Engineer): a second Accept sends a second email; Withdraw acts on whatever offer
  is open, not the one on screen; the offer page shows details on old links; missing security tests.
- **Dark mode has no grey** for supporting text (UI Designer).

## Polish (severity 1)

Decline without "…" on the offer page; two date formats; the offer page's two-part headline; the
sign-in line's brackets; filler after accepting; email wording ("undid removing you"); "No
Coordinators yet." with a period; an amber badge for a normal wait; lock order; Resend limit; three
row buttons wrapping on phones.

## What's working well

- Confirmation windows say what you keep ("Keep the offer open"), and the risky step is named honestly.
- Every closed state on the offer page gives the real reason, who has the role now, and one next step.
- One Undo per person, ending at a clock time, and it says who gets told.
- Tokens stay on the server; Undo is only for whoever removed them; every rule is in the database.

## Decisions

See `docs/design-decisions/2026-11-07-my-team-part-3.md` (light check section). All severity-2
findings fixed except dark-mode grey, kept by the owner (site-wide rule).

## Limits

An AI review, not testing with real people. Before launch, have two or three Account Hosts hand the
role to a co-host and undo a removal on a phone.

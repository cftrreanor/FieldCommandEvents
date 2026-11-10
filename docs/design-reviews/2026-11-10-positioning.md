# Design review: positioning beyond schools (home page and sign-up page)

| | |
|---|---|
| **What was reviewed** | Built pages: the home page (new headline, broader wording, a Sign-up sheets card) and a separate /sign-up-sheets page |
| **Stage** | Screenshots before the PR |
| **Size** | Full panel (new page): all seven roles plus the consultant |
| **Date** | 2026-11-10 |
| **Not reviewed** | Hero phone screenshots' contents, the pilot form's fields, the footer, other event pages |

While the panel worked, the owner merged sign-up sheets into volunteer events: one card and one page,
"Volunteers and sign-ups", at /volunteer-events (/sign-up-sheets forwards there), and the same label in the
app. That settled the most-raised problem (two cards for one thing, 8 of 8) and several smaller ones: the
pilot form's missing "Sign-up sheets" choice (6 of 8), the "Reminder texts" line (4 of 8), the search title
that said "without accounts" (4 of 8), and the "Reminders and changes on their own" heading (2 of 8). The
findings below are what still applies to the merged pages.

## The consultant's verdict

Build after fixes. The pages are calm, well organized, and keep the promise to people signing up front and
center. The weak spot is honesty about what an organizer is getting: a searcher who wants a sign-up sheet
finds a pilot application, a seven-week free period, and a price mentioned only inside a closed question.
The one change that would help most: say the pilot and the cost in plain words near the first button.

## Blocks people (severity 3–4)

### 1. The group size is wrong · severity 3 · found by 2 of 8
- **Where:** Volunteers and sign-ups page: intro, "Sign-ups and reminders, without accounts", and the "Can people sign up together?" answer (`src/lib/audiences.ts`)
- **What happens:** The site says "up to four others". The product allows six (`MAX_OTHERS` in `src/lib/group-signup.ts`, enforced by the database), and the sign-up form says "you and 6 others".
- **Who it hurts:** The PTO president splits her family over two sign-ups for no reason; the volunteer parent sees two different numbers.
- **Standard:** Claims guardrails (promises we keep)
- **Suggested fix:** Build every sentence from `MAX_OTHERS`, so the site can't drift again.
- **Also found:** organizers adding a walk-up can add only 4 others (`volunteers/actions.ts`), not 6. Worth matching.
- **Decision:** _pending_

### 2. What joining means, and that organizers pay later, is hidden · severity 3 · found by 6 of 8
- **Where:** The volunteers page's opening section and pilot section; the home page's "After the pilot" box; the home page's search data (`price: "0"` in `src/app/page.tsx`)
- **What happens:** The opening offers only "Join the pilot", without saying it's an application with a reply from a person, free until January 1, 2027, and paid by organizers after that. The cost is said plainly only inside a closed question. The search data can make results say "Free".
- **Who it hurts:** The PTO president and the teacher, who came for something quick; organizers comparing with free sites, who may feel misled later.
- **Standard:** Brand voice audiences rule (be clear organizers pay after the pilot); claims guardrails
- **Suggested fix:** One line under the first button on the event pages: "Free for organizers until the pilot ends January 1, 2027, then organizers pay. A person replies within a day to get you set up." Add "After the pilot, organizers pay to use it, and we'll talk with you first" to the home "After the pilot" box. Remove `price: "0"` from the search data.
- **Decision:** _pending_

## Should fix (severity 2)

3. **The pictures show band contests, not sign-up sheets** (6 of 8). No screenshot shows a things-to-bring list; the examples are a marching invitational and bus parking. The screenshots also predate a wording fix ("Volunteer signup"). Fix: new sample screenshots of a potluck sign-up (items with "2 of 4 desserts"), and a lighter setup screen for step 1.
4. **People bringing a dish are called "volunteers"** (1 of 8, Software Engineer). Every sign-up shows "Volunteer sign-up", "My volunteering", and emails like "you're volunteering tomorrow". Fix (later, bigger): let the wording follow the event, for example "Sign up" when it's only things to bring. Owner decision whether this is now or later.
5. **"Who sees what" doesn't say who sees what, and leaves out the 2-year volunteer history** (3 of 8). Adults' names, emails, and shift counts are kept 2 years so an account can invite reliable volunteers back, which doesn't fit "emails used only for your event". Others also see the first name of anyone bringing an item. Fix: add "Your event team sees names, emails, and phone numbers", "Others see the first name of anyone bringing something", and the 2-year history line. Check the Data privacy page says the same.
6. **The opening sentence is long** (3 of 8). Fix: "You set it up from your organizer account. Volunteers, families, and guests sign up from your link, as many as seven at once, with no account and no ads."
7. **"Free links" on the home page can read as "the product is free"** (3 of 8). This is your wording. Fix if you want it: "…on links anyone can open, free and with no account".
8. **One kind of event has three names** (5 of 8): "Family visitor days", "Family visitor day", and "Parent & visitor check-in". Fix: "Family visitor days" everywhere.
9. **Desktop cards say only "More", with different copy from phone** (5 of 8). Fix: "More about [kind]" on desktop, and one summary line at every width.
10. **On phone and tablet, the event kinds hide behind swiping** (3 of 8), with no "1 of 8" and a nearly invisible back arrow. Fix: a 2-column grid on tablet, a position count, and a visible back arrow.
11. **"How it works" steps are cut off mid-word on phone and tablet** (1 of 8, consultant). Fix: stack the three steps on phone.
12. **Feature sections don't line up on desktop** (2 of 8). Text starts in two places depending on whether there's a picture. Fix: one grid for every section (shared by every event page).
13. **Mixed heading sizes, mixed button shapes, and bright white checkboxes in dark mode** (1 of 8 each, UI Designer). Site-wide polish.
14. **"Privacy by default" is close to a banned claim** (2 of 8, pre-existing). Fix: retitle to "Who sees what".

## Polish (severity 1)

- Home questions: move "Who is it for?" and "Can churches, clubs, and community groups use it?" to the top, and use "churches" in both.
- "Your pilot is free until the pilot ends" says "pilot" twice.
- "For administrators" is a person, not a kind of event, in the "What are you organizing?" grid.
- "One account for every event" chips don't look like links.
- The "Talk with us" outline is faint on navy; the Feedback tab sits over content on tablet and desktop.
- The share image says "Events, without the clipboards." with a comma and period; the headline has neither.
- The phone header has no way back to all event types.

## What's working well

- "Events without the clipboards" and "without the ads" are short, concrete, and match what people search for.
- "What it replaces" names frustrations, never competitors.
- The account split (organizers have one; nobody signing up does) is said plainly and is true in the code.
- The cost question answers first and honestly ("Nothing renews or charges on its own").
- Every claim checked in code holds apart from the group size: things to bring, adults-only shifts, guardian consent, calendar invites, reminders, walk-ups, and 10-day phone deletion.
- Dark mode carries the new content cleanly; phone widths never scroll sideways.

## By role

- **Product Manager:** we can't tell whether the new positioning works; suggests recording which page a pilot request came from and the kind of group.
- **Product Owner:** the group-size error (severity 3); asks for screenshots of the form's success and error states.
- **UX Designer:** the overlapping cards (now merged) and the swipe-only list on phones.
- **UI Designer:** alignment, heading scale, button shapes, and dark-mode checkboxes.
- **Software Engineer:** the group size, the "volunteer" wording people bringing a dish see, and the 2-year history missing from the privacy box.
- **Content Manager:** sentence length, and exact replacement words for most lines.
- **Marketing Manager:** the pictures don't show a sign-up sheet; the cost should be in plain view.
- **Consultant:** the cost and pilot (severity 3), and the cut-off steps on phone.

## Acceptance criteria (from the Product Owner)

- Given any width, when someone reads the group size, then it equals `MAX_OTHERS` and matches the sign-up form.
- Given a potluck organizer, when they scroll the volunteers page, then they see a things-to-bring screenshot before the pilot form.
- Given desktop and phone, when the router shows a card, then its summary text is the same at both widths.
- Given any claim on the pages, when it's checked against the product, then the product does it.

## Limits

This is an AI review, not testing with real people. For the two severity 3 findings, try the volunteers page
with two or three organizers from outside schools before launch.

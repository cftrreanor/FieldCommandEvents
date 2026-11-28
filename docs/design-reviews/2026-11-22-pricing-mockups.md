# Design review: the public pricing page (mock-ups, checked against the brief)

| | |
|---|---|
| **What was reviewed** | The public page (whole page, chooser states, 320 px), the button flow (checkout by card and by invoice, confirmations, request form, Ask your Account Host), the admin Packages grid with new rows, and states (no price, hidden and retired, admin preview, public 404, data can't be read) |
| **Stage** | Mock-ups, checked against `docs/design-briefs/2026-11-22-pricing-page.md` |
| **Size** | Full panel: all seven roles and the consultant |
| **Date** | 2026-11-22 |

Screenshots: `docs/design-reviews/2026-11-22-pricing-mockups/`.

## The consultant's verdict

Build after fixes. The page is honest, scannable, and built around what organizers run: the chooser, words in every
cell, yearly-first prices, "Ask us" in place of $0, and comparing two packages on a phone all work. The problems are the
promises around money. The one change that would help most: decide what happens at renewal and use one true sentence on
the page, at checkout, and on the confirmation.

## Blocks people (severity 3–4)

1. **Renewal** (all 8; 4 for Content, Marketing, consultant): the page says "Nothing renews or charges on its own";
   checkout says "Renews yearly … Cancel anytime". Owner decision needed.
2. **The pilot wording is wrong on launch day** (7 of 8): the page goes live in January, after the pilot ends, so the
   hero, the January FAQ, and the header's "Join the pilot" must follow the pilot end date, and the home page's pricing
   lines must switch with the page.
3. **Passes have no next step** (PM, UX, consultant): a price with nothing to click.
4. **The chooser hides cheaper combinations** (PM, Marketing): a package plus a pass can cost far less ($290 vs $1,000).
5. **The teacher rate has no rule and no way to claim it**; **invoice terms are missing** (most): owner decisions.
6. **"Ask us" packages lead to a checkout with no price**; **the request form is a loose end** (PO).
7. **Feature lines the app doesn't enforce** (engineer): an unlimited team claims Volunteer Leads and Coordinators even
   when they're off; passes are offered for kinds a package already has, where the database never uses them.
8. **Phones: the matching packages are screens below the choice** (UX, PM).

## Should fix (severity 2)

"Every package includes your organization page" isn't true for Free Teacher (move the Free lines to their own section,
or "Every paid package includes"); one set of kind-of-event names everywhere (the website's names); checkout lists full
contents, never "Everything in X, plus" to a new buyer; "plus" never with an empty list; "Invoice total" instead of
"Total today"; upgrades say what happens to time already paid; the button label follows its destination ("Ask about
X"); "Recommended" with a reason, and every card shows which kinds it covers; the error state without a dead button;
"No account needed to sign up or register" instead of "no account for anyone you invite"; admin: pass names by kind,
undo while live, block going live with no packages shown, weekly hours editable; in-app upgrade messages never name a
hidden or retired package; email addresses wrap at 320 px; four cards line up at 1440; new accounts told how to sign
in; "Ask your Account Host" sends the email for them.

## Polish (severity 1)

"A team of 2: you and one helper"; one chooser heading; one hero button style; FAQ disclosure icons; phone table icon
alignment; admin "One at a time" not amber; the teacher rate in muted type with "Who qualifies"; "Send request".

## What's working well

The chooser and its pass hint; words in every cell; yearly first, "Ask us" never $0; the request form carrying over
what was picked; "Ask your Account Host"; the go-live switch, preview, and confirm; the hidden, retired, and no-price
states; the data truly read from the admin packages; the billing groundwork already in the database.

## Size (Software Engineer)

The page, admin rows, public read, and request form are medium pieces. Card checkout is large; invoices medium to large;
new-account checkout large and last; tax is a decision first.

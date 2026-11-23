# Decisions: the public pricing page (2026-11-22)

Brief: docs/design-briefs/2026-11-22-pricing-page.md (kickoff panel, all seven roles and the consultant).

| # | Question | Decision | Notes |
|---|---|---|---|
| 1 | What the package button does before checkout | Owner: **mock up the full thing** | The mock-up shows the complete experience, including choosing a package and the next step (checkout or request), not a stand-in. What ships first is decided after the mock-up |
| 2 | Show prices before January 1 | Owner: **not until January** | Build it, but the page stays hidden until the owner switches it on (a site-level switch in admin); nothing about the page changes the home page's pricing promise until then |
| 3 | Competition Command (priced above Event Command with fewer kinds of event) | Owner: **will change it in admin** | The page just follows the admin data |
| 4 | "Best for" lines, and the rest | Owner: **written in admin**, with everything else as the panel recommends | A "Best for" box per package on the Packages page; when blank, the page writes one from the package's contents. Also: "Show on website" per package and pass (new ones hidden, retired never); Free and Free Teacher as one line each, not cards; Sponsors as "Ask us"; passes named by kind of event; yearly price first; phones compare two packages |

## Mock-ups checked against the brief (2026-11-22)

Review: docs/design-reviews/2026-11-22-pricing-mockups.md (full panel). Owner decisions:

| # | Question | Decision | Notes |
|---|---|---|---|
| 1 | Renewal | Owner: **no automatic renewal** | A package is paid once for a year, by card or invoice; an email a month before it ends; nothing is charged unless they renew. Monthly payment comes off the page. The page keeps "Nothing renews or charges on its own" |
| 2 | What's built first | Owner: **request form first** | The page, the admin switches, "Ask about [package]" and "Get a [kind] pass" going to a short request form listed in admin, and "Ask your Account Host". The owner applies the package and sends the invoice. Card checkout and invoicing (Stripe) are their own later project. Every other review fix as recommended |
| 3 | Teacher rate | Owner: **classroom teachers** | A teacher using an account in their own name for their own classes or conferences; school, PTO, booster, and club accounts pay the regular price. They choose "I'm a classroom teacher" and a real person checks it |
| 4 | Invoice terms | Owner: **net 30, starts now** | Due within 30 days; the package starts when the invoice is sent; a reminder at 30 days; after 60 days unpaid the account moves to Free (nothing published is taken down); a quote and a W-9 available before ordering; yearly only |

## Built pages checked before the PR (2026-11-22)

Review: docs/design-reviews/2026-11-22-pricing-built.md (light check: UX, UI, Content, Engineer, consultant). Owner decisions:

| # | Question | Decision | Notes |
|---|---|---|---|
| 1 | The cheapest-option line under the chooser (severity 3) | Owner: **honest wording** | Every pass option says "for one event"; yearly and one-time prices stay apart ("$60 a year, plus $150 for one contest"); "one at a time" where that's all a package covers; the badge reads "Lowest price for one of each" when passes are used, and "Lowest price that includes what you picked" only for a package that covers everything; options that cost more without adding a pick are dropped; up to three options; the line gets its own button |
| 2 | Pilot wording after January 1 (severity 3) | Owner: **switch on January 1** | Home and conferences pages change after the pilot ends, whether or not the pricing page is on ("Get started", "Start free", no "pilot" in titles); links to the packages page appear only when it's live; the go-live dialog promises only what really changes |
| 3 | Every other finding | Owner: **all as recommended** | Including: hidden prices readable by admins only; limits on "Ask your Account Host" and request emails; requests from someone who isn't the Account Host are marked; the account's current package on each request |

## Follow-up light check after fixes (2026-11-23)

Screenshots: docs/design-reviews/2026-11-22-pricing-built-2/ (UX Designer, UX Content Manager, consultant). Owner decisions:

| # | Question | Decision | Notes |
|---|---|---|---|
| 1 | A pass doesn't add team spots (severity 3 once confirmed: an event on a pass keeps the package's team limit) | Owner: **passes add team spots** | A pass will also lift the team limit for that one event: its own later project (how teams work). Until it ships, the page says it plainly under pass options and in the passes section, from the package data ("Your team stays at 2: you and one helper. Volunteer Leads need Volunteer Command or above."), and that line changes when the project ships |
| 2 | "Get started" opens two forms after January 1 | Owner: **one form once live** | When the pricing page is on, every "Get started" opens the pricing request form. While it's hidden, the page's own form stays, and after the pilot the owner's emails and list call it a "Get started request", not "Pilot request" |
| 3 | Every other finding | Owner: **all as recommended** | |

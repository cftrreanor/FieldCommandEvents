# Brief: the public pricing page, fed from the admin Packages page (kickoff, 2026-11-22)

Owner's request: a public page showing each package, its price, and the features it includes (not just kinds of
event), with prices and packages coming from the admin Packages page, nothing hard-coded. Kickoff panel: all seven
roles and the consultant, before anything was drawn. Decisions: `docs/design-decisions/2026-11-22-pricing-page.md`.

## What the panel agreed on (all 8)
1. **Each package lists what it includes, never "Everything in X +" unless the data proves it.** Today's packages don't
   stack (Competition Command leaves out visitor check-in, fairs, and conferences, which Event Command includes).
2. **Only claim what the database enforces.** Package settings: kinds of event and "one at a time", weekly hours, team
   spots, Volunteer Leads and Coordinators, volunteer tracking (with how long details are kept), and pass prices.
   Check-in, badges, reminders, and the organization page come with every package: one "Every package includes" list,
   never checkmarks per package. The Sponsors add-on is switched on per account and has no price.
3. **Everything comes from the data,** read on each visit or refreshed when the admin saves. The hard-coded pass prices
   and the "District Command" name in `src/lib/plan.ts` must not be used.
4. **Start from what people run.** Package names mean nothing to a new organizer; a "What are you running?" choice
   points to the right package, and **event passes are a real choice** for groups that run one event a year.
5. **Honest buttons.** Nobody can buy yet; no "Buy" or "Subscribe". The page says these are prices after the pilot and
   that nothing charges on its own.
6. **Words in every cell** ("Included", "One at a time", "Not included"), never color alone; "One at a time" not in
   warning amber; a real table on wide screens, two packages side by side on phones.
7. **Yearly price first,** with the monthly price under it ("$240 a year, or $30 a month"); a missing price is "Ask
   us", never $0 or "Not set".

## Must-haves for v1
- **Admin:** a "Show on website" switch per package and per pass (new ones start hidden; retired never show); a "Best
  for" line per package; at most one "Recommended" mark; a weekly hours row on the grid.
- **Public read:** a narrow database function returning only listed, active packages and their public fields; anon no
  longer reads the whole packages table; security tests.
- **Page:** heading and pilot line; "What are you running?"; package cards (name, price, best-for, kinds of event with
  "one at a time" explained, the team features, one outlined button); "Every package includes"; event passes ("Running
  just one event?"); "Compare every package" table; Sponsors as "Ask us"; FAQ (one at a time, what happens January 1,
  nothing taken away, purchase orders); links from the home page, menus, footer, audience pages, and the sitemap.
- **States:** price not set, retired, hidden, Free and Free Teacher (one line each, not cards), teacher rate, passes,
  data can't be read.
- **Fix along the way:** the app's upgrade suggestion never names a hidden or retired package; the home page's "we'll
  talk with you about pricing" and "every feature free" lines agree with the page; "premium" on the conferences page
  becomes "weekly hours"; pass names follow the kind-of-event names.

## Words (Content Manager)
"Packages and prices"; "Free for organizers through [date]. After that, choose the package that fits the events you
run. Volunteers, families, and visiting directors never pay"; team spots, Volunteer Leads and Coordinators, volunteer
tracking, and weekly hours each with one plain line; "Publish one event of a kind your package doesn't include. Use it
within 12 months"; "Prices are per account. Nothing renews or charges on its own".

## Questions for the owner
The button before checkout; publishing prices before January 1; Competition Command; the "Best for" lines.

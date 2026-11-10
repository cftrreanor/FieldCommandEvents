# Admin: new and retired packages, demo accounts, host-first Accounts (2026-11-10)

Owner requests: issues #337 (Accounts: the person's name first, like the Pipeline), #345 (create a package),
#346 (demo accounts get in the way on People).

Owner decisions before building:
- A new package copies an existing one (owner picks which); prices start "Not set"; no account moves onto it.
- Packages can be retired: kept by the accounts on them, not offered for new accounts or invitations, and
  can be brought back. Free Teacher, Free, and Event Command can't be retired (new accounts start on them).
- The "New" tag stays until the package's first account joins.
- People hides demo-mode accounts by default (nothing deleted), with a filter to show them.
- **Admin pages get a light check, not the full panel:** they aren't customer-facing, so they don't need to be
  perfect now. Real bugs and anything that blocks the owner get fixed; cosmetic findings wait.
- Mock-ups of the Packages changes approved by the owner before building.

Light check on the built pages: UI Designer, consultant, Software Engineer
(`docs/design-reviews/2026-11-10-admin-packages-people/`).

| Finding | Severity | Decision |
|---|---|---|
| Retiring a package after inviting someone on it blocked their account setup | 4 | Fixed: an invitation sent before retiring still starts its host on the package (database test) |
| Reopening a waiting invitation on a retired package switched it to Free Teacher | 3 | Fixed: its saved package stays, marked "(retired)" |
| Host upgrade hints could name a retired package | 2 | Fixed |
| Missing tests (pilot request plan, invitation path, rate-only change) | 2 | Fixed |
| Tags small and crammed; Retire looked like a main action; window title; "as today" wording | 2 / 1 | Fixed (cheap) |
| Copying dropped the teacher rate | 1 | Fixed: it's copied, prices still not set |
| Retired column not muted; buttons alike; dark-mode window edge; tablet tables; filter labels; tag colors; Accounts link styling; "account" wording on People; Retire using the shared note | 1–2 | Later: admin-only, owner said not to chase polish now |

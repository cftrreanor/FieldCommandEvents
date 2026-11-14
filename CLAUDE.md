@AGENTS.md

# Project notes
- Owner is non-technical: explain setup steps plainly, never ask them to paste secrets into chat.
- A migration that creates a table grants its access in the same file (`grant ... to service_role`,
  plus `authenticated`/`anon` as needed): Supabase no longer grants it automatically.
- Privacy rules live in the database (supabase/migrations). Any change to RLS or the
  security-definer functions needs a matching case in supabase/tests/security_test.sql.
- Run `npm run lint && npm run typecheck && npm run build && npm run test:db` before pushing.
- Product name comes from src/lib/brand.ts only; don't hard-code it.
- All website and in-app copy follows docs/brand-voice.md (tagline, no exclamation points, Oxford
  comma, no periods on incomplete headlines/buttons/bullets/labels, "organizer" for the role, claims guardrails). In-app permission levels stay "Host"/"Co-host"/"Account Host".
- Number-only fields use `NumberInput` (src/components/number-input.tsx): a type-in box that
  accepts digits only. Never use `<input type="number">` (no up/down arrows).
- Date and time fields use `DateField` and `TimeField` (src/components/date-field.tsx, time-field.tsx), never
  `<input type="date">`, `"time"`, or `"datetime-local"`. End times pass their start as `after`.
- Designs go through the design-review skill (.claude/skills/design-review): mock-ups before
  building, screenshots before a PR goes out. Severity 3–4 findings block until the owner decides,
  and decisions are logged in docs/design-decisions/.
- Every kind of event set up in steps (volunteer events, band contests, meetings, and any new kind) follows
  docs/event-setup-pattern.md: the step bar as the one tracker, the same step pages, saving, publishing,
  live management, and words. Build new kinds from it (its checklist and shared components), check
  designs against it before review, and log any departure as an owner decision in docs/design-decisions/.
- Before mocking up or building anything people see, read docs/design-lessons.md (what the review panel
  keeps finding). Run its self-check before every review, and add repeat findings to it afterward.
- When a page's main data is missing, call `missing()` from src/lib/schema-check.ts, not
  `notFound()`: it shows "a database update is needed" when a migration hasn't been run yet.
- Keep docs/PROJECT-CONTEXT.md current: any PR that changes what people see or do updates it (the
  feature's line, and a line under Recent changes). The owner syncs it into their Claude project.

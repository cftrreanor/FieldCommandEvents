// Run with: npm test. The two-week deadline rule, shared by Band registration and the Duplicate page.
import assert from "node:assert/strict";
import { test } from "node:test";
import { contestDeadlineWarning, suggestedDeadline } from "./contest-deadline.ts";

test("registration should close two weeks before contest day; a festival's before its first day", () => {
  assert.equal(suggestedDeadline("band_contest", "2026-12-05"), "2026-11-21");
  assert.equal(suggestedDeadline("group_event", "2026-12-05"), "2026-12-04");
});

test("the Duplicate page's warning names the latest deadline and the days directors would have", () => {
  assert.equal(contestDeadlineWarning("band_contest", "2027-01-30", "2026-11-20"), null, "plenty of time");
  const short = contestDeadlineWarning("band_contest", "2026-12-08", "2026-11-20");
  assert.equal(short?.head, "That's 18 days away.");
  assert.match(short?.body ?? "", /two weeks before contest day, by Tue, Nov 24, so directors would have 5 days to register/);
  const past = contestDeadlineWarning("band_contest", "2026-12-01", "2026-11-20");
  assert.match(past?.body ?? "", /latest deadline would be Tue, Nov 17, which has passed/);
  const fest = contestDeadlineWarning("group_event", "2026-12-05", "2026-11-20");
  assert.equal(fest, null, "a festival 15 days out has time");
  assert.match(contestDeadlineWarning("group_event", "2026-11-23", "2026-11-20")?.body ?? "", /by Sun, Nov 22 at the latest, so directors would have 3 days/);
});

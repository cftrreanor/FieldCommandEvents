// Run with: npm test (node's built-in test runner; Node strips the types).
// The same cases run against the database's copy_blank_dates in supabase/tests/security_test.sql ("dup: blank").
import assert from "node:assert/strict";
import { test } from "node:test";
import { blankOldDates, countNewDates, eachDay, NEW_DATE } from "./old-dates.ts";

// A copy on Sat–Sun, Nov 6–7, 2027.
const keep = eachDay("2027-11-06", "2027-11-07");
const blank = (t: string) => blankOldDates(t, keep).text;

test("old dates in copied text become [new date], times stay", () => {
  assert.equal(blank("Arrive by 7:45 on Nov 7. See you Saturday, Nov 7!"), "Arrive by 7:45 on Nov 7. See you [new date]!");
  assert.equal(blank("Forms due 11/1/26 or 10/30. Bring 1/2 gallon. Room 13/40."), "Forms due [new date] or [new date]. Bring 1/2 gallon. Room 13/40.");
  assert.equal(blank("Through November 22nd, 2026 and Nov. 21-22. The 2026 shirts."), "Through [new date] and [new date]. The 2026 shirts.");
  assert.equal(blank("May 3rd; march on; Dec 1–2"), "[new date]; march on; [new date]");
});

test("the copy's own days stay, with a weekday only when it matches", () => {
  assert.equal(blank("See you Nov 7 2027 and Sunday, Nov 7 and Sat Nov 6"), "See you Nov 7 2027 and Sunday, Nov 7 and Sat Nov 6");
  assert.equal(blank("Monitor 11/7 maybe. Sat 11/14."), "Monitor 11/7 maybe. [new date].");
  assert.equal(blank("Nov 7, 2026"), NEW_DATE, "the right day in another year is old");
});

test("counts", () => {
  assert.equal(blankOldDates("Nov 1 and 11/2", keep).count, 2);
  assert.equal(blankOldDates(null, keep).count, 0);
  assert.equal(countNewDates(`a ${NEW_DATE} b ${NEW_DATE}`), 2);
  assert.equal(countNewDates("Meet at the north lot"), 0);
});

test("each day of an event", () => {
  assert.deepEqual(eachDay("2027-02-27", "2027-03-01"), ["2027-02-27", "2027-02-28", "2027-03-01"]);
});

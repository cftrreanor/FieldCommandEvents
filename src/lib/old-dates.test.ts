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

test("things that aren't dates stay: grades, scores, words, names, links", () => {
  assert.equal(blank("Grades 4/5 and 6/7/8 meet at 9. Grade 3/4 too."), "Grades 4/5 and 6/7/8 meet at 9. Grade 3/4 too.");
  assert.equal(blank("Scored 10/10 and 9/10 last year"), "Scored 10/10 and 9/10 last year");
  assert.equal(blank("We march 8 to 5. You may 2 shifts."), "We march 8 to 5. You may 2 shifts.");
  assert.equal(blank("Ask Jan 2 hours before"), "Ask Jan 2 hours before");
  assert.equal(
    blank("See https://example.org/2026/11/1 or [Nov 1 map](https://x.org/nov-1) or www.site.com/11/1 or parks.org/11/1"),
    "See https://example.org/2026/11/1 or [Nov 1 map](https://x.org/nov-1) or www.site.com/11/1 or parks.org/11/1",
  );
  assert.equal(blank("Nov 1 at https://x.org/a and Nov 2"), "[new date] at https://x.org/a and [new date]");
});

test("more ways of writing a date are caught", () => {
  assert.equal(
    blank("On 8 November, the 8th of November, 2026-11-08, 11-8-2026, and Saturday the 8th."),
    "On [new date], [new date], [new date], [new date], and [new date].",
  );
  assert.equal(blank("Saturday the 6th, Sunday 7 November 2027, 2027-11-07"), "Saturday the 6th, Sunday 7 November 2027, 2027-11-07");
  assert.equal(blank("Sunday the 6th"), NEW_DATE, "the 6th is a Saturday");
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

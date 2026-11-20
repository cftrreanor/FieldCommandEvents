// Run with: npm test (node's built-in test runner; Node strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { eachDay, findOldDates } from "./old-dates.ts";

const keep = eachDay("2027-04-17", "2027-04-18");

test("finds last year's dates in copied text", () => {
  const found = findOldDates("Bring gloves. See you Saturday, Nov 21! Trail work runs through November 22nd, 2026.", keep, 2026);
  assert.deepEqual(
    found.map((f) => f.text),
    ["Nov 21", "November 22nd, 2026"],
  );
  assert.match(found[0].context, /See you Saturday, Nov 21/);
});

test("the copy's own dates aren't old", () => {
  assert.deepEqual(findOldDates("See you April 17 and Apr. 18, 2027 (4/17).", keep, 2026), []);
});

test("numbers and a year on its own", () => {
  assert.deepEqual(
    findOldDates("Forms due 11/14/26. The 2026 shirts are in.", keep, 2026).map((f) => f.text),
    ["11/14/26", "2026"],
  );
  assert.deepEqual(findOldDates("Since 2019, our 2027 cleanup", keep, 2026), [], "other years and the copy's year are fine");
});

test("nothing to check", () => {
  assert.deepEqual(findOldDates(null, keep), []);
  assert.deepEqual(findOldDates("Meet at the north lot", keep), []);
  assert.deepEqual(findOldDates("Call 512/555 or room 13/40", keep), [], "not a date");
});

test("each day of an event", () => {
  assert.deepEqual(eachDay("2027-02-27", "2027-03-01"), ["2027-02-27", "2027-02-28", "2027-03-01"]);
});

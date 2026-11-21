// Run with: npm test. The confirm step books an adult only: without remembered details it needs "I'm 18 or older"
// ticked, so it can't book an Adults only shift, or skip a guardian's consent, for someone who didn't say they're 18.
import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmAgeProblem } from "./confirm-age.ts";
import { ineligibleReason } from "./group-signup.ts";

const adultsOnly = { adultsOnly: true, minAge: null };

test("first time, box not ticked: refused, so nothing is booked as an adult", () => {
  assert.match(confirmAgeProblem({ remembered: null, adultTicked: false }) ?? "", /18 or older/);
});

test("first time, box ticked: booked as an adult", () => {
  assert.equal(confirmAgeProblem({ remembered: null, adultTicked: true }), null);
});

test("a remembered adult needs no box", () => {
  assert.equal(confirmAgeProblem({ remembered: { minor: false }, adultTicked: false }), null);
});

test("a remembered under-18 is sent to the full form, even with the box ticked", () => {
  assert.match(confirmAgeProblem({ remembered: { minor: true }, adultTicked: true }) ?? "", /full sign-up form/);
});

test("an Adults only shift: the confirm path books it only after the age is settled as an adult", () => {
  // Whoever passes the age rule is booked as an adult (minor: false), which is the only way an Adults only shift
  // takes them; someone under 18 would be refused by the full form's own check.
  assert.notEqual(confirmAgeProblem({ remembered: null, adultTicked: false }), null);
  assert.equal(ineligibleReason({ minor: true, age: 15 }, adultsOnly), "Adults only", "under 18 can't take an Adults only shift");
});

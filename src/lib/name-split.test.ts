// Run with: npm test (node's built-in test runner; Node strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { guessSplit, likelySplits } from "./name-split.ts";

test("particles stay with the last name", () => {
  assert.deepEqual(guessSplit("Luis Von Berg"), { first: "Luis", last: "Von Berg" });
  assert.deepEqual(guessSplit("Victor De la Cruz"), { first: "Victor", last: "De la Cruz" });
  assert.deepEqual(guessSplit("Juan Carlos de la Cruz"), { first: "Juan Carlos", last: "de la Cruz" });
  assert.deepEqual(guessSplit("Mary St. John"), { first: "Mary", last: "St. John" });
  assert.deepEqual(guessSplit("Anne Saint Clair"), { first: "Anne", last: "Saint Clair" });
  assert.deepEqual(guessSplit("Derek Le Blanc"), { first: "Derek", last: "Le Blanc" });
  assert.deepEqual(guessSplit("Jan ter Horst"), { first: "Jan", last: "ter Horst" });
});

test("without a particle, the last word is the last name", () => {
  assert.deepEqual(guessSplit("Ben Okafor"), { first: "Ben", last: "Okafor" });
  assert.deepEqual(guessSplit("  Mary   Ann Smith "), { first: "Mary Ann", last: "Smith" });
  assert.deepEqual(guessSplit("Van Morrison"), { first: "Van", last: "Morrison" }, "a first word is never a particle");
  assert.deepEqual(guessSplit("Cher"), { first: "Cher", last: "" });
});

test("the likely splits: the guess first, then every other split", () => {
  assert.deepEqual(likelySplits("Ana García López"), [
    { first: "Ana García", last: "López" },
    { first: "Ana", last: "García López" },
  ]);
  assert.deepEqual(likelySplits("Victor De la Cruz"), [
    { first: "Victor", last: "De la Cruz" },
    { first: "Victor De", last: "la Cruz" },
    { first: "Victor De la", last: "Cruz" },
  ]);
  assert.deepEqual(likelySplits("Cher"), []);
  assert.deepEqual(likelySplits("Ana María de los Ángeles Pérez"), [
    { first: "Ana María", last: "de los Ángeles Pérez" },
    { first: "Ana", last: "María de los Ángeles Pérez" },
    { first: "Ana María de los Ángeles", last: "Pérez" },
  ], "long names: the guess, after the first word, before the last");
});

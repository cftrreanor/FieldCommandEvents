// Run with: npm test. The organization page's months, words, and the "More ways to help" picks.
import assert from "node:assert/strict";
import { test } from "node:test";
import { byMonth, kindWords, needWords, pickMoreWays, siteOf, signupHref, whenWords, type OrgHelp, type OrgListingEvent } from "./org-page.ts";

const NOW = new Date("2026-11-21T15:00:00Z"); // Sat, Nov 21, 9:00 AM Central
const ev = (over: Partial<OrgListingEvent>): OrgListingEvent => ({
  slug: "e",
  name: "Event",
  kind: "volunteer",
  starts_on: "2026-12-04",
  ends_on: "2026-12-04",
  timezone: "America/Chicago",
  venue_name: null,
  open_spots: 3,
  items_needed: 0,
  opens_on: null,
  soonest_shift: { id: "s", starts_at: "2026-12-04T17:00:00Z", ends_at: "2026-12-04T19:00:00Z", job: "Serve" },
  ...over,
});
const help = (id: string, ends_on: string): OrgHelp => ({ id, title: id, note: null, link: null, ends_on });

test("months with no events never show; later months keep their order", () => {
  const groups = byMonth([ev({ starts_on: "2026-11-21", ends_on: "2026-11-21" }), ev({ starts_on: "2027-02-03", ends_on: "2027-02-03" }), ev({ starts_on: "2027-02-10", ends_on: "2027-02-10" })], NOW);
  assert.deepEqual(groups.map((g) => [g.label, g.events.length]), [["November", 1], ["February", 2]]);
});

test("something under way goes under today's month", () => {
  const groups = byMonth([ev({ starts_on: "2026-10-30", ends_on: "2026-11-22" })], NOW);
  assert.equal(groups[0].label, "November");
});

test("a month name that comes round again gets its year", () => {
  const groups = byMonth([ev({ starts_on: "2026-11-25", ends_on: "2026-11-25" }), ev({ starts_on: "2027-11-02", ends_on: "2027-11-02" })], NOW);
  assert.deepEqual(groups.map((g) => g.label), ["November", "November 2027"]);
});

test("the kind's own words", () => {
  assert.equal(kindWords(ev({ kind: "fair" })).button, "Sign up to help");
  assert.equal(kindWords(ev({ soonest_shift: null, open_spots: 0, items_needed: 4 })).word, "Things to bring");
  assert.equal(kindWords(ev({})).word, "Volunteer event");
  assert.equal(needWords(ev({ open_spots: 1 })), "1 spot open");
  assert.equal(needWords(ev({ open_spots: 0, items_needed: 10 })), "10 things still needed");
});

test("when: today starts with the time; several days say shifts each day", () => {
  const range = { start: "2026-11-21T17:00:00Z", end: "2026-11-21T19:00:00Z" };
  assert.equal(whenWords(ev({ starts_on: "2026-11-21", ends_on: "2026-11-21" }), range, NOW), "11:00 AM – 1:00 PM CST");
  assert.equal(whenWords(ev({ starts_on: "2026-12-07", ends_on: "2026-12-09" }), range, NOW), "Mon–Wed, Dec 7–9 · Shifts each day");
  assert.equal(whenWords(ev({}), null, NOW), "Fri, Dec 4");
});

test("more ways: three events, soonest first, one each", () => {
  const ways = pickMoreWays([ev({ slug: "a" }), ev({ slug: "b" }), ev({ slug: "c" }), ev({ slug: "d" })], [help("h", "2026-11-27")]);
  assert.deepEqual(ways.map((w) => (w.type === "event" ? w.event.slug : w.help.id)), ["a", "b", "c"]);
});

test("more ways: a spare slot takes the Help anytime item ending soonest", () => {
  const ways = pickMoreWays([ev({ slug: "a" })], [help("later", "2027-01-01"), help("soon", "2026-11-27")]);
  assert.deepEqual(ways.map((w) => (w.type === "event" ? w.event.slug : w.help.id)), ["a", "soon"]);
});

test("more ways: when everything here is full, Help anytime gets the last slot", () => {
  const ways = pickMoreWays([ev({ slug: "a" }), ev({ slug: "b" }), ev({ slug: "c" })], [help("h", "2026-11-27")], { hereIsFull: true });
  assert.deepEqual(ways.map((w) => (w.type === "event" ? w.event.slug : w.help.id)), ["a", "b", "h"]);
});

test("more ways: not open yet and same-time shifts drop out", () => {
  const ways = pickMoreWays([ev({ slug: "later", opens_on: "2027-01-04" }), ev({ slug: "clash" })], [], {
    booked: [{ startsAt: "2026-12-04T18:00:00Z", endsAt: "2026-12-04T20:00:00Z" }],
  });
  assert.equal(ways.length, 0);
});

test("links", () => {
  assert.equal(siteOf("https://www.amazon.com/hz/wishlist/ls/X"), "amazon.com");
  assert.equal(siteOf("not a link"), null);
  assert.equal(signupHref("winter-carnival", "more", "abc"), "/e/winter-carnival/volunteer?via=more&shift=abc");
  assert.equal(signupHref("winter-carnival", "org"), "/e/winter-carnival/volunteer?via=org");
});

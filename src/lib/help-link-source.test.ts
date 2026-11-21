// Run with: npm test (node's built-in test runner; Node strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmSource, helpLinkSource } from "./help-link-source.ts";

test("the two links count as their source", () => {
  assert.equal(helpLinkSource("more_ways"), "more_ways");
  assert.equal(helpLinkSource("more"), "more_ways");
  assert.equal(helpLinkSource("org_page"), "org_page");
  assert.equal(helpLinkSource("org"), "org_page");
});

test("anything else is direct", () => {
  for (const v of [null, undefined, "", "email", "toString", "__proto__", "ORG_PAGE", 3]) assert.equal(helpLinkSource(v), "direct");
});

test("the confirm step counts on its own", () => {
  assert.equal(confirmSource("more"), "more_ways_confirm");
  assert.equal(confirmSource("org"), "org_page_confirm");
  assert.equal(confirmSource("elsewhere"), "direct");
});

// Run with: npm test (node's built-in test runner; Node strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanHelpLink, needWords, reasonWords, siteOf } from "./org-page-words.ts";

test("http becomes https, and a bare address gets https://", () => {
  assert.deepEqual(cleanHelpLink("http://example.org/drive"), { url: "https://example.org/drive", changed: true });
  assert.deepEqual(cleanHelpLink("example.org/drive"), { url: "https://example.org/drive", changed: true });
  assert.deepEqual(cleanHelpLink("https://example.org/drive"), { url: "https://example.org/drive", changed: false });
});

test("tracking and affiliate parts come off", () => {
  const { url } = cleanHelpLink("https://www.amazon.com/hz/wishlist/ls/EXAMPLE123/ref=nav_wishlist?tag=pto-20&ref_=abc&linkCode=xyz&utm_source=fb&affid=9&colid=7");
  assert.equal(url, "https://www.amazon.com/hz/wishlist/ls/EXAMPLE123?colid=7");
  assert.equal(cleanHelpLink("https://example.org/?ref=home").url, "https://example.org");
});

test("empty is fine; other schemes and odd hosts are refused", () => {
  assert.deepEqual(cleanHelpLink("  "), { url: null, changed: false });
  for (const bad of ["javascript:alert(1)", "ftp://example.org", "https://localhost/x", "https://user:pw@example.org", "https://1.2.3.4/x", "two words.com"]) {
    assert.ok(cleanHelpLink(bad).error, bad);
  }
});

test("the site shown is the host without www", () => {
  assert.equal(siteOf("https://www.amazon.com/hz/wishlist"), "amazon.com");
  assert.equal(siteOf("https://signup.example.org"), "signup.example.org");
});

test("every reason has words, and listed has none", () => {
  assert.equal(reasonWords(null), null);
  for (const r of ["teacher", "account_closed", "suspended", "kind", "page_off", "switched_off", "draft", "over", "fair_day", "later", "signup_closed", "full"] as const) {
    assert.ok(reasonWords(r));
  }
  assert.match(reasonWords("switched_off", { needsReview: true, you: false })!, /Account Host/);
});

test("need words", () => {
  assert.equal(needWords(2, 0), "2 spots open");
  assert.equal(needWords(1, 3), "1 spot open and 3 things still needed");
});

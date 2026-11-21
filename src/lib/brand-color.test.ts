// Run with: npm test. An account's color in dark mode reaches 4.5:1 on the card surface and the page, and the dark
// text on a brand button reaches 4.5:1 too (built-page review, 2026-11-21).
import assert from "node:assert/strict";
import { test } from "node:test";
import { brandThemeCss, contrast, darkForWhiteText, DARK_MODE, hexToRgb, lightForDarkBackground } from "./brand-color.ts";

const SAMPLES = ["#7a1f2b", "#0b3558", "#2d6a4f", "#000000", "#ffffff", "#ffd400", "#3355ff"];

for (const hex of SAMPLES) {
  test(`${hex} in dark mode reads at 4.5:1 on the card surface, the page, and under button text`, () => {
    const c = hexToRgb(lightForDarkBackground(hex));
    assert.ok(contrast(c, hexToRgb(DARK_MODE.surface)) >= 4.5, `card surface: ${contrast(c, hexToRgb(DARK_MODE.surface)).toFixed(2)}`);
    assert.ok(contrast(c, hexToRgb(DARK_MODE.background)) >= 4.5, "page");
    assert.ok(contrast(c, hexToRgb(DARK_MODE.foreground)) >= 4.5, "button text");
  });
  test(`${hex} in light mode takes white text at 4.5:1`, () => {
    assert.ok(contrast(hexToRgb(darkForWhiteText(hex)), [255, 255, 255]) >= 4.5);
  });
}

test("the theme CSS uses the checked dark color and dark button text", () => {
  const css = brandThemeCss(".x", "#7a1f2b");
  assert.match(css, new RegExp(`--brand:${lightForDarkBackground("#7a1f2b")};`));
  assert.match(css, new RegExp(`--brand-foreground:${DARK_MODE.foreground};`));
});

test("a color already light enough is left as it is", () => {
  assert.equal(lightForDarkBackground("#9cc3ee"), "#9cc3ee");
});

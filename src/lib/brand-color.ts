/**
 * An account's color (from its logo, or picked by the host), turned into the
 * colors a page needs: a band dark enough for white text, buttons and links
 * readable in light and dark mode, and pale tints. Pure math, so it runs on
 * the server (public pages) and in the browser (badges, the color picker).
 */

type RGB = [number, number, number];

export const isHexColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/.test(v);

export function hexToRgb(hex: string): RGB {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as RGB;
}

export function rgbToHex([r, g, b]: RGB) {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

function luminance([r, g, b]: RGB) {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: RGB, b: RGB) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
// The dark-mode page background (globals.css --background).
const DARK_BG: RGB = [6, 18, 31];
// The dark-mode card surface (globals.css --surface): the lighter of the two dark backgrounds, so the one to check.
const DARK_SURFACE: RGB = [12, 31, 51];
// Text on a dark-mode brand button (globals.css --brand-foreground).
const DARK_FOREGROUND = "#071a31";

/** Darken until white text on it has at least 4.5:1 contrast (the accessibility standard). */
export function darkForWhiteText(hex: string) {
  let c = hexToRgb(hex);
  for (let i = 0; i < 40 && contrast(c, WHITE) < 4.5; i++) c = mix(c, BLACK, 0.08);
  return rgbToHex(c);
}

/**
 * Lighten until it reads at 4.5:1 on both dark-mode backgrounds (links and buttons in dark mode): checked against
 * the card surface, the lighter of the two, so it holds on the page too. Dark button text on it then also reaches
 * 4.5:1 (checked, and lightened further if not).
 */
export function lightForDarkBackground(hex: string) {
  let c = hexToRgb(hex);
  const fg = hexToRgb(DARK_FOREGROUND);
  // Small steps, so the color stays as close to the account's own as it can.
  for (let i = 0; i < 80 && (contrast(c, DARK_SURFACE) < 4.5 || contrast(c, DARK_BG) < 4.5 || contrast(c, fg) < 4.5); i++) c = mix(c, WHITE, 0.04);
  // Rounding to a hex color can land a hair under the line: one more step if it did.
  const hexed = hexToRgb(rgbToHex(c));
  if (contrast(hexed, DARK_SURFACE) < 4.5 || contrast(hexed, fg) < 4.5) c = mix(c, WHITE, 0.04);
  return rgbToHex(c);
}

/** The dark-mode colors a page's brand needs, exported for the unit tests. */
export const DARK_MODE = { background: rgbToHex(DARK_BG), surface: rgbToHex(DARK_SURFACE), foreground: DARK_FOREGROUND };

/**
 * CSS that re-colors a page section with the account's color: the site's
 * brand colors (buttons, links, highlights) plus --band for the colored
 * header band. Status colors (green, amber, red) are left alone so they keep
 * their meaning.
 */
export function brandThemeCss(selector: string, hex: string) {
  const band = darkForWhiteText(hex);
  const bandRgb = hexToRgb(band);
  const light = {
    "--brand": band,
    "--brand-hover": rgbToHex(mix(bandRgb, BLACK, 0.2)),
    "--brand-foreground": "#ffffff",
    "--brand-soft": rgbToHex(mix(bandRgb, WHITE, 0.9)),
    "--band": band,
  };
  const darkBrand = lightForDarkBackground(hex);
  const dark = {
    "--brand": darkBrand,
    "--brand-hover": rgbToHex(mix(hexToRgb(darkBrand), WHITE, 0.15)),
    "--brand-foreground": DARK_FOREGROUND,
    "--brand-soft": rgbToHex(mix(bandRgb, DARK_BG, 0.75)),
    "--band": band,
  };
  const block = (vars: Record<string, string>) =>
    Object.entries(vars)
      .map(([k, v]) => `${k}:${v};`)
      .join("");
  return `${selector}{${block(light)}}@media (prefers-color-scheme: dark){${selector}{${block(dark)}}}`;
}

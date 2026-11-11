#!/usr/bin/env node
// Design lessons that a computer can check (docs/design-lessons.md, the ones marked "Checked
// automatically"). Runs with `npm run lint`.
//
// It works as a ratchet: scripts/design-lint-baseline.json records how many of each problem a
// file had when a rule was added. A file may go down, never up, so old pages get no worse and new
// code starts clean. After fixing old problems, run `node scripts/design-lint.mjs --update` to
// lower the baseline.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BASELINE = join(ROOT, "scripts/design-lint-baseline.json");

/** Each rule: the lesson it checks, a pattern, and what to do instead. */
const RULES = [
  {
    id: "emoji",
    lesson: "L14 Line icons, not emoji",
    // Pictographs, plus the warning sign, stopwatch, and coffee cup. Plain marks like ✓ ↗ ☰ ◆ are text.
    pattern: /[\u{1F300}-\u{1FAFF}\u{26A0}\u{23F1}\u{2615}\u{2728}]/gu,
    fix: 'Use <LineIcon name="…" /> from src/components/line-icon.tsx.',
  },
  {
    id: "number-input",
    lesson: "CLAUDE.md: number fields use NumberInput",
    pattern: /type=["']number["']/g,
    fix: "Use NumberInput (src/components/number-input.tsx).",
  },
  {
    id: "date-time-input",
    lesson: "CLAUDE.md: date and time fields use DateField and TimeField (#347)",
    pattern: /type=["'](?:date|time|datetime-local)["']/g,
    fix: "Use DateField (src/components/date-field.tsx) or TimeField (src/components/time-field.tsx).",
  },
  {
    id: "muted-disabled",
    lesson: "L6 Greyed out must look greyed out in dark mode",
    // A greyed-out control coloured with text-muted: muted is white in dark mode, so it looks live.
    pattern: /className=(?:"[^"]*|\{`[^`]*)(?:cursor-not-allowed|aria-disabled)[^"`]*\btext-muted\b|className=(?:"[^"]*|\{`[^`]*)\btext-muted\b[^"`]*cursor-not-allowed/g,
    fix: "Use text-disabled for greyed-out controls.",
  },
  {
    id: "white-on-danger",
    lesson: "L6 Dark mode: text on red",
    // White text on the red fill fails contrast in dark mode (the red turns light).
    pattern: /bg-danger\b[^"`]*\btext-white\b|\btext-white\b[^"`]*bg-danger\b/g,
    fix: "Use text-danger-foreground on bg-danger.",
  },
  {
    id: "small-control",
    lesson: "L12 Phone basics: 44 px tap targets, 14 px words",
    // Buttons and links drawn under 44 px tall with 12 px words.
    pattern: /\bmin-h-(?:8|9)\b[^"`]*\btext-xs\b|\btext-xs\b[^"`]*\bmin-h-(?:8|9)\b/g,
    fix: "Use min-h-11 and text-sm (DESIGN.md, Buttons and delete).",
  },
  {
    id: "faded-container",
    lesson: "L7 Don't fade things people can still use",
    // A whole block faded with opacity (not a disabled control, not an animation state).
    pattern: /(?<![:\w-])opacity-(?:40|50|60|70)\b/g,
    fix: "Keep it full strength and add a word (like \"Ended\"); fade only disabled controls (disabled:opacity-…).",
  },
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(tsx|ts)$/.test(name)) yield path;
  }
}

const counts = {};
for (const path of files(join(ROOT, "src"))) {
  const text = readFileSync(path, "utf8");
  const rel = relative(ROOT, path);
  for (const rule of RULES) {
    const n = (text.match(rule.pattern) ?? []).length;
    if (n) (counts[rule.id] ??= {})[rel] = n;
  }
}

if (process.argv.includes("--update")) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + "\n");
  console.log("design-lint: baseline updated.");
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
let failed = 0;
for (const rule of RULES) {
  for (const [file, n] of Object.entries(counts[rule.id] ?? {})) {
    const allowed = baseline[rule.id]?.[file] ?? 0;
    if (n > allowed) {
      failed++;
      console.error(`${file}: ${n - allowed} new "${rule.id}" (${rule.lesson}). ${rule.fix}`);
    }
  }
}
if (failed) {
  console.error(`\ndesign-lint: ${failed} problem(s). See docs/design-lessons.md.`);
  process.exit(1);
}
console.log("design-lint: no new problems.");

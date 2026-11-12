#!/usr/bin/env node
// Sponsors show only on the main public event page (docs/design-decisions/2026-11-12-sponsors.md): never on
// sign-up, registration, directors' or parents' pages, the /e/[slug] layout or shared headers, or in emails.
// Runs with `npm run lint`:
//   1. In src/app/e, only the main page, its sponsor parts, and the logo route may use sponsor code.
//   2. No email builder (src/lib/*email*, and anything importing nodemailer or @/lib/email) imports sponsor code,
//      or reaches the sponsor loaders or public parts through its imports (the daily job's cleanup may use the
//      shared rules in src/lib/sponsors.ts).
// With --live <base url> <slug> it also fetches the event's other public pages and checks they have no
// sponsor markup (cookies for a QA gate in SPONSOR_SCOPE_COOKIE). Run it against an event with sponsors showing.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
/** Sponsor code: the shared rules, the loaders, the logo pipeline, and the public page's parts. */
const SPONSOR = [/src\/lib\/sponsors\.ts$/, /src\/lib\/sponsors-data\.ts$/, /src\/lib\/sponsor-logos\.ts$/, /src\/app\/e\/\[slug\]\/public-sponsors\.tsx$/, /sponsor-actions\.ts$/];
/** The only files in src/app/e allowed to use it. */
const ALLOWED_IN_E = new Set(["src/app/e/[slug]/page.tsx", "src/app/e/[slug]/public-sponsors.tsx", "src/app/e/[slug]/sponsor-logo/[sponsorId]/[version]/[file]/route.ts"]);
/** Shared by every public event page: never sponsor code. */
const SHARED = ["src/components/event-brand.tsx", "src/components/public-nav.tsx", "src/lib/event-brand.ts"];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(tsx|ts|mts)$/.test(name)) yield path;
  }
}

const importsOf = (file) =>
  [...readFileSync(file, "utf8").matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

function resolve(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(from), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext;
  return null;
}

const isSponsor = (file) => SPONSOR.some((re) => re.test(file));
/** Where sponsors' names and logos come from: the loaders, the actions, and the public page's parts. */
const isSponsorData = (file) => isSponsor(file) && !/src\/lib\/sponsors\.ts$/.test(file);
/** The first chain of imports from `file` that reaches sponsor code (by `match`), or null. */
function reachesSponsor(file, match = isSponsor, seen = new Set(), chain = []) {
  if (seen.has(file)) return null;
  seen.add(file);
  for (const spec of importsOf(file)) {
    const next = resolve(file, spec);
    if (!next) continue;
    const path = [...chain, relative(ROOT, next)];
    if (match(next)) return path;
    const deeper = reachesSponsor(next, match, seen, path);
    if (deeper) return deeper;
  }
  return null;
}

const problems = [];
const all = [...files(SRC)];

// 1. The public event pages.
for (const file of all) {
  const rel = relative(ROOT, file);
  const scoped = (rel.startsWith("src/app/e/") && !ALLOWED_IN_E.has(rel)) || SHARED.includes(rel);
  if (!scoped || isSponsor(file)) continue;
  const chain = reachesSponsor(file);
  if (chain) problems.push(`${rel} reaches sponsor code (${chain.join(" → ")}). Sponsors load only in src/app/e/[slug]/page.tsx.`);
}

// 2. Email builders.
for (const file of all) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, "utf8");
  const builder = /src\/lib\/[^/]*email[^/]*\.ts$/.test(rel) || /from\s+["'](nodemailer|@\/lib\/email)["']/.test(text);
  if (!builder || isSponsor(file)) continue;
  const direct = importsOf(file).map((spec) => resolve(file, spec)).find((f) => f && isSponsor(f));
  const chain = direct ? [relative(ROOT, direct)] : reachesSponsor(file, isSponsorData);
  if (chain) problems.push(`${rel} sends or builds email and reaches sponsor code (${chain.join(" → ")}). Sponsors never show in emails.`);
}

// 3. Optional: the live pages.
const live = process.argv.indexOf("--live");
if (live !== -1) {
  const [base, slug] = process.argv.slice(live + 1);
  if (!base || !slug) {
    console.error("Usage: node scripts/sponsor-scope.mjs --live <base url> <slug>");
    process.exit(2);
  }
  const headers = process.env.SPONSOR_SCOPE_COOKIE ? { cookie: process.env.SPONSOR_SCOPE_COOKIE } : {};
  const MARKERS = [/Presented by/, /Thank you to our sponsors/, /Today(?:&#x27;|')s sponsors/, /\/sponsor-logo\//, /rel="sponsored/];
  const main = await fetch(`${base}/e/${slug}`, { headers }).then((r) => r.text());
  if (!MARKERS.some((m) => m.test(main))) problems.push(`/e/${slug} shows no sponsors, so the other pages can't be checked against it. Use an event with sponsors showing.`);
  for (const sub of ["volunteer", "register", "register/done", "bands", "bands/confirm", "bands/invite/not-a-real-token", "parents", "book"]) {
    // Pages an event doesn't have send people to the main page: that's the main page, not a leak.
    const res = await fetch(`${base}/e/${slug}/${sub}`, { headers, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      console.log(`${res.status} /e/${slug}/${sub} goes to ${new URL(res.headers.get("location") ?? "", base).pathname}`);
      continue;
    }
    const html = await res.text();
    const hit = MARKERS.find((m) => m.test(html));
    console.log(`${res.status} /e/${slug}/${sub}${hit ? ` has sponsor markup (${hit})` : " has no sponsor markup"}`);
    if (hit) problems.push(`/e/${slug}/${sub} has sponsor markup (${hit}).`);
  }
}

if (problems.length) {
  console.error(`Sponsor scope check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("Sponsor scope check passed: sponsors only on the main public event page, and never in emails.");

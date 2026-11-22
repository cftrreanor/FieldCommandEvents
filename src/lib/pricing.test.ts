// Run with: npm test (node's built-in test runner; Node strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bestFor,
  cardContents,
  checkPricingRequest,
  cheapestChoices,
  kindLabel,
  kindWords,
  packageFeatures,
  packagesThatFit,
  passLabel,
  passWords,
  plusIsEmpty,
  plusLines,
  stacksOn,
  type PricingFree,
  type PricingPackage,
  type PricingPass,
} from "./pricing.ts";

// Packages shaped like the owner's admin (2026-11-22), with made-up prices where it helps.
const pkg = (p: Partial<PricingPackage> & { code: string }): PricingPackage => ({
  name: p.code,
  kind: "package",
  event_types: [],
  one_at_a_time: [],
  weekly_hours: false,
  max_team: 2,
  event_staff: false,
  volunteer_history: false,
  price_year_cents: null,
  teacher_rate: false,
  teacher_year_cents: null,
  best_for: null,
  recommended: false,
  sort: 0,
  ...p,
});
const schedule = pkg({ code: "schedule", name: "Schedule Command", event_types: ["volunteer", "meeting"], one_at_a_time: ["volunteer"], weekly_hours: true, price_year_cents: 6000, sort: 20 });
const volunteer = pkg({ code: "volunteer", name: "Volunteer Command", event_types: ["volunteer", "fair", "meeting"], weekly_hours: true, max_team: 5, event_staff: true, volunteer_history: true, price_year_cents: 24000, sort: 30 });
const event = pkg({ code: "event", name: "Event Command", event_types: ["band_contest", "group_event", "volunteer", "school_visit", "fair", "conference", "meeting"], weekly_hours: true, max_team: null, event_staff: true, volunteer_history: true, price_year_cents: 100000, sort: 40 });
const competition = pkg({ code: "district", name: "Competition Command", event_types: ["band_contest", "group_event", "volunteer", "meeting"], weekly_hours: true, max_team: null, event_staff: true, volunteer_history: true, price_year_cents: 250000, sort: 50 });
const free: PricingFree = { code: "free", name: "Free", kind: "package", event_types: ["volunteer", "meeting"], one_at_a_time: ["volunteer", "meeting"], weekly_hours: false, max_team: 2, event_staff: false, volunteer_history: false, sort: 10 };
const pass = (type: string, cents: number): PricingPass => ({ code: `pass_${type}`, name: type, kind: "pass", event_type: type, price_cents: cents, sort: 100 });
const passes = [pass("school_visit", 5000), pass("volunteer", 7500), pass("fair", 10000), pass("group_event", 12500), pass("band_contest", 15000)];
const page = { packages: [schedule, volunteer, event, competition], passes, free: [free] };

test("kinds use the website's names: labels, words in a sentence, and pass names", () => {
  assert.equal(kindLabel("school_visit"), "Visitor registration and check-in");
  assert.equal(kindWords("group_event"), "choir, orchestra, and group festivals");
  assert.equal(kindWords("conference"), "parent-teacher conferences");
  assert.equal(passWords("band_contest"), "band contest pass");
  assert.equal(passLabel("school_visit"), "Visitor registration and check-in pass");
  assert.equal(kindWords("rodeo"), "rodeo", "an unknown kind stays as it is");
});

test("packageFeatures names each part, from the fields, in the website's order", () => {
  const f = packageFeatures(volunteer);
  assert.deepEqual(f.kinds.map((k) => k.value), ["volunteer", "fair", "meeting"]);
  assert.equal(f.team, "A team of up to 5 people");
  assert.equal(f.staff, "Volunteer Leads and Coordinators");
  assert.equal(f.tracking, "Volunteer tracking");
  assert.equal(f.weeklyHours, "Weekly hours for meetings", "weekly hours name only the kinds the package has");
  assert.equal(f.allKinds, false);

  const s = packageFeatures(schedule);
  assert.equal(s.team, "A team of 2: you and one helper");
  assert.equal(s.staff, null);
  assert.equal(s.tracking, null);
  assert.deepEqual(s.oneAtATime, ["volunteer"]);
  assert.deepEqual(s.kinds.find((k) => k.value === "volunteer"), { value: "volunteer", label: "Volunteers and sign-ups", one: true });

  const e = packageFeatures(event);
  assert.equal(e.allKinds, true);
  assert.equal(e.team, "A team of any size");
  assert.equal(e.weeklyHours, "Weekly hours for parent-teacher conferences and meetings");

  const noStaff = packageFeatures({ ...event, event_staff: false });
  assert.equal(noStaff.team, "A team of any size");
  assert.equal(noStaff.staff, null, "an unlimited team never claims Volunteer Leads and Coordinators without them");
  assert.equal(packageFeatures({ ...schedule, weekly_hours: true, event_types: ["volunteer"] }).weeklyHours, null, "no weekly hours without a kind booked by the hour");
});

test("bestFor: as written in admin, else from the kinds", () => {
  assert.deepEqual(bestFor({ ...schedule, best_for: "  Teachers who run sign-ups " }), { text: "Teachers who run sign-ups", from: "admin" });
  assert.deepEqual(bestFor(volunteer), { text: "Groups that run volunteers and sign-ups, school fairs and fundraisers, and meetings", from: "generated" });
  assert.deepEqual(bestFor(event), { text: "Groups that run every kind of event", from: "generated" });
});

test("stacksOn: only when the package includes everything the one before does", () => {
  assert.equal(stacksOn(volunteer, schedule), true, "Volunteer Command frees volunteer events and adds more");
  assert.equal(stacksOn(event, volunteer), true);
  assert.equal(stacksOn(competition, event), false, "Competition Command leaves out kinds Event Command has");
  assert.equal(stacksOn(schedule, volunteer), false);
  assert.equal(stacksOn({ ...volunteer, one_at_a_time: ["volunteer"] }, { ...volunteer }), false, "turning a kind one at a time doesn't stack");
  assert.equal(stacksOn({ ...volunteer, max_team: 3 }, volunteer), false, "a smaller team doesn't stack");
  assert.equal(stacksOn({ ...event, max_team: 50 }, event), false, "a limit doesn't stack on unlimited");
});

test("plusLines: only what's added, and 'plus' only when there's something to list", () => {
  const p = plusLines(volunteer, schedule);
  assert.deepEqual(p.kinds.map((k) => [k.value, k.note ?? ""]), [["fair", ""], ["volunteer", "As many at a time as you like"]], "added kinds, then freed ones");
  assert.equal(p.team, "A team of up to 5 people");
  assert.equal(p.staff, "Volunteer Leads and Coordinators");
  assert.equal(p.tracking, "Volunteer tracking");
  assert.equal(p.weeklyHours, null, "both have weekly hours for meetings");

  const copy = { ...volunteer, code: "copy", name: "Booster Command" };
  assert.equal(plusIsEmpty(plusLines(copy, volunteer)), true);
  assert.deepEqual(cardContents(copy, volunteer).plusOf, null, "a copied package lists everything, never an empty 'plus'");
  assert.equal(cardContents(volunteer, schedule).plusOf, "Schedule Command");
  assert.equal(cardContents(competition, event).plusOf, null);
  assert.equal(cardContents(schedule).plusOf, null, "the first card lists everything");
  const ev = plusLines(event, volunteer);
  assert.equal(ev.weeklyHours, "Weekly hours for parent-teacher conferences and meetings", "weekly hours for more kinds is an addition");
  assert.equal(ev.team, "A team of any size");
});

test("cheapestChoices: a package plus passes only for the picked kinds it doesn't include", () => {
  const c = cheapestChoices(["volunteer", "school_visit"], page);
  assert.deepEqual(c[0], {
    package: { code: "free", name: "Free", price_year_cents: 0 },
    passes: [{ code: "pass_school_visit", event_type: "school_visit", price_cents: 5000 }],
    total_cents: 5000,
  });
  const vc = c.find((x) => x.package.code === "volunteer")!;
  assert.deepEqual(vc.passes.map((p) => p.event_type), ["school_visit"], "no pass for volunteer events, which the package includes");
  assert.equal(vc.total_cents, 29000);
  assert.ok(c.every((x, i) => i === 0 || c[i - 1].total_cents <= x.total_cents), "cheapest first");

  const band = cheapestChoices(["band_contest", "conference"], page);
  assert.equal(band[0].package.code, "event", "no conference pass, so only Event Command covers conferences");
  assert.equal(band.length, 1);

  const noYearly = cheapestChoices(["conference"], { ...page, packages: [{ ...event, price_year_cents: null }] });
  assert.deepEqual(noYearly, [], "a package without a yearly price isn't a priced choice");
  assert.deepEqual(cheapestChoices([], page), []);
  assert.deepEqual(packagesThatFit(["fair", "meeting"], page.packages).map((p) => p.code), ["volunteer", "event"]);
});

test("checkPricingRequest checks every answer at once", () => {
  const bad = new FormData();
  bad.set("name", "B");
  bad.set("email", "nope");
  bad.set("organization", "");
  bad.set("plan", "DROP TABLE");
  const r1 = checkPricingRequest(bad);
  assert.equal(r1.request, undefined);
  assert.deepEqual(Object.keys(r1.fieldErrors).sort(), ["email", "name", "organization", "plan"]);

  const ok = new FormData();
  ok.set("name", " Jordan Reyes ");
  ok.set("email", "Jordan.Reyes@Example.org");
  ok.set("organization", "Westfield Middle School PTO");
  ok.append("eventTypes", "school_visit");
  ok.append("eventTypes", "volunteer");
  ok.append("eventTypes", "rodeo");
  ok.set("plan", "pass_school_visit");
  ok.set("payByInvoice", "1");
  ok.set("organizationId", "not-a-uuid");
  const r2 = checkPricingRequest(ok);
  assert.deepEqual(r2.request, {
    name: "Jordan Reyes",
    email: "jordan.reyes@example.org",
    organization: "Westfield Middle School PTO",
    eventTypes: ["volunteer", "school_visit"],
    plan: "pass_school_visit",
    teacherRate: false,
    payByInvoice: true,
    message: "",
    organizationId: null,
  });
});

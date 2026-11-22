// Run with: npm test (node's built-in test runner; Node strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { includedLines, type AccountPlan } from "./plan.ts";

const plan = (p: Partial<AccountPlan>): AccountPlan => ({
  package: "event",
  package_name: "Event Command",
  active: "event",
  active_name: "Event Command",
  rate: "standard",
  event_types: ["volunteer"],
  own_event_types: ["volunteer"],
  one_at_a_time: [],
  weekly_hours: true,
  max_team: null,
  event_staff: true,
  volunteer_history: true,
  volunteer_tracking: true,
  team: 1,
  published: {},
  passes_unused: {},
  pass_total_cents: 0,
  ...p,
});
const teamLine = (p: AccountPlan) => includedLines(p).find((l) => l.startsWith("A team"));

test("includedLines: Volunteer Leads and Coordinators only when the package includes them", () => {
  assert.equal(teamLine(plan({})), "A team of any size, including Volunteer Leads and Coordinators");
  assert.equal(teamLine(plan({ event_staff: false })), "A team of any size", "an unlimited team without event staff doesn't claim them");
  assert.equal(teamLine(plan({ max_team: 5 })), "A team of up to 5 people, including Volunteer Leads and Coordinators");
  assert.equal(teamLine(plan({ max_team: 2, event_staff: false })), "A team of up to 2 people (a host and a co-host)");
});

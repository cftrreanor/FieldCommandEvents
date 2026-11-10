// Packages and event passes (20261223000000_packages.sql). The database holds the
// limits (plan_tiers) and enforces them; this file loads an account's plan
// summary (account_plan) and says it in plain words.

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate, utcToZonedDate } from "@/lib/time";

export const PACKAGES = [
  { value: "free_teacher", label: "Free Teacher" },
  { value: "free", label: "Free" },
  { value: "schedule", label: "Schedule Command" },
  { value: "volunteer", label: "Volunteer Command" },
  { value: "event", label: "Event Command" },
  { value: "district", label: "District Command" },
] as const;
export type PackageCode = (typeof PACKAGES)[number]["value"];
export const isPackage = (v: unknown): v is PackageCode => PACKAGES.some((p) => p.value === v);
/** The package's name: as stored (names from tierNames(), when given), else its original name. */
export const packageLabel = (code: string, names?: Record<string, string>) => names?.[code] ?? PACKAGES.find((p) => p.value === code)?.label ?? code;
/** Free and Free Teacher: no plan needed, and not a package to upgrade to. */
export const isFreePackage = (code: string) => code === "free" || code === "free_teacher";

/** What the account pays at. It changes no features. */
export const RATES = [
  { value: "standard", label: "Standard rate" },
  { value: "teacher", label: "Teacher rate" },
] as const;
export const isRate = (v: unknown): v is "standard" | "teacher" => RATES.some((r) => r.value === v);
export const rateLabel = (code: string) => RATES.find((r) => r.value === code)?.label ?? code;

/** One-time passes: one published event of a type the package doesn't include. List prices match plan_tiers. */
export const PASSES = [
  { type: "school_visit", label: "School visitor day", cents: 5000 },
  { type: "volunteer", label: "Volunteers and sign-ups", cents: 7500 },
  { type: "fair", label: "School fair", cents: 10000 },
  { type: "group_event", label: "Group event", cents: 12500 },
  { type: "band_contest", label: "Band contest", cents: 15000 },
] as const;
export const passFor = (type: string) => PASSES.find((p) => p.type === type);

/** Each kind of event, in the words used in plan messages (event_type_words in the database). */
const TYPE_WORDS: Record<string, string> = {
  conference: "parent-teacher conferences",
  meeting: "meetings",
  volunteer: "volunteer events",
  school_visit: "school visitor events",
  fair: "school fairs",
  group_event: "group events",
  band_contest: "band contests",
};
export const typeWords = (type: string) => TYPE_WORDS[type] ?? type;
const TYPE_ORDER = Object.keys(TYPE_WORDS);

export const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;

/** account_plan(): what the account's package includes and what it's using. */
export type AccountPlan = {
  package: string;
  package_name: string;
  /** The package it publishes under now: Free while a paid package's plan isn't active. */
  active: string;
  active_name: string;
  rate: string;
  event_types: string[];
  own_event_types: string[];
  one_at_a_time: string[];
  weekly_hours: boolean;
  /** Null is unlimited. */
  max_team: number | null;
  event_staff: boolean;
  volunteer_history: boolean;
  /** The Volunteer tracking page shows: the package includes it, or it did before a downgrade and there's history. */
  volunteer_tracking: boolean;
  team: number;
  published: Record<string, number>;
  passes_unused: Record<string, number>;
  pass_total_cents: number;
};

/** The account's plan, or null before the database update (or for someone who can't see it). */
export async function loadAccountPlan(supabase: SupabaseClient, orgId: string): Promise<AccountPlan | null> {
  const { data, error } = await supabase.rpc("account_plan", { p_org: orgId });
  if (error) {
    if (error.code !== "42501") console.error("account_plan failed", error.message);
    return null;
  }
  return data as AccountPlan;
}

/** Event types it can start: its package's own, plus any it holds an unused pass for. */
export function startableTypes(plan: AccountPlan): string[] {
  const unused = Object.entries(plan.passes_unused)
    .filter(([, n]) => n > 0)
    .map(([t]) => t);
  return [...new Set([...plan.own_event_types, ...unused])];
}

/** The plan's package has lapsed: it publishes under Free until it's renewed. */
export const planEnded = (plan: AccountPlan) => plan.active !== plan.package;

/**
 * What ended, in one sentence used everywhere (the My events notice and the
 * type picker): a free pilot or trial that's over, or a paid plan that lapsed.
 * Null when nothing has ended, or for the Free package (nothing changes for it).
 */
export function endedSentence(
  plan: AccountPlan | null,
  free: { ended: boolean; day: string } | null,
  status: string,
): string | null {
  if (plan && isFreePackage(plan.package)) return null;
  if (free?.ended) return `Your free ${status === "trialing" ? "trial" : "pilot"} ended ${free.day}`;
  if (!free && plan && planEnded(plan)) return `Your ${plan.package_name} plan has ended`;
  return null;
}

/**
 * How the type picker groups the kinds: with an active plan, a label over the
 * plan's own kinds ("Included in your … plan"); after a plan ends, what ended
 * (the kinds are then grouped by what can be published now). Empty when the plan
 * includes every kind.
 */
export function pickerGroups(plan: AccountPlan | null, included: string[] | undefined, ended: string | null): { label?: string; ended?: string } {
  if (!plan || !included || included.length >= TYPE_ORDER.length) return {};
  return ended && planEnded(plan) ? { ended: `${ended}. You can still set up any kind of event.` } : { label: `Included in your ${plan.package_name} plan` };
}

type PublishedEvent = { id?: string; name: string; event_type: string | null; status: string; starts_on: string; ends_on: string; timezone: string };

/** A note on a type card: a plain fact (info), something to know before starting (warn), or a go-ahead (ok). */
export type TypeNote = { text: string; tone: "info" | "warn" | "ok" };

/**
 * For a "one at a time" type, the published event that hasn't ended yet, picked
 * the way the database picks it (org_publish_reason: earliest start). Only this
 * account's events should be passed in.
 */
export function holdingEvent<E extends PublishedEvent>(type: string, events: E[]): E | undefined {
  return events
    .filter((e) => e.event_type === type && e.status === "published" && e.ends_on >= utcToZonedDate(new Date().toISOString(), e.timezone))
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0];
}

const shortDate = (d: string) => formatDate(d, { weekday: undefined, year: undefined });

/**
 * A short note per event type for the type picker: "Publishing needs a plan"
 * for the package's own types while it has lapsed, and for "one at a time"
 * types, the event that's published until it ends (finished ones don't count),
 * or that one can be published now. The database has the last word when they publish.
 */
export function typeNotes(plan: AccountPlan, events: PublishedEvent[]): Record<string, TypeNote> {
  const notes: Record<string, TypeNote> = {};
  if (planEnded(plan)) for (const t of plan.own_event_types) if (!plan.event_types.includes(t)) notes[t] = { text: "Publishing needs a plan", tone: "warn" };
  for (const t of plan.one_at_a_time) {
    if (!plan.event_types.includes(t)) continue;
    const live = holdingEvent(t, events);
    notes[t] = live
      ? { text: `${live.name} runs through ${shortDate(live.ends_on)}. You can publish another after that.`, tone: "info" }
      : planEnded(plan)
        ? { text: "You can publish one now", tone: "ok" }
        : notes[t];
    if (!notes[t]) delete notes[t];
  }
  return notes;
}

/** For the plan-ended notice: the conference holding the one free spot, in a sentence (or null). */
export function spotTaken(plan: AccountPlan, events: PublishedEvent[]): string | null {
  const live = plan.one_at_a_time.includes("conference") ? holdingEvent("conference", events) : undefined;
  return live ? `${live.name} runs through ${shortDate(live.ends_on)}, so you can publish another after that.` : null;
}

const sortTypes = (types: string[]) => [...types].sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b));

/** "a, b, and c" */
export function listWords(words: string[]) {
  if (words.length <= 2) return words.join(" and ");
  return `${words.slice(0, -1).join(", ")}, and ${words.at(-1)}`;
}

/** What the package includes, in plain words, one line each. */
export function includedLines(plan: AccountPlan): string[] {
  const all = plan.own_event_types.length >= TYPE_ORDER.length;
  const lines = [
    all ? "Every kind of event" : capitalize(listWords(sortTypes(plan.own_event_types).map(typeWords))),
    ...sortTypes(plan.one_at_a_time).map((t) => `One published ${typeWords(t).replace(/s$/, "")} at a time, with as many drafts as you like`),
    plan.weekly_hours ? "Weekly hours for conferences and meetings" : "Conferences and meetings on set days (weekly hours aren't included)",
    plan.max_team === null
      ? "A team of any size, including Volunteer Leads and Coordinators"
      : `A team of up to ${plan.max_team} people${plan.max_team === 2 ? " (a host and a co-host)" : ""}${plan.event_staff ? ", including Volunteer Leads and Coordinators" : ""}`,
    plan.volunteer_history ? "Volunteer tracking across your events" : "Volunteer tracking isn't included",
  ];
  return lines;
}

/** Usage against the limits: "Volunteer events published: 1 of 1", "Team: 2 of 2". */
export function usageLines(plan: AccountPlan): string[] {
  const lines = sortTypes(plan.one_at_a_time).map((t) => `${capitalize(typeWords(t))} published: ${plan.published[t] ?? 0} of 1`);
  lines.push(plan.max_team === null ? `Team: ${plan.team}` : `Team: ${plan.team} of ${plan.max_team}`);
  for (const t of sortTypes(Object.keys(plan.passes_unused))) {
    const n = plan.passes_unused[t];
    if (n > 0) lines.push(`Unused ${passFor(t)?.label.toLowerCase() ?? typeWords(t)} pass${n === 1 ? "" : "es"}: ${n}`);
  }
  return lines;
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The Account Host: the person who can get or renew a plan (account_host, for the
 * account's own hosts). `unknown` when it couldn't be looked up and the viewer's own
 * role isn't known either: then both ways forward are shown.
 */
export type AccountHost = { isMe: boolean; name: string; email: string | null; unknown?: boolean };

export async function loadAccountHost(supabase: SupabaseClient, orgId: string, userId: string): Promise<AccountHost> {
  const { data, error } = await supabase.rpc("account_host", { p_org: orgId }).maybeSingle<{ user_id: string; name: string; email: string | null }>();
  if (!error && data) return { isMe: data.user_id === userId, name: data.name, email: data.email };
  // Couldn't look it up (or before the database update): the viewer's own role still says whether they're the Account Host.
  const { data: me } = await supabase.from("organization_members").select("role").eq("organization_id", orgId).eq("user_id", userId).maybeSingle();
  if (me?.role === "owner") return { isMe: true, name: "", email: null };
  return { isMe: false, name: "your Account Host", email: null, unknown: !me };
}

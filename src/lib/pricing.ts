// The public pricing page's shared logic (docs/design-decisions/2026-11-22-pricing-page.md): what
// pricing_page() returns (20270211000000_pricing_page.sql), what each package includes in named parts, whether a
// card can say "Everything in X, plus", the cheapest package-and-pass choices for the kinds of event someone runs,
// the website's names for each kind, and the pricing request form's checks. Safe in client components; only
// relative imports, so `npm test` runs it directly.

import type { SupabaseClient } from "@supabase/supabase-js";
import { PILOT_EVENT_TYPES } from "./pilot.ts";
import { isFreePackage, listWords } from "./plan.ts";

// ---------------------------------------------------------------------------------------------------------------
// What pricing_page() returns
// ---------------------------------------------------------------------------------------------------------------

/** What every package says it includes (cards, Free lines, and the compare table read the same fields). */
export type PackageContents = {
  code: string;
  name: string;
  event_types: string[];
  one_at_a_time: string[];
  weekly_hours: boolean;
  /** Null is unlimited. */
  max_team: number | null;
  event_staff: boolean;
  volunteer_history: boolean;
};

/** A package card: shown on the website, not retired, not Free or Free Teacher, with at least one kind of event. */
export type PricingPackage = PackageContents & {
  kind: "package";
  /** Null: no yearly price set, so the card says "Ask us". Monthly prices are never public. */
  price_year_cents: number | null;
  teacher_rate: boolean;
  /** Only where teacher_rate; null otherwise or when not set. */
  teacher_year_cents: number | null;
  /** Written in admin; null means generate one (bestFor()). */
  best_for: string | null;
  recommended: boolean;
  sort: number;
};

export type PricingPass = { code: string; name: string; kind: "pass"; event_type: string; price_cents: number; sort: number };

/** Free and Free Teacher: one line each, never a card, never a price. */
export type PricingFree = PackageContents & { kind: "package"; sort: number };

export type PricingPage = {
  /** False only in an admin's preview of the hidden page. */
  live: boolean;
  packages: PricingPackage[];
  passes: PricingPass[];
  free: PricingFree[];
};

/**
 * The pricing page's data. `hidden`: not switched on (visitors get a 404; admins always get `ok`, with live false).
 * `missing`: the database update hasn't run (call missing()). `error`: couldn't read it ("Prices didn't load").
 */
export type PricingLoad = { status: "ok"; page: PricingPage } | { status: "hidden" } | { status: "missing" } | { status: "error" };

const SCHEMA_CODES = new Set(["42703", "42883", "42P01", "PGRST202", "PGRST204", "PGRST205"]);

export async function loadPricingPage(supabase: SupabaseClient): Promise<PricingLoad> {
  const { data, error } = await supabase.rpc("pricing_page");
  if (error) {
    if (error.code && SCHEMA_CODES.has(error.code)) return { status: "missing" };
    console.error("pricing_page failed", error.message);
    return { status: "error" };
  }
  return data ? { status: "ok", page: data as PricingPage } : { status: "hidden" };
}

// ---------------------------------------------------------------------------------------------------------------
// The website's names for each kind of event
// ---------------------------------------------------------------------------------------------------------------

/** The kinds, in the website's words and order (the home page cards and the pilot form). */
export const WEBSITE_KINDS = PILOT_EVENT_TYPES.filter((k) => k.value !== "other");
const kindIndex = (t: string) => {
  const i = WEBSITE_KINDS.findIndex((k) => k.value === t);
  return i < 0 ? WEBSITE_KINDS.length : i;
};
/** Kinds in the website's order. */
export const sortKinds = (types: readonly string[]) => [...types].sort((a, b) => kindIndex(a) - kindIndex(b));

/** "Band contests", as a label or chip. */
export const kindLabel = (t: string) => WEBSITE_KINDS.find((k) => k.value === t)?.label ?? t;
/** "band contests", inside a sentence (the label lowercased, as the Content review asked). */
export const kindWords = (t: string) => {
  const label = kindLabel(t);
  return label === t ? t : label[0].toLowerCase() + label.slice(1);
};

// One event of a kind, for naming a pass: "a band contest pass", "Get a band contest pass".
const ONE_KIND: Record<string, string> = {
  volunteer: "volunteers and sign-ups",
  band_contest: "band contest",
  group_event: "choir, orchestra, or group festival",
  fair: "school fair or fundraiser",
  school_visit: "visitor registration and check-in",
  conference: "parent-teacher conference",
  meeting: "meeting",
};
/** "band contest pass", inside a sentence. */
export const passWords = (t: string) => `${ONE_KIND[t] ?? kindWords(t)} pass`;
/** "Band contest pass", as a label. */
export const passLabel = (t: string) => cap(passWords(t));

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---------------------------------------------------------------------------------------------------------------
// What a package includes, in named parts
// ---------------------------------------------------------------------------------------------------------------

/** The meaning of each feature, said once on the page (the hints and the compare table's row hints). */
export const FEATURE_HINTS = {
  oneAtATime: "One published event of that kind at a time, with as many drafts as you like",
  team: "The people who can sign in and help run your events",
  staff: "Volunteer Leads run the check-in desk, and Coordinators each run one sign-up",
  tracking: "Kept 2 years after their last event",
  weeklyHours: "Hours that repeat every week, like office hours or conference days",
} as const;

export type KindPart = {
  value: string;
  label: string;
  /** One published at a time. */
  one: boolean;
};

export type PackageFeatures = {
  /** Every kind it includes, in the website's order. */
  kinds: KindPart[];
  /** The kinds published one at a time. */
  oneAtATime: string[];
  allKinds: boolean;
  /** "A team of up to 5 people"; "A team of 2: you and one helper"; "A team of any size". */
  team: string;
  /** "Volunteer Leads and Coordinators", only when included. */
  staff: string | null;
  /** "Volunteer tracking", only when included. */
  tracking: string | null;
  /** "Weekly hours for parent-teacher conferences and meetings", scoped to the kinds it has, only when included. */
  weeklyHours: string | null;
};

export function teamWords(maxTeam: number | null): string {
  if (maxTeam === null) return "A team of any size";
  if (maxTeam === 1) return "Just you on the team";
  if (maxTeam === 2) return "A team of 2: you and one helper";
  return `A team of up to ${maxTeam} people`;
}

/** Weekly hours apply to the kinds booked by the hour: conferences and meetings. */
const WEEKLY_KINDS = ["conference", "meeting"];

export function packageFeatures(t: PackageContents): PackageFeatures {
  const types = sortKinds(t.event_types);
  const weekly = sortKinds(WEEKLY_KINDS.filter((k) => t.event_types.includes(k)));
  return {
    kinds: types.map((v) => ({ value: v, label: kindLabel(v), one: t.one_at_a_time.includes(v) })),
    oneAtATime: sortKinds(t.one_at_a_time.filter((k) => t.event_types.includes(k))),
    allKinds: WEBSITE_KINDS.every((k) => t.event_types.includes(k.value)),
    team: teamWords(t.max_team),
    staff: t.event_staff ? "Volunteer Leads and Coordinators" : null,
    tracking: t.volunteer_history ? "Volunteer tracking" : null,
    weeklyHours: t.weekly_hours && weekly.length ? `Weekly hours for ${listWords(weekly.map(kindWords))}` : null,
  };
}

/** The "Best for" line: as written in admin, else from what the package includes. */
export function bestFor(t: PackageContents & { best_for?: string | null }): { text: string; from: "admin" | "generated" } {
  const typed = t.best_for?.trim();
  if (typed) return { text: typed, from: "admin" };
  const f = packageFeatures(t);
  return { text: `Groups that run ${f.allKinds ? "every kind of event" : listWords(f.kinds.map((k) => kindWords(k.value)))}`, from: "generated" };
}

/**
 * Whether `pkg` includes everything `base` does, at least as much: no kind left out, none turned "one at a time",
 * no smaller team, and no feature dropped. Only then can a card say "Everything in [base], plus".
 */
export function stacksOn(pkg: PackageContents, base: PackageContents): boolean {
  for (const t of base.event_types) {
    if (!pkg.event_types.includes(t)) return false;
    if (pkg.one_at_a_time.includes(t) && !base.one_at_a_time.includes(t)) return false;
  }
  if (base.max_team === null && pkg.max_team !== null) return false;
  if (base.max_team !== null && pkg.max_team !== null && pkg.max_team < base.max_team) return false;
  if (base.event_staff && !pkg.event_staff) return false;
  if (base.volunteer_history && !pkg.volunteer_history) return false;
  if (base.weekly_hours && !pkg.weekly_hours) return false;
  return true;
}

/** A kind added over the card before, or freed from "one at a time" (`note` then says so). */
export type PlusKind = KindPart & { note?: string };

/** What `pkg` adds over `base`, in the same named parts. Empty lists when it adds nothing (a copied package). */
export type PlusParts = {
  kinds: PlusKind[];
  team: string | null;
  staff: string | null;
  tracking: string | null;
  weeklyHours: string | null;
};

export function plusLines(pkg: PackageContents, base: PackageContents): PlusParts {
  const f = packageFeatures(pkg);
  const added = f.kinds.filter((k) => !base.event_types.includes(k.value));
  const freed = f.kinds
    .filter((k) => base.event_types.includes(k.value) && base.one_at_a_time.includes(k.value) && !k.one)
    .map((k) => ({ ...k, note: "As many at a time as you like" }));
  const bigger = pkg.max_team !== base.max_team;
  // Weekly hours are new when the base didn't have them, or had them for fewer kinds.
  const baseWeekly = packageFeatures(base).weeklyHours;
  return {
    kinds: [...added, ...freed],
    team: bigger ? f.team : null,
    staff: f.staff && !base.event_staff ? f.staff : null,
    tracking: f.tracking && !base.volunteer_history ? f.tracking : null,
    weeklyHours: f.weeklyHours && f.weeklyHours !== baseWeekly ? f.weeklyHours : null,
  };
}

export const plusIsEmpty = (p: PlusParts) => !p.kinds.length && !p.team && !p.staff && !p.tracking && !p.weeklyHours;

/**
 * What a card lists: "Everything in [before], plus" and only what's added, when it stacks on the card before and
 * adds something; otherwise everything it includes.
 */
export type CardContents = { plusOf: null; features: PackageFeatures } | { plusOf: string; plus: PlusParts; features: PackageFeatures };

export function cardContents(pkg: PackageContents, before?: PackageContents | null): CardContents {
  const features = packageFeatures(pkg);
  if (before && stacksOn(pkg, before)) {
    const plus = plusLines(pkg, before);
    if (!plusIsEmpty(plus)) return { plusOf: before.name, plus, features };
  }
  return { plusOf: null, features };
}

// ---------------------------------------------------------------------------------------------------------------
// The cheapest ways to run what someone picked
// ---------------------------------------------------------------------------------------------------------------

export type Choice = {
  /** The package, or Free (passes work with Free, no package needed). */
  package: { code: string; name: string; price_year_cents: number };
  /** One pass per picked kind the package doesn't include (each pass is one event). */
  passes: { code: string; event_type: string; price_cents: number }[];
  total_cents: number;
};

/**
 * Every package (with a yearly price) or Free that, with passes for the picked kinds it doesn't include, covers
 * what was picked, cheapest first; ties go to fewer passes. A pass is never added for a kind the package includes,
 * even "one at a time". Packages without a yearly price ("Ask us") can't be priced, so they aren't choices.
 */
export function cheapestChoices(picked: readonly string[], page: Pick<PricingPage, "packages" | "passes" | "free">): Choice[] {
  if (!picked.length) return [];
  const passFor = new Map<string, PricingPass>();
  for (const p of [...page.passes].sort((a, b) => a.price_cents - b.price_cents)) if (!passFor.has(p.event_type)) passFor.set(p.event_type, p);
  const bases = [
    ...page.free.filter((f) => f.code === "free").map((f) => ({ contents: f as PackageContents, price: 0 })),
    ...page.packages.filter((p) => p.price_year_cents != null).map((p) => ({ contents: p as PackageContents, price: p.price_year_cents! })),
  ];
  const choices: Choice[] = [];
  for (const { contents, price } of bases) {
    const missingKinds = sortKinds(picked.filter((k) => !contents.event_types.includes(k)));
    if (!missingKinds.every((k) => passFor.has(k))) continue;
    const passes = missingKinds.map((k) => {
      const p = passFor.get(k)!;
      return { code: p.code, event_type: k, price_cents: p.price_cents };
    });
    choices.push({
      package: { code: contents.code, name: contents.name, price_year_cents: price },
      passes,
      total_cents: price + passes.reduce((n, p) => n + p.price_cents, 0),
    });
  }
  return choices.sort((a, b) => a.total_cents - b.total_cents || a.passes.length - b.passes.length);
}

/** The packages whose kinds cover everything picked, by themselves (the cards that "fit"). */
export const packagesThatFit = (picked: readonly string[], packages: PricingPackage[]) =>
  picked.length ? packages.filter((p) => picked.every((k) => p.event_types.includes(k))) : [];

/** Not a card: Free and Free Teacher show as lines (pricing_page() never returns them as cards either). */
export const isCard = (t: { code: string }) => !isFreePackage(t.code);

// ---------------------------------------------------------------------------------------------------------------
// The request form ("Ask about [package]", "Get a [kind] pass")
// ---------------------------------------------------------------------------------------------------------------

export type PricingRequest = {
  name: string;
  email: string;
  organization: string;
  eventTypes: string[];
  /** A package or pass code from the page, or null for a general question. */
  plan: string | null;
  teacherRate: boolean;
  payByInvoice: boolean;
  message: string;
  /** The signed-in person's account, when they're asking for it. */
  organizationId: string | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAN_CODE = /^[a-z0-9_]{1,60}$/;

/**
 * Checks every answer at once, so the browser can point at each problem before sending and the server can check
 * again (submit_pricing_request() checks a third time). `fieldErrors` is keyed by the input's name.
 */
export function checkPricingRequest(form: FormData): { request?: PricingRequest; fieldErrors: Record<string, string> } {
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const name = text("name");
  const email = text("email").toLowerCase();
  const organization = text("organization");
  const message = text("message");
  const plan = text("plan");
  const orgId = text("organizationId");
  const known = new Set(PILOT_EVENT_TYPES.map((t) => t.value));
  const eventTypes = sortKinds([...new Set(form.getAll("eventTypes").map(String))].filter((v) => known.has(v)));

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = "Please enter your name.";
  else if (name.length > 200) fieldErrors.name = "Please keep your name under 200 characters.";
  if (!EMAIL.test(email) || email.length > 254) fieldErrors.email = "Please enter a valid email address, like name@example.org.";
  if (organization.length < 2) fieldErrors.organization = "Please enter your school or group.";
  else if (organization.length > 200) fieldErrors.organization = "Please keep this under 200 characters.";
  if (message.length > 2000) fieldErrors.message = "Please keep your message under 2,000 characters.";
  if (plan && !PLAN_CODE.test(plan)) fieldErrors.plan = "Pick a package or pass from the list.";

  if (Object.keys(fieldErrors).length) return { fieldErrors };
  return {
    request: {
      name,
      email,
      organization,
      eventTypes,
      plan: plan || null,
      teacherRate: form.get("teacherRate") === "1",
      payByInvoice: form.get("payByInvoice") === "1",
      message,
      organizationId: UUID.test(orgId) ? orgId : null,
    },
    fieldErrors,
  };
}

/** What submit_pricing_request() returns. */
export type PricingRequestResult = { id: string | null; status: "saved" | "duplicate" | "busy" };

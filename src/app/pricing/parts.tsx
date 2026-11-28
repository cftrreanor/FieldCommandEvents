// The pricing page's small shared parts and words (docs/design-decisions/2026-11-22-pricing-page.md). Safe in
// server and client components: no "use client", no server-only imports.
import type { ReactNode } from "react";
import { brand } from "@/lib/brand";
import { dollars, listWords } from "@/lib/plan";
import { PILOT_END_LABEL } from "@/lib/pilot";
import {
  FEATURE_HINTS,
  kindNoun,
  kindWords,
  packageFeatures,
  weeklyKinds,
  passWords,
  WEBSITE_KINDS,
  type PackageContents,
  type PricingPackage,
  type PricingPage,
  type PricingPass,
} from "@/lib/pricing";

export const LINK = "font-semibold text-brand underline underline-offset-4 dark:text-foreground";
export const BTN_OUTLINE =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-field-border bg-surface px-4 py-2 text-center text-sm font-semibold leading-5 text-foreground hover:border-brand";
export const CHECK = "size-5 shrink-0 accent-[var(--brand)]";
export const sectionTitle = "text-3xl font-normal leading-[1.02] tracking-tight sm:text-4xl";
export const CONTACT = `mailto:${brand.supportEmail}`;
/** The pricing page's width (four cards need more room than the other marketing pages' max-w-6xl). */
export const WIDTH = "max-w-7xl";

// The words the hero, the FAQ, and the request form share.
export const NO_RENEW = "Prices are per account. Nothing renews or charges on its own.";
export const AFTER_PILOT_LINE = "Choose the package that fits the events you run. Volunteers, families, and visiting directors never pay.";
export const PILOT_LINE = `Free for organizers through ${PILOT_END_LABEL}. After that, choose the package that fits the events you run. Volunteers, families, and visiting directors never pay.`;

export const yearly = (cents: number) => `${dollars(cents)} a year`;

/** Who gets the teacher rate: the FAQ, and the request form's "Who qualifies" (shown in place there). */
export const TEACHER_WHO =
  "Classroom teachers using an account in their own name for their own classes. School, PTO, booster, and club accounts use the regular price. Teachers who only run their own parent-teacher conferences can use Free Teacher at no cost.";

/**
 * The request form, with the package or pass and the kinds picked carried over. `also`: more passes in the same
 * choice (the cheapest-option lines), which the form names in its message box.
 */
export function askHref(plan?: string | null, kinds: readonly string[] = [], also: readonly string[] = []) {
  const parts: string[] = [];
  if (plan) parts.push(`plan=${encodeURIComponent(plan)}`);
  if (kinds.length) parts.push(`kinds=${kinds.map(encodeURIComponent).join(",")}`);
  if (also.length) parts.push(`also=${also.map(encodeURIComponent).join(",")}`);
  return parts.length ? `/pricing/ask?${parts.join("&")}` : "/pricing/ask";
}

/**
 * Passes someone could actually use: priced, and for a kind Free doesn't include (a pass is only spent on a kind
 * the account's package leaves out, and Free's kinds are never left out: Engineer F4).
 */
export function usablePasses(page: Pick<PricingPage, "passes" | "free">): (PricingPass & { price_cents: number })[] {
  const free = page.free.find((f) => f.code === "free");
  return page.passes.filter((p): p is PricingPass & { price_cents: number } => p.price_cents != null && !(free?.event_types ?? []).includes(p.event_type));
}

/** "Get a band contest pass". */
export const passButton = (t: string) => `Get a ${passWords(t)}`;

/** Free and Free Teacher, as one line each. */
export function freeLine(f: PackageContents) {
  const feats = packageFeatures(f);
  const kinds = feats.kinds.map((k) => `${kindWords(k.value)}${k.one ? " (one at a time)" : ""}`);
  const team = feats.team[0].toLowerCase() + feats.team.slice(1);
  return `${listWords(kinds)[0].toUpperCase()}${listWords(kinds).slice(1)}, with ${team}${feats.weeklyHours ? `, and ${feats.weeklyHours[0].toLowerCase()}${feats.weeklyHours.slice(1)}` : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Icons the app's icon set doesn't have yet
// ---------------------------------------------------------------------------------------------------------------

export function CheckIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function DashIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
      <path d="M7 12h10" />
    </svg>
  );
}

export function ChevronIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** The neutral "1" for "One at a time": a small circle, never amber (it isn't a warning). */
export function OneBadge() {
  return (
    <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-foreground ring-1 ring-brand/30">
      1
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The compare table, as plain data (the phone version, a client component, picks two columns)
// ---------------------------------------------------------------------------------------------------------------

/** One cell, in words (never color alone). */
export type Cell = { kind: "yes"; note?: string } | { kind: "one" } | { kind: "no" } | { kind: "text"; text: string };
export type Matrix = {
  cols: { code: string; name: string }[];
  groups: { group: string; rows: { label: string; hint?: string; cells: Record<string, Cell> }[] }[];
};

type Col = PackageContents & { price_year_cents?: number | null; teacher_rate?: boolean; teacher_year_cents?: number | null; free?: boolean };

const yes = (on: boolean): Cell => ({ kind: on ? "yes" : "no" });

export function compareMatrix(page: Pick<PricingPage, "packages" | "free">): Matrix {
  const free = page.free.filter((f) => f.code === "free").map((f): Col => ({ ...f, free: true }));
  const cols: Col[] = [...free, ...(page.packages as (PricingPackage & Col)[])];
  const row = (label: string, cell: (c: Col) => Cell, hint?: string) => ({
    label,
    hint,
    cells: Object.fromEntries(cols.map((c) => [c.code, cell(c)])),
  });
  const teamCell = (c: Col): Cell => ({ kind: "text", text: c.max_team === null ? "Any size" : c.max_team === 1 ? "Just you" : `Up to ${c.max_team}` });
  return {
    cols: cols.map((c) => ({ code: c.code, name: c.name })),
    groups: [
      {
        group: "Price",
        rows: [
          row("Yearly", (c) => ({ kind: "text", text: c.free ? "Free" : c.price_year_cents == null ? "Ask us" : dollars(c.price_year_cents) })),
          row(
            "Classroom teachers",
            (c) => ({
              kind: "text",
              text: c.free ? "Free" : c.teacher_rate && c.teacher_year_cents != null ? dollars(c.teacher_year_cents) : "No teacher rate",
            }),
            "On their own account, for their own classes",
          ),
        ],
      },
      {
        group: "Kinds of event",
        rows: WEBSITE_KINDS.map((k) =>
          row(k.label, (c) => (!c.event_types.includes(k.value) ? { kind: "no" } : c.one_at_a_time.includes(k.value) ? { kind: "one" } : { kind: "yes" })),
        ),
      },
      {
        group: "Team and volunteers",
        rows: [
          row("Team", teamCell, FEATURE_HINTS.team),
          row("Volunteer Leads and Coordinators", (c) => yes(c.event_staff), FEATURE_HINTS.staff),
          row("Volunteer tracking", (c) => yes(c.volunteer_history), FEATURE_HINTS.tracking),
          // Which kinds, in each cell ("For meetings"): weekly hours only apply to the kinds a package includes (Content F4).
          row(
            "Weekly hours",
            (c) => {
              const kinds = weeklyKinds(c);
              return kinds.length && c.weekly_hours ? { kind: "yes", note: `For ${listWords(kinds.map(kindNoun))}` } : { kind: "no" };
            },
            FEATURE_HINTS.weeklyHoursTable,
          ),
        ],
      },
    ],
  };
}

/** A compare-table cell: an icon and words, at full strength. */
export function CellView({ cell }: { cell: Cell }) {
  if (cell.kind === "text") return <span className="font-semibold tabular-nums">{cell.text}</span>;
  return (
    <span className="inline-flex items-start gap-1.5 text-left">
      {cell.kind === "yes" ? <CheckIcon className="size-5 text-success" /> : cell.kind === "one" ? <OneBadge /> : <DashIcon className="size-5 text-foreground" />}
      <span className="min-w-0">
        <span className={`block ${cell.kind === "no" ? "" : "font-semibold"}`}>{cell.kind === "yes" ? "Included" : cell.kind === "one" ? "One at a time" : "Not included"}</span>
        {cell.kind === "yes" && cell.note && <span className="block text-muted">{cell.note}</span>}
      </span>
    </span>
  );
}

/** A question that opens to show its answer, with a chevron. On <details>, so it works without JavaScript. */
export function Disclosure({ id, q, children }: { id?: string; q: string; children: ReactNode }) {
  return (
    <details id={id} className="group scroll-mt-20">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold hover:text-brand dark:hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span>{q}</span>
        <ChevronIcon className="size-5 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="pb-5 pr-8 leading-7 text-muted">{children}</div>
    </details>
  );
}

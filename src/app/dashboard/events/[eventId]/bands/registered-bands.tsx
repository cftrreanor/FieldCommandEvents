"use client";

import { useState } from "react";
import { mealOptionsOrDefault, mealPrice, mealSummary, mealTotal, type MealOrder } from "@/lib/meal-price";
import { Badge, Button, Card } from "@/components/ui";
import type { BandRow } from "@/lib/bands";
import { formatPhone } from "@/lib/phone";

type Words = { one: string; many: string; One: string; Many: string };

const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** Only the vehicle types a band is bringing: "2 buses · 1 truck + trailer". */
function vehicles(b: Pick<BandRow, "bus_count" | "box_truck_count" | "truck_trailer_count" | "semi_truck_count">, buses: boolean) {
  const parts = [
    b.bus_count ? n(b.bus_count, "bus", "buses") : null,
    buses ? null : b.box_truck_count ? n(b.box_truck_count, "box truck") : null,
    buses ? null : b.truck_trailer_count ? n(b.truck_trailer_count, "truck + trailer", "trucks + trailers") : null,
    buses ? null : b.semi_truck_count ? n(b.semi_truck_count, "semi") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "None";
}

/** A spreadsheet cell: quoted, and text that starts like a formula is kept as plain text. */
function cell(v: string | number) {
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

type Meals = { orders: Record<string, MealOrder>; options: string[]; priceCents: number | null };

function download(bands: BandRow[], words: Words, groups: boolean, fileName: string, meals: Meals | null) {
  const mealOptions = meals ? mealOptionsOrDefault(meals.options) : [];
  const head = [
    `${words.One} name`, "School", "Classification", groups ? "Performers" : "Students", "Chaperones", "Buses",
    ...(groups ? [] : ["Box trucks", "Trucks + trailers", "Semis"]),
    "Head director", "Director email", "Director phone", "Assistant directors", `${words.One} contact email`, "School address",
    "Scheduling conflicts", "Accessibility or staging needs", ...mealOptions.map((o) => `Meals: ${o}`), ...(meals ? ["Meal note"] : []), "Registered", "Withdrawn",
  ];
  const rows = bands.map((b) => [
    b.band_name, b.school_name, b.classification, b.student_count, b.chaperone_count, b.bus_count,
    ...(groups ? [] : [b.box_truck_count, b.truck_trailer_count, b.semi_truck_count]),
    b.head_director_name, b.head_director_email, formatPhone(b.head_director_phone), b.assistant_directors.join(", "),
    b.contact_email, b.school_address ?? "", b.contest_day_conflicts ?? "", b.special_needs ?? "", ...mealOptions.map((o) => meals?.orders[b.id]?.counts[o] ?? 0), ...(meals ? [meals.orders[b.id]?.note ?? ""] : []), b.created_at.slice(0, 10), b.scratched_at ? "Yes" : "",
  ]);
  const csv = [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Hosts: everyone who registered, with totals for planning (people,
 * buses, trucks), a filter by classification, and a spreadsheet download.
 */
export function RegisteredBands({
  bands,
  classifications,
  words,
  groups,
  fileName,
  meals = null,
}: {
  bands: BandRow[];
  /** Meals: each band's order by band id, the options, and the price (null when the host doesn't offer meals). */
  meals?: Meals | null;
  classifications: string[];
  words: Words;
  /** Group events: performers and buses only. */
  groups: boolean;
  fileName: string;
}) {
  const [classification, setClassification] = useState<string | null>(null);
  // The event's classifications in order, plus any a band registered under before they changed.
  const classes = [...classifications, ...new Set(bands.map((b) => b.classification).filter((c) => !classifications.includes(c)))].filter(
    (c) => bands.some((b) => b.classification === c),
  );
  const shown = classification ? bands.filter((b) => b.classification === classification) : bands;
  // Withdrawn bands stay listed, but aren't counted in the totals.
  const coming = shown.filter((b) => !b.scratched_at);
  const withdrawn = shown.length - coming.length;
  const sum = (k: keyof Pick<BandRow, "student_count" | "chaperone_count" | "bus_count" | "box_truck_count" | "truck_trailer_count" | "semi_truck_count">) =>
    coming.reduce((t, b) => t + (b[k] ?? 0), 0);
  // Meals for the bands still coming: how many of each option, and what they add up to.
  const mealOptions = meals ? mealOptionsOrDefault(meals.options) : [];
  const mealCounts = Object.fromEntries(mealOptions.map((o) => [o, coming.reduce((t, b) => t + (meals?.orders[b.id]?.counts[o] ?? 0), 0)]));
  const mealsTotal = mealTotal(mealCounts);
  const mealBands = coming.filter((b) => mealTotal(meals?.orders[b.id]?.counts ?? {}) > 0).length;
  const totals = {
    bus_count: sum("bus_count"),
    box_truck_count: sum("box_truck_count"),
    truck_trailer_count: sum("truck_trailer_count"),
    semi_truck_count: sum("semi_truck_count"),
  };

  return (
    <section aria-labelledby="registered-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="registered-heading" className="text-xl font-semibold">
          Registered {words.many} ({bands.length})
        </h2>
        {bands.length > 0 && (
          <Button type="button" variant="secondary" onClick={() => download(shown, words, groups, fileName, meals)}>
            Download list
          </Button>
        )}
      </div>

      {bands.length === 0 ? (
        <Card className="mt-4">
          <p className="text-sm text-muted">No {words.many} have registered yet. They show up here as directors sign up.</p>
        </Card>
      ) : (
        <>
          {classes.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Show classification">
              {[null, ...classes].map((c) => {
                const on = classification === c;
                const count = c ? bands.filter((b) => b.classification === c).length : bands.length;
                return (
                  <button
                    key={c ?? "all"}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setClassification(c)}
                    className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium ring-1 ${on ? "bg-brand text-brand-foreground ring-brand" : "bg-surface ring-border hover:ring-brand"}`}
                  >
                    {c ?? "All"} <span className={`ml-1.5 ${on ? "" : "text-muted"}`}>{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Totals for planning parking, seating, and check-in. */}
          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-4">
            <Total label={withdrawn ? `${words.Many} (${withdrawn} withdrawn)` : words.Many} value={coming.length} />
            <Total label={groups ? "Performers" : "Students"} value={sum("student_count")} />
            <Total label="Chaperones" value={sum("chaperone_count")} />
            <Total label={groups ? "Buses" : "Vehicles"} value={vehicles(totals, groups)} />
          </dl>
          {meals && (
            // What to order: the total by option, the cost, and how many bands ordered.
            <div className="mt-3 rounded-lg border border-border bg-surface p-4 text-sm">
              <p>
                <span className="font-semibold">
                  {mealsTotal} meal{mealsTotal === 1 ? "" : "s"} ordered
                </span>
                {meals.priceCents != null && mealsTotal > 0 && <> · {mealPrice(mealsTotal * meals.priceCents)}</>}
                <span className="text-muted">
                  {" "}
                  · {mealBands} of {coming.length} {coming.length === 1 ? words.one : words.many} ordered
                </span>
              </p>
              {mealOptions.length > 1 && mealsTotal > 0 && (
                <p className="mt-1 text-muted">{mealOptions.map((o) => `${o}: ${mealCounts[o]}`).join(" · ")}</p>
              )}
            </div>
          )}

          <ul className="mt-4 space-y-3">
            {shown.map((b) => (
              <li key={b.id}>
                <details className="group rounded-lg border border-border bg-surface px-4 py-2">
                  <summary className="flex min-h-11 cursor-pointer list-none items-start gap-2 py-1 [&::-webkit-details-marker]:hidden">
                    <span aria-hidden className="mt-0.5 text-muted transition group-open:rotate-90">
                      ▸
                    </span>
                    <span className="min-w-0">
                      <span className={`font-semibold ${b.scratched_at ? "text-muted line-through" : ""}`}>{b.band_name}</span>
                      {b.scratched_at && (
                        <span className="ml-2 align-middle">
                          <Badge tone="off">Withdrawn</Badge>
                        </span>
                      )}
                      <span className="text-muted">
                        {" "}
                        · {b.school_name} · {b.classification} · {n(b.student_count, groups ? "performer" : "student")}
                        {meals && mealTotal(meals.orders[b.id]?.counts ?? {}) > 0 && ` · ${n(mealTotal(meals.orders[b.id]!.counts), "meal")}`}
                      </span>
                    </span>
                  </summary>
                  <dl className="mt-3 mb-2 grid gap-3 text-sm sm:grid-cols-2">
                    <Detail label="Head director">
                      {b.head_director_name} ·{" "}
                      <a className="text-brand hover:underline" href={`tel:${b.head_director_phone}`}>
                        {formatPhone(b.head_director_phone)}
                      </a>{" "}
                      ·{" "}
                      <a className="break-all text-brand hover:underline" href={`mailto:${b.head_director_email}`}>
                        {b.head_director_email}
                      </a>
                    </Detail>
                    <Detail label="Assistant directors">{b.assistant_directors.join(", ") || "None listed"}</Detail>
                    <Detail label={`${words.One} contact`}>{b.contact_email}</Detail>
                    <Detail label="School address">{b.school_address || "Not given"}</Detail>
                    <Detail label="People">
                      {n(b.student_count, groups ? "performer" : "student")} · {n(b.chaperone_count, "chaperone")}
                    </Detail>
                    <Detail label={groups ? "Buses" : "Vehicles"}>{vehicles(b, groups)}</Detail>
                    <Detail label="Scheduling conflicts">{b.contest_day_conflicts ?? "None"}</Detail>
                    <Detail label="Accessibility or staging needs">{b.special_needs ?? "None"}</Detail>
                    {meals && (
                      <Detail label="Meals">
                        {[mealSummary(meals.orders[b.id]?.counts ?? {}, mealOptions) || "None ordered", meals.orders[b.id]?.note].filter(Boolean).join(" · ")}
                      </Detail>
                    )}
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Total({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className={`mt-0.5 font-semibold ${typeof value === "number" ? "text-lg" : ""}`}>{typeof value === "number" ? value.toLocaleString() : value}</dd>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

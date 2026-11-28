"use client";
// The pricing page's interactive parts: "What are you running?" and the cards it marks, and the phones' two-package
// compare (which starts on the packages that match). They share what was picked, which is kept in the address
// (?kinds=…), so Back from the request form comes back to the same picks (UX F3).
import { createContext, use, useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { LineIcon } from "@/components/line-icon";
import { Badge } from "@/components/ui";
import { dollars, listWords } from "@/lib/plan";
import {
  bestFor,
  cardContents,
  cheapestChoices,
  FEATURE_HINTS,
  eventNoun,
  kindNoun,
  oneEvent,
  orWords,
  packagesThatFit,
  passTeamLine,
  passWords,
  WEBSITE_KINDS,
  type Choice,
  type KindPart,
  type PricingPackage,
  type PricingPage,
} from "@/lib/pricing";
import { askHref, BTN_OUTLINE, CellView, CHECK, CheckIcon, LINK, OneBadge, usablePasses, yearly, type Matrix } from "./parts";

const Picked = createContext<{ picked: string[]; setPicked: (p: string[]) => void }>({ picked: [], setPicked: () => {} });

const PICKS_CHANGED = "pricing-picks";
const KNOWN = new Set(WEBSITE_KINDS.map((k) => k.value));
const inOrder = (picked: readonly string[]) => WEBSITE_KINDS.filter((k) => picked.includes(k.value)).map((k) => k.value);
const readPicks = () => new URLSearchParams(window.location.search).get("kinds") ?? "";
const watchPicks = (on: () => void) => {
  window.addEventListener("popstate", on);
  window.addEventListener(PICKS_CHANGED, on);
  return () => {
    window.removeEventListener("popstate", on);
    window.removeEventListener(PICKS_CHANGED, on);
  };
};

/** What was picked, read from and written to the address (the page itself is built once for everyone). */
export function PickedProvider({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(watchPicks, readPicks, () => "");
  const picked = inOrder(raw.split(",").filter((k) => KNOWN.has(k)));
  const setPicked = (next: string[]) => {
    const q = new URLSearchParams(window.location.search);
    q.delete("kinds");
    const rest = q.toString();
    const kinds = inOrder(next);
    const search = [rest, kinds.length ? `kinds=${kinds.join(",")}` : ""].filter(Boolean).join("&");
    // Next.js keeps its router in step with replaceState; no new history entry for each tap.
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
    window.dispatchEvent(new Event(PICKS_CHANGED));
  };
  return <Picked value={{ picked, setPicked }}>{children}</Picked>;
}

/** Phones (below the two-column layout): matching cards move to the top under their own heading. */
function usePhone() {
  return useSyncExternalStore(
    (on) => {
      const m = window.matchMedia("(max-width: 767px)");
      m.addEventListener("change", on);
      return () => m.removeEventListener("change", on);
    },
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false,
  );
}

const icon = (t: string) => WEBSITE_KINDS.find((k) => k.value === t)?.icon ?? "sparkle";
/** "school fairs or visitor check-in": short names, so a list of kinds reads at a glance (Content F3, r2 F7). */
const kindList = (kinds: readonly string[]) => orWords(kinds.map(kindNoun));
const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * One cheaper way to run what was picked, in honest words (owner decision, built check 1): every pass says it's for
 * one event, yearly and one-time prices stay apart, and "one at a time" is said where that's all the package covers.
 */
function choiceWords(c: Choice, freeName: string) {
  const free = c.package.code === "free";
  const n = c.passes.length;
  const plus = n === 0 ? "" : n === 1 ? `, plus a ${passWords(c.passes[0].event_type)} for one event` : `, plus ${n} passes, for one event each`;
  const title = `${c.package.name}${plus}`;
  const passPrices = c.passes.map((p) => `${dollars(p.price_cents)} for ${oneEvent(p.event_type)}`);
  const price = free ? (n ? passPrices.join(", plus ") : "No cost") : [yearly(c.package.price_year_cents), ...passPrices].join(", plus ");
  const covers = c.covers.length
    ? `${c.package.name} includes ${listWords(c.covers.map((k) => `${kindNoun(k.event_type)}${k.one ? " (one at a time)" : ""}`))}`
    : null;
  return { title: free ? title.replace(c.package.name, freeName) : title, price, covers };
}

/**
 * The badge on the lowest-priced way to run what was picked: with passes, it's one of each, not a year of them ("Lowest
 * price for one band contest" when one kind was picked; Content r2 F6).
 */
const lowestWords = (c: Pick<Choice, "passes">, picked: readonly string[]) =>
  !c.passes.length ? "Lowest price that includes what you picked" : picked.length === 1 ? `Lowest price for ${oneEvent(picked[0])}` : "Lowest price for one of each";

/**
 * Why a dearer option is worth a look, from what it includes: "Every school fair and volunteer sign-up all year, plus
 * one visitor check-in day" (consultant r2 F7).
 */
function reasonWords(c: Choice) {
  const every = c.covers.filter((k) => !k.one).map((k) => eventNoun(k.event_type));
  const one = c.covers.filter((k) => k.one).map((k) => kindNoun(k.event_type));
  const parts = [every.length ? `Every ${listWords(every)} all year` : null, one.length ? `${capFirst(listWords(one))}, one at a time` : null].filter(Boolean);
  const passes = c.passes.map((p) => oneEvent(p.event_type));
  const head = parts.join(", and ");
  return passes.length ? `${head || capFirst(listWords(passes))}${head ? `, plus ${listWords(passes)}` : ""}` : head;
}

/** "What are you running?" (checkboxes), what fits, the cheaper choices, and the cards. */
export function Chooser({ page, headingId }: { page: PricingPage; headingId: string }) {
  const { picked, setPicked } = use(Picked);
  const phone = usePhone();
  const cards = page.packages;
  const fits = packagesThatFit(picked, cards);
  const fitCodes = new Set(fits.map((f) => f.code));
  const freeName = page.free.find((f) => f.code === "free")?.name ?? "Free";
  const passes = usablePasses(page);
  const lowestPass = passes.length ? Math.min(...passes.map((p) => p.price_cents)) : null;

  // The cheapest card that fits by itself, and up to three cheaper ways (Free, or a package, with passes): from the
  // data, with any that cost more without running a pick better left out (cheapestChoices).
  const pricedFits = fits.filter((f) => f.price_year_cents != null).sort((a, b) => a.price_year_cents! - b.price_year_cents!);
  const cheapestFit = pricedFits[0] ?? null;
  const options = cheapestChoices(picked, page)
    .filter((c) => !(c.passes.length === 0 && fitCodes.has(c.package.code)))
    .filter((c) => !cheapestFit || c.total_cents < cheapestFit.price_year_cents!)
    .slice(0, 3);
  const cardIsLowest = Boolean(cheapestFit && !options.length);

  const all = picked.length === 1 ? kindNoun(picked[0]) : picked.length === 2 ? "both" : `all ${picked.length}`;
  const announce = !picked.length
    ? ""
    : fits.length === 0
      ? picked.length === 1
        ? `No one package includes ${kindNoun(picked[0])}.`
        : `No one package includes all ${picked.length} of your picks.`
      : `${fits.length === 1 ? "1 package includes" : `${fits.length} packages include`} ${all}:`;

  const toggle = (v: string) => setPicked(picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v]);
  const card = (p: PricingPackage, i: number) => (
    <PackageCard
      key={p.code}
      p={p}
      before={i > 0 ? cards[i - 1] : null}
      fit={picked.length ? fitCodes.has(p.code) : null}
      missingKinds={picked.filter((t) => !p.event_types.includes(t))}
      lowest={cardIsLowest && cheapestFit?.code === p.code}
      picked={picked}
    />
  );
  const cols = cards.length >= 5 || cards.length === 3 ? "lg:grid-cols-3" : cards.length === 4 ? "xl:grid-cols-4" : "";
  const grid = `grid gap-x-4 gap-y-6 md:grid-cols-2 ${cols}`;

  return (
    <>
      <fieldset aria-labelledby={headingId} className="mt-4">
        <p className="text-muted">Choose every kind of event you run. The packages that include all of them are marked.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {WEBSITE_KINDS.map((k) => (
            <KindChoice key={k.value} k={k} checked={picked.includes(k.value)} onChange={() => toggle(k.value)} />
          ))}
        </div>
      </fieldset>
      {/* Passes sit far down the page on phones: say they exist here (consultant 4). */}
      {lowestPass != null && (
        <p className="mt-3 text-muted">
          Running just one event?{" "}
          <a href="#passes" className={`${LINK} inline-flex min-h-11 items-center`}>
            Passes start at {dollars(lowestPass)}
          </a>
        </p>
      )}

      {/* Read out as people check and uncheck; says the result in words, with the packages as links. */}
      <div aria-live="polite" className="mt-4 min-h-7 leading-7">
        {picked.length > 0 && (
          <p className="font-semibold">
            {announce}{" "}
            {fits.map((f, i) => (
              <span key={f.code}>
                {i > 0 && (i === fits.length - 1 ? (fits.length > 2 ? ", and " : " and ") : ", ")}
                <a href={`#package-${f.code}`} className={LINK}>
                  {f.name}
                </a>
              </span>
            ))}
            {fits.length === 0 && (
              <>
                <a href="#compare" className={LINK}>
                  Compare every package
                </a>
                , or{" "}
                <a href={askHref(null, picked)} className={LINK}>
                  ask us
                </a>
              </>
            )}
          </p>
        )}
      </div>

      {options.length > 0 && (
        <section aria-labelledby="choices-title" className="mt-4 max-w-4xl">
          <h3 id="choices-title" className="text-sm font-semibold tracking-wide text-muted uppercase">
            {fits.length ? "Ways that cost less" : "Ways to run what you picked"}
          </h3>
          <ul className="mt-2 space-y-3">
            {options.map((c, i) => {
              const base = [...page.free, ...cards].find((t) => t.code === c.package.code);
              return (
                <ChoiceRow
                  key={c.package.code + c.passes.map((p) => p.code).join()}
                  c={c}
                  freeName={freeName}
                  lowest={i === 0}
                  picked={picked}
                  // What a pass doesn't change, from the package it's used with (owner decision, follow-up check 1).
                  team={c.passes.length && base ? passTeamLine(base, cards) : null}
                />
              );
            })}
          </ul>
          {options.some((c) => c.passes.length) && (
            <p className="mt-3 text-muted">
              A pass is paid once and covers one event.{" "}
              <a href="#passes" className={`${LINK} inline-flex min-h-11 items-center`}>
                About passes
              </a>
            </p>
          )}
        </section>
      )}

      {phone && picked.length > 0 ? (
        <div className="mt-8 space-y-8">
          {[
            { title: fits.length ? "Packages that include everything you picked" : null, list: cards.filter((p) => fitCodes.has(p.code)) },
            { title: fits.length ? "Other packages" : "Every package", list: cards.filter((p) => !fitCodes.has(p.code)) },
          ]
            .filter((g) => g.list.length)
            .map((g) => (
              <section key={g.title ?? "fits"}>
                {g.title && <h3 className="text-xl font-semibold">{g.title}</h3>}
                <ul className={`mt-4 ${grid}`}>{g.list.map((p) => card(p, cards.indexOf(p)))}</ul>
              </section>
            ))}
        </div>
      ) : (
        <ul className={`mt-8 ${grid}`}>{cards.map(card)}</ul>
      )}
    </>
  );
}

/** One kind of event to check: the same shape here and on the request form (UI 9). */
export function KindChoice({
  k,
  checked,
  onChange,
  name,
}: {
  k: { value: string; label: string; icon: (typeof WEBSITE_KINDS)[number]["icon"] };
  checked?: boolean;
  onChange?: () => void;
  /** On the request form: a plain form field, checked to start with when `checked`. */
  name?: string;
}) {
  return (
    <label className="inline-flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-full border border-field-border bg-surface px-3 py-1.5 text-sm font-semibold hover:border-brand has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
      {name ? (
        <input type="checkbox" name={name} value={k.value} defaultChecked={checked} className={CHECK} />
      ) : (
        <input type="checkbox" className={CHECK} checked={Boolean(checked)} onChange={onChange} />
      )}
      <LineIcon name={k.icon} className="size-5 shrink-0" />
      <span className="min-w-0">{k.label}</span>
    </label>
  );
}

/** One cheaper way, with its own button to the request form (the pass or package, and the picks, filled in). */
function ChoiceRow({ c, freeName, lowest, picked, team }: { c: Choice; freeName: string; lowest: boolean; picked: string[]; team: string | null }) {
  const w = choiceWords(c, freeName);
  const id = useId();
  const free = c.package.code === "free";
  const [first, ...rest] = c.passes.map((p) => p.code);
  const n = c.passes.length;
  const button = free
    ? n
      ? { href: askHref(first, picked, rest), label: n === 1 ? "Get this pass" : "Get these passes" }
      : { href: "#free", label: `About ${freeName}` }
    : {
        href: askHref(c.package.code, picked, c.passes.map((p) => p.code)),
        label: `Ask about ${c.package.name}${n === 0 ? "" : n === 1 ? " and a pass" : " and passes"}`,
      };
  // A dearer option says why it's worth a look, in place of what it includes (consultant r2 F7).
  const detail = !lowest && !free ? reasonWords(c) : w.covers;
  return (
    <li className="grid gap-3 rounded-lg border border-border bg-background p-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        {lowest && (
          <p className="mb-1.5">
            <Badge tone="success">{lowestWords(c, picked)}</Badge>
          </p>
        )}
        <p id={id} className="font-semibold">
          {w.title}
        </p>
        <p className="tabular-nums">{capFirst(w.price)}</p>
        {detail && <p className="text-sm text-muted">{detail}</p>}
        {team && <p className="text-sm text-muted">{team}</p>}
      </div>
      <a href={button.href} aria-describedby={id} className={`${BTN_OUTLINE} w-full sm:w-auto`}>
        {button.label}
      </a>
    </li>
  );
}

function KindRow({ k, note }: { k: KindPart; note?: string }) {
  return (
    <li className="flex items-start gap-2">
      <LineIcon name={icon(k.value)} className="mt-0.5 size-5 shrink-0 text-brand dark:text-foreground" />
      <span className="min-w-0">
        <span className="block">{k.label}</span>
        {k.one && (
          <span className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-semibold">
            <OneBadge /> One at a time
          </span>
        )}
        {note && <span className="block text-sm text-muted">{note}</span>}
      </span>
    </li>
  );
}

function Line({ title, hint }: { title: string; hint?: string | null }) {
  return (
    <li className="flex gap-2">
      <CheckIcon className="mt-0.5 size-5 text-success" />
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        {hint && <span className="block text-muted">{hint}</span>}
      </span>
    </li>
  );
}

/**
 * One package. Five rows that line up across the cards in a row (CSS subgrid): what it says about your picks, name
 * and price, Best for, Includes, and the button.
 */
function PackageCard({
  p,
  before,
  fit,
  missingKinds,
  lowest,
  picked,
}: {
  p: PricingPackage;
  before: PricingPackage | null;
  fit: boolean | null;
  missingKinds: string[];
  lowest: boolean;
  picked: string[];
}) {
  const c = cardContents(p, before);
  const f = c.features;
  const kinds = c.plusOf ? c.plus.kinds : f.kinds;
  type L = { title: string; hint: string | null };
  const lines: (L | null | "")[] = c.plusOf
    ? [
        c.plus.team && { title: c.plus.team, hint: null },
        c.plus.staff && { title: c.plus.staff, hint: FEATURE_HINTS.staff },
        c.plus.tracking && { title: c.plus.tracking, hint: FEATURE_HINTS.tracking },
        c.plus.weeklyHours && { title: c.plus.weeklyHours, hint: FEATURE_HINTS.weeklyHours },
      ]
    : [
        { title: f.team, hint: null },
        f.staff && { title: f.staff, hint: FEATURE_HINTS.staff },
        f.tracking && { title: f.tracking, hint: FEATURE_HINTS.tracking },
        f.weeklyHours && { title: f.weeklyHours, hint: FEATURE_HINTS.weeklyHours },
      ];
  return (
    <li
      id={`package-${p.code}`}
      className={`row-span-5 grid scroll-mt-20 grid-rows-subgrid gap-y-0 rounded-lg border bg-surface p-5 shadow-card ${fit ? "border-brand ring-2 ring-brand dark:border-foreground dark:ring-foreground" : "border-border"}`}
    >
      {/* 1. What it says about your picks, Lowest, and Recommended, on one row (the same row on every card, so names
          line up). Empty, and no space kept, when nothing is picked and it isn't Recommended (UI 5). */}
      <div className={fit !== null || lowest || p.recommended ? "flex flex-wrap items-start gap-x-2 gap-y-1.5 pb-3" : ""}>
        {p.recommended && <Badge tone="info">Recommended</Badge>}
        {lowest && <Badge tone="success">Lowest price that includes what you picked</Badge>}
        {fit !== null && (
          <p className="flex items-start gap-1.5 text-sm font-semibold">
            {fit ? (
              <>
                <CheckIcon className="size-5 text-success" /> Includes what you picked
              </>
            ) : (
              <>Doesn&apos;t include {kindList(missingKinds)}</>
            )}
          </p>
        )}
      </div>

      {/* 2. Name, yearly price, the teacher rate, and which kinds it covers. */}
      <div>
        <h3 className="text-xl font-semibold">{p.name}</h3>
        {p.price_year_cents != null ? (
          <p className="mt-2 text-3xl font-medium tracking-tight tabular-nums">{yearly(p.price_year_cents)}</p>
        ) : (
          <>
            <p className="mt-2 text-3xl font-medium tracking-tight">Ask us</p>
            <p className="mt-0.5 text-muted">We&apos;ll send a price for your events</p>
          </>
        )}
        {p.teacher_rate && p.teacher_year_cents != null && (
          <p className="mt-1 text-sm text-muted tabular-nums">
            Classroom teachers: {yearly(p.teacher_year_cents)}{" "}
            {/* The dot stays with its link when the line wraps (Content r2 F9). */}
            <span className="inline-flex items-center whitespace-nowrap">
              <span aria-hidden>·&nbsp;</span>
              <a href="#teacher-rate" className={`${LINK} inline-flex min-h-11 items-center`}>
                Who qualifies
              </a>
            </span>
          </p>
        )}
        <div className="mt-3">
          <p className="text-sm font-semibold">{f.allKinds ? "Every kind of event" : `${f.kinds.length} of ${WEBSITE_KINDS.length} kinds of event`}</p>
          <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`Kinds of event ${p.name} includes`}>
            {f.kinds.map((k) => (
              <li key={k.value} title={k.label} className="inline-flex size-8 items-center justify-center rounded-md bg-brand-soft text-brand dark:text-foreground">
                <LineIcon name={icon(k.value)} className="size-5" />
                <span className="sr-only">
                  {k.label}
                  {k.one ? ", one at a time" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 3. Best for. */}
      <p className="pt-4 text-sm leading-6">
        <span className="font-semibold">Best for: </span>
        {bestFor(p).text}
      </p>

      {/* 4. Includes: "Everything in X, plus" only when it's true and something is added. */}
      <div className="mt-4 border-t border-border pt-4">
        <h4 className="text-sm font-semibold tracking-wide text-muted uppercase">Includes</h4>
        {c.plusOf && <p className="mt-2 font-semibold">Everything in {c.plusOf}, plus</p>}
        {kinds.length > 0 && (
          <ul className="mt-2 space-y-2 leading-6">
            {kinds.map((k) => (
              <KindRow key={k.value} k={k} note={"note" in k ? (k.note as string | undefined) : undefined} />
            ))}
          </ul>
        )}
        <ul className="mt-3 space-y-3 text-sm leading-6">
          {lines.filter((l): l is L => Boolean(l)).map((l) => (
            <Line key={l.title} title={l.title} hint={l.hint} />
          ))}
        </ul>
      </div>

      {/* 5. One outlined button that says where it goes. */}
      <div className="flex pt-5">
        <a href={askHref(p.code, picked)} className={`${BTN_OUTLINE} w-full`}>
          Ask about {p.name}
        </a>
      </div>
    </li>
  );
}

/** Phones: two selects ("Compare" / "with") that start on the packages matching what was picked. */
export function PhoneCompare({ m, packages }: { m: Matrix; packages: PricingPackage[] }) {
  const { picked } = use(Picked);
  const fits = packagesThatFit(picked, packages).map((p) => p.code);
  const rec = packages.find((p) => p.recommended)?.code;
  const first = fits[0] ?? packages[0]?.code ?? m.cols[0].code;
  const second = fits[1] ?? (rec && rec !== first ? rec : (m.cols.find((c) => c.code !== first)?.code ?? first));
  const [chosen, setChosen] = useState<{ a: string; b: string } | null>(null);
  // A new pick starts the compare on the new matches again.
  const key = picked.join();
  const [pickedKey, setPickedKey] = useState(key);
  if (key !== pickedKey) {
    setPickedKey(key);
    setChosen(null);
  }
  const left = chosen?.a ?? first;
  const right = chosen?.b ?? second;
  const name = (c: string) => m.cols.find((x) => x.code === c)?.name ?? c;
  const select = "min-h-11 w-full rounded-sm border border-field-border bg-surface px-2 text-base font-semibold";
  return (
    <div className="md:hidden">
      <div className="grid gap-3 min-[420px]:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Compare
          <select className={select} value={left} onChange={(e) => setChosen({ a: e.target.value, b: right })}>
            {m.cols.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          with
          <select className={select} value={right} onChange={(e) => setChosen({ a: left, b: e.target.value })}>
            {m.cols.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <table className="mt-4 w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">
          {name(left)} compared with {name(right)}
        </caption>
        <thead>
          <tr className="border-b-2 border-field-border">
            <td className="w-[38%] py-2 pr-2" />
            <th scope="col" className="py-2 pr-2 text-left align-bottom font-semibold [overflow-wrap:anywhere]">
              {name(left)}
            </th>
            <th scope="col" className="py-2 text-left align-bottom font-semibold [overflow-wrap:anywhere]">
              {name(right)}
            </th>
          </tr>
        </thead>
        {m.groups.map((g) => (
          <tbody key={g.group}>
            <tr>
              <th scope="colgroup" colSpan={3} className="bg-surface px-2 pt-4 pb-1 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                {g.group}
              </th>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.label} className="border-b border-border align-top">
                <th scope="row" className="py-2 pr-2 text-left font-semibold [overflow-wrap:anywhere]">
                  {r.label}
                  {r.hint && <span className="mt-0.5 block text-xs font-normal text-muted">{r.hint}</span>}
                </th>
                {/* A cell's note ("For conferences and meetings") hyphenates inside its column below 360 px instead of pushing the page sideways. */}
                <td className="py-2 pr-2 max-[359px]:[&_.text-muted]:hyphens-auto">
                  <CellView cell={r.cells[left]} />
                </td>
                <td className="py-2 max-[359px]:[&_.text-muted]:hyphens-auto">
                  <CellView cell={r.cells[right]} />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** A link to a question ("Who qualifies") opens it. */
export function OpenFromLink() {
  useEffect(() => {
    const open = () => {
      const el = window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.querySelector("summary")?.focus({ preventScroll: true });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}

/** "Try again" when prices didn't load: loads the page again. */
export function TryAgain({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.location.reload()}>
      Try again
    </button>
  );
}

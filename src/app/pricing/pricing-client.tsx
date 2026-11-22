"use client";
// The pricing page's interactive parts: "What are you running?" and the cards it marks, and the phones' two-package
// compare (which starts on the packages that match). They share what was picked.
import { createContext, use, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { LineIcon } from "@/components/line-icon";
import { Badge } from "@/components/ui";
import { dollars, listWords } from "@/lib/plan";
import {
  bestFor,
  cardContents,
  cheapestChoices,
  FEATURE_HINTS,
  kindWords,
  packagesThatFit,
  passWords,
  WEBSITE_KINDS,
  type Choice,
  type KindPart,
  type PricingPackage,
  type PricingPage,
} from "@/lib/pricing";
import { askHref, BTN_OUTLINE, CellView, CHECK, CheckIcon, LINK, OneBadge, recommendedReason, yearly, type Matrix } from "./parts";

const Picked = createContext<{ picked: string[]; setPicked: (p: string[]) => void }>({ picked: [], setPicked: () => {} });

export function PickedProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<string[]>([]);
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
const inOrder = (picked: string[]) => WEBSITE_KINDS.filter((k) => picked.includes(k.value)).map((k) => k.value);

/** "Or Volunteer Command plus a visitor registration and check-in pass: $290 a year". */
function choiceWords(c: Choice, freeName: string) {
  const passes = listWords(c.passes.map((p) => `a ${passWords(p.event_type)}`));
  if (c.package.code === "free") return c.passes.length ? `${passes}, with ${freeName}: ${dollars(c.total_cents)}` : `${freeName}, at no cost`;
  return c.passes.length ? `${c.package.name} plus ${passes}: ${yearly(c.total_cents)}` : `${c.package.name}: ${yearly(c.total_cents)}`;
}

function LowestMark() {
  return (
    <span className="ml-1 inline-flex align-middle">
      <Badge tone="success">Lowest price that includes what you picked</Badge>
    </span>
  );
}

/** "What are you running?" (checkboxes), what fits, the cheaper choices, and the cards. */
export function Chooser({ page, headingId }: { page: PricingPage; headingId: string }) {
  const { picked: raw, setPicked } = use(Picked);
  const picked = inOrder(raw);
  const phone = usePhone();
  const cards = page.packages;
  const fits = packagesThatFit(picked, cards);
  const fitCodes = new Set(fits.map((f) => f.code));
  const words = listWords(picked.map(kindWords));
  const freeName = page.free.find((f) => f.code === "free")?.name ?? "Free";

  // Cheaper ways than the cheapest package that fits: Free, or a package plus a pass (PM F3). From the data.
  const choices = cheapestChoices(picked, page);
  const cheapestFit = choices.find((c) => !c.passes.length && fitCodes.has(c.package.code));
  const cheaper = choices.filter((c) => c !== cheapestFit && (c.passes.length || c.package.code === "free") && (!cheapestFit || c.total_cents < cheapestFit.total_cents)).slice(0, 2);
  const lowest = choices[0];

  const announce = !picked.length
    ? ""
    : fits.length === 0
      ? `No one package includes ${words}.`
      : `${fits.length === 1 ? "1 package includes" : `${fits.length} packages include`} ${words}:`;

  const toggle = (v: string) => setPicked(raw.includes(v) ? raw.filter((x) => x !== v) : [...raw, v]);
  const card = (p: PricingPackage, i: number) => (
    <PackageCard
      key={p.code}
      p={p}
      before={i > 0 ? cards[i - 1] : null}
      fit={picked.length ? fitCodes.has(p.code) : null}
      missingKinds={picked.filter((t) => !p.event_types.includes(t))}
      lowest={Boolean(lowest && !lowest.passes.length && lowest.package.code === p.code)}
      picked={picked}
    />
  );
  const cols = cards.length >= 5 || cards.length === 3 ? "lg:grid-cols-3" : cards.length === 4 ? "xl:grid-cols-4" : "";
  const grid = `grid gap-x-4 gap-y-6 md:grid-cols-2 ${cols}`;

  return (
    <>
      <fieldset aria-labelledby={headingId} className="mt-4">
        <p className="text-muted">Pick every kind of event you run. The packages that include all of them are marked.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {WEBSITE_KINDS.map((k) => {
            const on = raw.includes(k.value);
            return (
              <label
                key={k.value}
                className={`inline-flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${on ? "border-brand bg-brand-soft" : "border-field-border bg-surface hover:border-brand"}`}
              >
                <input type="checkbox" className={CHECK} checked={on} onChange={() => toggle(k.value)} />
                <LineIcon name={k.icon} className="size-5 shrink-0" />
                <span className="min-w-0">{k.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Read out as people tick and untick; says the result in words, with the packages as links. */}
      <div aria-live="polite" className="mt-4 min-h-7 space-y-1 leading-7">
        {picked.length > 0 && (
          <>
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
            {cheaper.map((c) => (
              <p key={c.package.code + c.passes.map((p) => p.code).join()}>
                {fits.length ? `Or ${choiceWords(c, freeName)}` : choiceWords(c, freeName).replace(/^./, (x) => x.toUpperCase())}
                {c.package.code === "free" && !c.passes.length ? (
                  <>
                    {" "}
                    (
                    <a href="#free" className={LINK}>
                      Free options
                    </a>
                    )
                  </>
                ) : null}
                {c === lowest && <LowestMark />}
              </p>
            ))}
            {cheaper.some((c) => c.passes.length) && (
              <p className="text-muted">
                A pass covers one event.{" "}
                <a href="#passes" className={LINK}>
                  About passes
                </a>
              </p>
            )}
          </>
        )}
      </div>

      {phone && picked.length > 0 ? (
        <div className="mt-8 space-y-8">
          {[
            { title: fits.length ? `Packages that include ${words}` : null, list: cards.filter((p) => fitCodes.has(p.code)) },
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
      {/* 1. What it says about your picks, and Recommended (the same row on every card, so names line up). */}
      <div className="space-y-2 pb-3">
        {fit !== null && (
          <p className="flex items-start gap-1.5 text-sm font-semibold">
            {fit ? (
              <>
                <CheckIcon className="size-5 text-success" /> Includes what you picked
              </>
            ) : (
              <>Doesn&apos;t include {listWords(missingKinds.map(kindWords))}</>
            )}
          </p>
        )}
        {lowest && <Badge tone="success">Lowest price that includes what you picked</Badge>}
        {p.recommended && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Badge tone="info">Recommended</Badge>
            <span>{recommendedReason(p)}</span>
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
            Classroom teachers: {yearly(p.teacher_year_cents)}.{" "}
            <a href="#teacher-rate" className={LINK}>
              Who qualifies
            </a>
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
                <td className="py-2 pr-2">
                  <CellView cell={r.cells[left]} />
                </td>
                <td className="py-2">
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

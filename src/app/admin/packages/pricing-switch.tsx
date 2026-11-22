"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Field, Input } from "@/components/ui";
import type { Tier } from "@/lib/package-names";
import { isFreePackage, listWords } from "@/lib/plan";
import { setPricingPage } from "./actions";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The site-level switch for the pricing page (owner decision: hidden until the owner turns it on). Going live
 * confirms first and lists what changes across the site; hiding it confirms too.
 */
export function PricingPageSwitch({ packages, passes, live }: { packages: Tier[]; passes: Tier[]; live: boolean }) {
  // What pricing_page() shows: the same filters as pricing_card_count() and the free lines.
  const cards = packages.filter((p) => p.show_on_website && !p.retired_at && !isFreePackage(p.code) && p.event_types.length > 0);
  const freeLines = packages.filter((p) => isFreePackage(p.code) && !p.retired_at).length;
  const shownPasses = passes.filter((p) => p.show_on_website).length;
  const noPrice = cards.filter((p) => p.price_year_cents == null).map((p) => p.name);
  const contents = `${count(cards.length, "package card", "package cards")}, ${count(freeLines, "free line", "free lines")}, and ${count(shownPasses, "pass", "passes")}`;
  const [asking, setAsking] = useState<"live" | "hidden" | null>(null);
  const [blocked, setBlocked] = useState(false);

  const pick = (toLive: boolean) => {
    if (toLive === live) return;
    if (toLive && !cards.length) return setBlocked(true);
    setBlocked(false);
    setAsking(toLive ? "live" : "hidden");
  };

  return (
    // The admin Panel's look (kit.tsx is server-side).
    <section aria-labelledby="pricing-page-title" className="max-w-3xl rounded-md border border-border bg-surface">
      <h2 id="pricing-page-title" className="border-b border-border px-3 py-2 text-xs font-semibold tracking-wide text-muted uppercase">
        Pricing page
      </h2>
      <div className="p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div role="radiogroup" aria-label="Pricing page" className="inline-flex rounded-md border border-field-border p-0.5">
            {[
              { v: false, label: "Hidden" },
              { v: true, label: "Live" },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={live === o.v}
                onClick={() => pick(o.v)}
                className={`min-h-10 rounded-sm px-4 text-sm font-semibold ${live === o.v ? "bg-brand text-brand-foreground" : "text-foreground hover:bg-background"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <Link href="/pricing/preview" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4">
            Preview the page
          </Link>
        </div>
        <p className="mt-2 text-sm">
          {live
            ? `Live at /pricing: ${contents}.`
            : `Hidden: visitors get "We can't find that page." You can preview it. When it's live, it shows what's switched on below: ${contents}.`}
        </p>
        {noPrice.length > 0 && (
          <p className="mt-1 text-sm">
            {listWords(noPrice)} {noPrice.length === 1 ? "has" : "have"} no yearly price, so {noPrice.length === 1 ? "its card says" : "their cards say"} Ask
            us.
          </p>
        )}
        {blocked && (
          <p role="alert" className="mt-2 text-sm font-semibold text-danger">
            The page can&apos;t go live without a package card. Switch on Show on website for at least one package below, then try again.
          </p>
        )}
        {asking && <Confirm toLive={asking === "live"} contents={contents} noPrice={noPrice} onClose={() => setAsking(null)} />}
      </div>
    </section>
  );
}

function Confirm({ toLive, contents, noPrice, onClose }: { toLive: boolean; contents: string; noPrice: string[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const save = () =>
    start(async () => {
      setError(null);
      try {
        const r = await setPricingPage(toLive, note);
        if ("error" in r) return setError(r.error);
      } catch {
        return setError("Couldn't save. Check your connection and try again.");
      }
      router.refresh();
      dialog.current?.close();
    });

  return (
    <dialog
      ref={dialog}
      aria-labelledby="pricing-switch-title"
      onClose={onClose}
      className="m-auto w-[min(560px,calc(100vw-2rem))] rounded-lg border border-field-border bg-surface p-5 text-foreground shadow-elevated backdrop:bg-[#071a31]/55"
    >
      <h2 id="pricing-switch-title" className="text-lg font-semibold">
        {toLive ? "Put the pricing page live?" : "Hide the pricing page?"}
      </h2>
      <p className="mt-2 text-sm">What changes across the site:</p>
      {toLive ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
          <li>Anyone can open /pricing and see {contents}, with their prices</li>
          <li>The home page links to it, and its pilot and pricing lines switch to the after-pilot words</li>
          <li>The menus, footer, and audience pages link to it, and it&apos;s added to the sitemap</li>
          <li>You can hide it again at any time</li>
        </ul>
      ) : (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
          <li>Visitors to /pricing get &ldquo;We can&apos;t find that page.&rdquo; You can still preview it</li>
          <li>The links to it come off the home page, menus, footer, audience pages, and sitemap</li>
          <li>The home page&apos;s pilot and pricing lines go back to how they read before</li>
        </ul>
      )}
      {toLive && noPrice.length > 0 && (
        <p className="mt-3 rounded-md border border-border bg-background px-3 py-2 text-sm">
          <span className="font-semibold">
            {listWords(noPrice)} {noPrice.length === 1 ? "has" : "have"} no yearly price, so{" "}
            {noPrice.length === 1 ? "its card will say" : "their cards will say"} Ask us.
          </span>{" "}
          To set a price, keep the page hidden and select the package&apos;s name in the grid.
        </p>
      )}
      <Field label="Note for the activity log (optional)" className="mt-3">
        <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          className="inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold"
        >
          {toLive ? "Keep it hidden" : "Keep it live"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground disabled:cursor-wait"
        >
          {saving ? "Saving…" : toLive ? "Put it live" : "Hide it"}
        </button>
      </div>
    </dialog>
  );
}

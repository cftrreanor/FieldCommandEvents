"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge, Button, Select } from "@/components/ui";
import { getReuseCandidates, reuseSponsors, type ReuseCandidate } from "@/app/dashboard/sponsor-actions";
import { MAX_LEVELS, type SponsorLevel } from "@/lib/sponsors";
import type { ReuseSource } from "@/lib/sponsors-data";
import { formatDate } from "@/lib/time";
import { LogoThumb } from "./logo-tile";
import { Window } from "./window";
import { listAnd, plural } from "./words";

const key = (name: string) => name.trim().toLowerCase();

/** "Bring back sponsors from Cedar Ridge Invitational (Sat, Dec 6, 2025)": year two's heading, its card's too. */
export const bringBackTitle = (source: ReuseSource) => `Bring back sponsors from ${source.name} (${formatDate(source.startsOn)})`;

/**
 * "Add sponsors from other events" (the account's events the person hosts), and year two's "Bring back sponsors
 * from …" (`yearTwo`: one source, its levels come too). Duplicates show as already on this event; sponsors hidden
 * there are marked and left unchecked; levels match by name. Past 4 levels, a picker for each unmatched level sits
 * right under From, and the button points to them. On a published event the copies arrive hidden by default.
 */
export function ReuseWindow({
  eventId,
  sources,
  levels,
  published,
  yearTwo = false,
  onClose,
  onDone,
}: {
  eventId: string;
  sources: ReuseSource[];
  levels: SponsorLevel[];
  /** The event is published: offer (and default to) adding them hidden. */
  published: boolean;
  yearTwo?: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const ids = useId();
  const [from, setFrom] = useState(sources[0]?.eventId ?? "");
  const [list, setList] = useState<{ levels: SponsorLevel[]; sponsors: ReuseCandidate[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [map, setMap] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState(published);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickers = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!from) return;
    let live = true;
    getReuseCandidates(eventId, from)
      .then((r) => {
        if (!live) return;
        if (r.error || !r.sponsors) {
          setLoadError(r.error ?? "We couldn't load that event's sponsors");
          setList(null);
          return;
        }
        setLoadError(null);
        setList({ levels: r.levels ?? [], sponsors: r.sponsors });
        // Sponsors hidden there start unchecked.
        setPicked(new Set(r.sponsors.filter((s) => !s.duplicate && s.showPublic).map((s) => s.id)));
        setMap({});
      })
      .catch(() => live && setLoadError("No connection. Check it, then choose the event again"));
    return () => {
      live = false;
    };
  }, [eventId, from]);

  const source = sources.find((s) => s.eventId === from);
  const there = source?.name ?? "that event";
  const chosen = useMemo(() => (list?.sponsors ?? []).filter((s) => picked.has(s.id) && !s.duplicate), [list, picked]);
  // Levels of the chosen sponsors with no level of the same name here (in the source's order).
  const unmatched = useMemo(() => {
    const here = new Set(levels.map((l) => key(l.name)));
    const names: string[] = [];
    for (const s of chosen) if (s.levelName && !here.has(key(s.levelName)) && !names.includes(s.levelName)) names.push(s.levelName);
    return names;
  }, [chosen, levels]);
  // Year two brings every level along (up to 4); otherwise unmatched levels are added while there's room.
  const levelNames = yearTwo ? (list?.levels ?? []).map((l) => l.name).filter((n) => !levels.some((l) => key(l.name) === key(n))) : unmatched;
  const tooMany = levels.length > 0 && levels.length + levelNames.length > MAX_LEVELS;
  const needPick = tooMany ? unmatched : [];
  const missing = needPick.filter((n) => !map[n]);
  const ready = chosen.length > 0 && missing.length === 0;
  const levelsAdded = tooMany ? 0 : Math.min(levelNames.length, MAX_LEVELS - levels.length);
  const all = list?.sponsors ?? [];
  const allHere = all.length > 0 && all.every((s) => s.duplicate);
  const matched = levels.length > 0 && chosen.some((s) => s.levelName && levels.some((l) => key(l.name) === key(s.levelName!)));
  const noLevelThere = levels.length > 0 && chosen.some((s) => !s.levelName);
  // "Their level comes with them" only when it does: every chosen sponsor has one, matched or added.
  const levelsCome = chosen.length > 0 && chosen.every((s) => s.levelName) && !tooMany;
  const addHidden = published && hidden;

  const add = async () => {
    if (!ready) {
      // The button looks unavailable but still answers: it takes you to what's missing.
      const first = pickers.current?.querySelector<HTMLSelectElement>("select[data-empty=true]");
      if (first) {
        first.scrollIntoView({ block: "center", behavior: "smooth" });
        first.focus({ preventScroll: true });
      }
      return;
    }
    setBusy(true);
    setError(null);
    const res = await reuseSponsors(eventId, from, {
      sponsorIds: chosen.map((s) => s.id),
      levelMap: Object.fromEntries(needPick.map((n) => [n, map[n]])),
      withLevels: yearTwo,
      show: !addHidden,
    }).catch(() => ({ error: "No connection", added: 0, skipped: 0, logosFailed: 0 }));
    setBusy(false);
    if (res.error) {
      setError(`Couldn't add them: ${res.error.replace(/\.$/, "")}. Nothing was added; try again.`);
      return;
    }
    const added = res.added ?? 0;
    const parts = [`Added ${plural(added, "sponsor")}${levelsAdded ? ` and ${plural(levelsAdded, "level")}` : ""}${addHidden ? ", hidden. Show each one when you're ready" : ""}`];
    if (res.skipped) parts.push(`${res.skipped} already here`);
    if (res.logosFailed) parts.push(`${plural(res.logosFailed, "logo")} couldn't be copied, so ${res.logosFailed === 1 ? "that sponsor shows" : "those sponsors show"} by name`);
    onDone(parts.join(". "));
  };

  const count = chosen.length;
  const action = yearTwo
    ? `Bring back ${count ? plural(count, "sponsor") : "sponsors"}${levelsAdded ? ` and ${plural(levelsAdded, "level")}` : ""}`
    : `Add ${count ? plural(count, "sponsor") : "sponsors"}`;
  const hintId = `${ids}-hint`;
  const hint = !list || allHere ? null : count === 0 ? "Check at least one sponsor" : missing.length ? `Pick where ${listAnd(missing)} sponsors go (above)` : null;

  return (
    <Window
      wide
      title={yearTwo && source ? bringBackTitle(source) : "Add sponsors from other events"}
      onClose={onClose}
      actions={
        allHere ? (
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            {hint && (
              <p id={hintId} className="basis-full text-sm text-muted max-sm:order-last sm:text-right">
                {hint}
              </p>
            )}
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={add}
              aria-disabled={!ready || busy || undefined}
              aria-describedby={hint ? hintId : undefined}
              className="aria-disabled:opacity-60"
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? "Adding…" : `${action}${addHidden ? ", hidden" : ""}`}
            </Button>
          </>
        )
      }
    >
      {!allHere && (
        <p className="text-muted">
          Their name, logo, and website come with them{levelsCome ? ", and their level" : ""}. The &ldquo;Presented by&rdquo; choice isn&apos;t copied.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 font-semibold text-danger">
          {error}
        </p>
      )}
      {yearTwo ? null : sources.length === 1 ? (
        <p>
          From <span className="font-semibold">{source?.name}</span>
          {source ? ` (${formatDate(source.startsOn)})` : ""}
        </p>
      ) : (
        <fieldset>
          <legend className="text-sm font-semibold">From</legend>
          <div className="mt-1 divide-y divide-border border-y border-border">
            {sources.map((s) => (
              <label key={s.eventId} className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
                <input type="radio" name={`${ids}-from`} checked={from === s.eventId} onChange={() => setFrom(s.eventId)} className="team-radio mt-0.5 size-5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium [overflow-wrap:anywhere]">{s.name}</span>
                  <span className="block text-muted">
                    {formatDate(s.startsOn)} · {plural(s.sponsors, "sponsor")}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {loadError ? (
        <p role="alert" className="font-semibold text-danger">
          {loadError}.
        </p>
      ) : !list ? (
        <p role="status" className="text-muted">
          Loading their sponsors…
        </p>
      ) : allHere ? (
        <p role="status" className="font-medium">
          All {all.length} are already on this event.{sources.length > 1 && !yearTwo ? " Pick another event above." : ""}
        </p>
      ) : (
        <>
          {needPick.length > 0 && (
            <div ref={pickers} className="space-y-3">
              {needPick.map((n) => {
                const theirs = chosen.filter((s) => s.levelName === n).map((s) => s.name);
                const hid = `${ids}-${key(n)}-hint`;
                return (
                  <div key={n} className="rounded-md border border-border bg-background p-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-semibold">Put {n} sponsors in</span>
                      <Select value={map[n] ?? ""} data-empty={!map[n]} onChange={(e) => setMap((m) => ({ ...m, [n]: e.target.value }))} required aria-describedby={hid}>
                        <option value="" disabled>
                          Pick a level
                        </option>
                        {levels.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </Select>
                      <span id={hid} className="text-sm text-muted">
                        {levels.length >= MAX_LEVELS ? `You have ${MAX_LEVELS} levels, the most` : `This event would have more than ${MAX_LEVELS} levels, the most`}, so {n}{" "}
                        can&apos;t be added. Pick one of yours for {theirs.length <= 3 ? listAnd(theirs) : `its ${theirs.length} sponsors`}.
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>
          )}
          {yearTwo && list.levels.length > 0 && (
            <p>
              <span className="font-semibold">Levels:</span> {listAnd(list.levels.map((l) => l.name))}
            </p>
          )}
          <fieldset>
            <legend className="font-semibold">
              {plural(all.length, "sponsor")}
              {all.some((s) => s.duplicate) ? ` · ${all.filter((s) => s.duplicate).length} already on this event` : ""}
            </legend>
            <ul className="mt-1 divide-y divide-border border-y border-border">
              {all.map((s) => {
                const match = s.levelName ? levels.find((l) => key(l.name) === key(s.levelName!)) : null;
                const pickedHere = s.levelName && map[s.levelName] ? levels.find((l) => l.id === map[s.levelName!]) : null;
                const where = s.duplicate
                  ? "Already on this event"
                  : !s.levelName
                    ? levels.length
                      ? `No level at ${there} · goes into ${levels.at(-1)!.name}`
                      : null
                    : match
                      ? `${s.levelName} at ${there} · goes into ${match.name}`
                      : tooMany
                        ? pickedHere
                          ? `${s.levelName} at ${there} · goes into ${pickedHere.name}`
                          : `${s.levelName} at ${there} · pick a level above`
                        : `${s.levelName} at ${there} · adds a ${s.levelName} level`;
                return (
                  <li key={s.id}>
                    <label className={`flex min-h-14 items-center gap-3 py-1.5 ${s.duplicate ? "" : "cursor-pointer"}`}>
                      {s.duplicate ? (
                        <span aria-hidden className="w-5 shrink-0 text-center text-success">
                          ✓
                        </span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={picked.has(s.id)}
                          onChange={(e) =>
                            setPicked((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(s.id);
                              else next.delete(s.id);
                              return next;
                            })
                          }
                          className="size-5 shrink-0 accent-[var(--brand)]"
                        />
                      )}
                      <LogoThumb src={s.logoUrl} width={s.logoWidth} height={s.logoHeight} name={s.name} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 font-medium [overflow-wrap:anywhere]">
                          {s.name}
                          {!s.showPublic && !s.duplicate && <Badge tone="neutral">Hidden there</Badge>}
                        </span>
                        {where && <span className="block text-muted">{where}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          {(matched || noLevelThere) && (
            <p className="text-muted">
              {matched ? "Sponsors go into your level with the same name." : ""}
              {noLevelThere ? `${matched ? " " : ""}Sponsors with no level there go into ${levels.at(-1)!.name}.` : ""}
            </p>
          )}
          {levels.length === 0 && list.levels.length > 0 && !yearTwo && (
            <p className="text-muted">Their levels come too, and any sponsors you already have go into the first one.</p>
          )}
          {published && (
            <div>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5">
                <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--brand)]" />
                <span>
                  <span className="font-medium">Add them hidden so you can check first</span>
                  <span className="block text-muted">Your event is published. Show each one on the Sponsors page when it&apos;s ready.</span>
                </span>
              </label>
            </div>
          )}
        </>
      )}
    </Window>
  );
}

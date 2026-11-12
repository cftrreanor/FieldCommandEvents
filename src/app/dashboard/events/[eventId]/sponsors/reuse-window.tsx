"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Field, Select } from "@/components/ui";
import { getReuseCandidates, reuseSponsors, type ReuseCandidate } from "@/app/dashboard/sponsor-actions";
import { MAX_LEVELS, type SponsorLevel } from "@/lib/sponsors";
import type { ReuseSource } from "@/lib/sponsors-data";
import { formatDate } from "@/lib/time";
import { LogoThumb } from "./logo-tile";
import { Window } from "./window";
import { listAnd, plural } from "./words";

const key = (name: string) => name.trim().toLowerCase();

/**
 * "Add sponsors from other events" (events the person hosts), and year two's "Bring back last year's sponsors
 * and levels" (`yearTwo`: one source, its levels come too). Duplicates show as "Already added"; levels match by
 * name; past 4 levels it asks where each unmatched level's sponsors go, and the button waits for every pick.
 */
export function ReuseWindow({
  eventId,
  sources,
  levels,
  yearTwo = false,
  onClose,
  onDone,
}: {
  eventId: string;
  sources: ReuseSource[];
  levels: SponsorLevel[];
  yearTwo?: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [from, setFrom] = useState(sources[0]?.eventId ?? "");
  const [list, setList] = useState<{ levels: SponsorLevel[]; sponsors: ReuseCandidate[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [map, setMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setPicked(new Set(r.sponsors.filter((s) => !s.duplicate).map((s) => s.id)));
        setMap({});
      })
      .catch(() => live && setLoadError("No connection. Check it, then choose the event again"));
    return () => {
      live = false;
    };
  }, [eventId, from]);

  const source = sources.find((s) => s.eventId === from);
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
  const ready = chosen.length > 0 && needPick.every((n) => map[n]);
  const noLevelHere = levels.length > 0 && chosen.some((s) => !s.levelName);

  const add = async () => {
    setBusy(true);
    setError(null);
    const res = await reuseSponsors(eventId, from, {
      sponsorIds: chosen.length === (list?.sponsors.filter((s) => !s.duplicate).length ?? 0) ? null : chosen.map((s) => s.id),
      levelMap: Object.fromEntries(needPick.map((n) => [n, map[n]])),
      withLevels: yearTwo,
    }).catch(() => ({ error: "No connection", added: 0, skipped: 0, logosFailed: 0 }));
    setBusy(false);
    if (res.error) {
      setError(`Couldn't add them: ${res.error.replace(/\.$/, "")}. Nothing was added; try again.`);
      return;
    }
    const added = res.added ?? 0;
    const parts = [`Added ${plural(added, "sponsor")}${yearTwo && levelNames.length ? ` and ${plural(Math.min(levelNames.length, MAX_LEVELS - levels.length), "level")}` : ""}`];
    if (res.skipped) parts.push(`${res.skipped} already here`);
    if (res.logosFailed) parts.push(`${plural(res.logosFailed, "logo")} couldn't be copied, so ${res.logosFailed === 1 ? "that sponsor shows" : "those sponsors show"} by name`);
    onDone(parts.join(". "));
  };

  const dupes = (list?.sponsors ?? []).filter((s) => s.duplicate).length;
  const action = yearTwo
    ? `Bring back ${plural(chosen.length, "sponsor")}${levelNames.length ? ` and ${plural(Math.min(levelNames.length, MAX_LEVELS), "level")}` : ""}`
    : `Add ${plural(chosen.length, "sponsor")}`;

  return (
    <Window
      wide
      title={yearTwo ? "Bring back last year's sponsors and levels" : "Add sponsors from other events"}
      onClose={onClose}
      actions={
        <>
          {!ready && list && chosen.length > 0 && needPick.length > 0 && <p className="self-center text-sm text-muted sm:mr-auto">Pick a level for each first</p>}
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={add} disabled={!ready || busy} aria-busy={busy}>
            {busy ? "Adding…" : action}
          </Button>
        </>
      }
    >
      <p className="text-muted">
        Their name, logo, website, and level come with them{yearTwo ? ", and the levels too" : ""}. Presented by isn&apos;t copied. They&apos;re added showing on the public page.
      </p>
      {error && (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 font-semibold text-danger">
          {error}
        </p>
      )}
      {yearTwo || sources.length === 1 ? (
        <p>
          From <span className="font-semibold">{source?.name}</span>
          {source ? ` (${formatDate(source.startsOn)})` : ""}
        </p>
      ) : (
        <Field label="From">
          <Select value={from} onChange={(e) => setFrom(e.target.value)}>
            {sources.map((s) => (
              <option key={s.eventId} value={s.eventId}>
                {s.name} ({formatDate(s.startsOn)}), {plural(s.sponsors, "sponsor")}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {loadError ? (
        <p role="alert" className="font-semibold text-danger">
          {loadError}.
        </p>
      ) : !list ? (
        <p role="status" className="text-muted">
          Loading their sponsors…
        </p>
      ) : (
        <>
          {yearTwo && list.levels.length > 0 && (
            <p>
              <span className="font-semibold">Levels:</span> {listAnd(list.levels.map((l) => l.name))}
            </p>
          )}
          <fieldset>
            <legend className="font-semibold">
              {plural(list.sponsors.length, "sponsor")}
              {dupes ? ` · ${dupes} already added` : ""}
            </legend>
            <ul className="mt-1 divide-y divide-border border-y border-border">
              {list.sponsors.map((s) => {
                const match = s.levelName ? levels.find((l) => key(l.name) === key(s.levelName!)) : null;
                const where = s.duplicate
                  ? "Already added"
                  : !s.levelName
                    ? levels.length
                      ? `No level there · goes into ${levels.at(-1)!.name}`
                      : "No level"
                    : match
                      ? `${s.levelName} there · goes into ${match.name}`
                      : tooMany
                        ? `${s.levelName} there · no level by that name here`
                        : `${s.levelName} there · added as a new level`;
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
                        <span className="block font-medium [overflow-wrap:anywhere]">{s.name}</span>
                        <span className="block text-muted">{where}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          {needPick.map((n) => {
            const theirs = chosen.filter((s) => s.levelName === n).map((s) => s.name);
            return (
              <div key={n} className="rounded-md border border-border bg-background p-3">
                <Field
                  label={`Put ${n} sponsors in`}
                  hint={`This event would have more than ${MAX_LEVELS} levels, the most, so ${n} can't be added as a new one. Pick one of yours for ${listAnd(theirs)}.`}
                >
                  <Select value={map[n] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [n]: e.target.value }))} required>
                    <option value="" disabled>
                      Pick a level
                    </option>
                    {levels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            );
          })}
          {levels.length > 0 && (
            <p className="text-muted">
              Levels with the same name match
              {(() => {
                const same = (list.levels ?? []).filter((l) => levels.some((x) => key(x.name) === key(l.name))).map((l) => l.name);
                return same.length ? ` (${listAnd(same)})` : "";
              })()}
              .{noLevelHere ? ` Sponsors with no level there go into ${levels.at(-1)!.name}.` : ""}
            </p>
          )}
          {levels.length === 0 && list.levels.length > 0 && !yearTwo && (
            <p className="text-muted">Their levels come too, and any sponsors you already have go into the first one.</p>
          )}
        </>
      )}
    </Window>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CopyLink } from "@/components/copy-link";
import { toast } from "@/components/toaster";
import { Badge, Button, Card, Field, Select } from "@/components/ui";
import { moveSponsor, removeSponsor, removeSponsorLevel, restoreSponsor, setPresentedBy, setSponsorShown, type MoveResult } from "@/app/dashboard/sponsor-actions";
import { displayLink, organizerSponsorLogoUrl, type Sponsor, type SponsorLevel } from "@/lib/sponsors";
import type { ReuseSource } from "@/lib/sponsors-data";
import { ArrowButton, LevelsEditor, RemoveLevelWindow, type Run } from "./levels";
import { LOGO_TILE, LogoThumb } from "./logo-tile";
import { ReuseWindow } from "./reuse-window";
import { SponsorWindow } from "./sponsor-window";
import { ConfirmWindow, Window } from "./window";
import { levelGets, listAnd, ordinal, plural, showLine, sponsorKindWords } from "./words";

const OUTLINE = "inline-flex min-h-11 items-center justify-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";

export type SponsorsMode = "draft" | "live" | "after";

type Failure = { where: string; text: string; retry: () => void };
type Undo = { sponsor: Sponsor; levelId: string | null; index: number };

/**
 * The Sponsors page's body (board 3 with the light check's fixes and the owner's decisions): where sponsors stand,
 * levels first (a full card on the first visit, one line once set), year two's "Bring back last year's", the list
 * by level with arrows that cross levels, Show on the public page, Edit (Remove inside it, with Undo until the next
 * change), Presented by, where sponsors show, and the pinned "Saves as you go" bar.
 */
export function SponsorsManager({
  eventId,
  eventName,
  eventType,
  publicUrl,
  previewHref,
  mode,
  stepped,
  levels,
  sponsors,
  lastYear,
  sources,
  from,
  group,
}: {
  eventId: string;
  eventName: string;
  eventType: string;
  publicUrl: string;
  previewHref: string;
  mode: SponsorsMode;
  /** A band contest or festival draft: this page is the Sponsors step, with "Next up: Publish". */
  stepped: boolean;
  levels: SponsorLevel[];
  sponsors: Sponsor[];
  lastYear: ReuseSource | null;
  sources: ReuseSource[];
  /** For the copied email's sign-off: the organizer's name and their group's. */
  from: string;
  group: string;
}) {
  const router = useRouter();
  const words = sponsorKindWords(eventType);
  const [pending, setPending] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saved, setSaved] = useState(false);
  const [moved, setMoved] = useState<{ id: string; text: string } | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Sponsor | "new" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Sponsor | null>(null);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [removingLevel, setRemovingLevel] = useState<SponsorLevel | null>(null);
  const [presentedOpen, setPresentedOpen] = useState(false);
  const [reuse, setReuse] = useState<"other" | "lastYear" | null>(null);
  const empty = levels.length === 0 && sponsors.length === 0;
  // Year two leads with bringing back last year's; "Start with your levels" is the other choice.
  const [freshStart, setFreshStart] = useState(false);
  const yearTwo = Boolean(lastYear) && empty && !freshStart;
  // First visit: the full "Start with your levels" card, which stays open while levels are added this visit.
  const [skipped, setSkipped] = useState(false);
  const [levelSetup, setLevelSetup] = useState(empty);
  const firstVisit = empty && !skipped && !yearTwo;
  const focusAfter = useRef<{ id: string; dir: "up" | "down" } | null>(null);
  const undoButton = useRef<HTMLButtonElement>(null);

  // Fresh data from the server: the switches follow it again, and focus stays on the arrow that moved (L20).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the server's data replaces what was shown before it arrived
    setShown({});
    const f = focusAfter.current;
    if (!f) return;
    focusAfter.current = null;
    const btn = document.querySelector<HTMLButtonElement>(`[data-arrow="${f.id}-${f.dir}"]`);
    const other = document.querySelector<HTMLButtonElement>(`[data-arrow="${f.id}-${f.dir === "up" ? "down" : "up"}"]`);
    (btn && !btn.disabled ? btn : other)?.focus();
  }, [sponsors]);
  useEffect(() => {
    if (undo) undoButton.current?.focus();
  }, [undo]);

  /** One change: "Saving…" in the bar, a failure said where it happened (with Try again), then fresh data. */
  const runRaw = async (what: string, fn: () => Promise<{ error?: string }>, where = "page"): Promise<boolean> => {
    setPending((n) => n + 1);
    setFailure(null);
    setSaved(false);
    let res: { error?: string };
    try {
      res = await fn();
    } catch {
      res = { error: "No connection" };
    }
    setPending((n) => n - 1);
    if (res.error) {
      const err = res.error.replace(/\.$/, "");
      setFailure({ where, text: `Not saved. ${err}: ${what} didn't go through.`, retry: () => void runRaw(what, fn, where) });
      return false;
    }
    setSaved(true);
    router.refresh();
    return true;
  };
  // Any other change ends the chance to undo a removal (owner: Undo stays until the next action).
  const run: Run = (what, fn, where) => {
    setUndo(null);
    setMoved(null);
    return runRaw(what.charAt(0).toLowerCase() + what.slice(1), fn, where);
  };

  const move = async (s: Sponsor, dir: "up" | "down") => {
    setUndo(null);
    setMoved(null);
    focusAfter.current = { id: s.id, dir };
    let result: MoveResult | undefined;
    const ok = await runRaw(
      `moving ${s.name}`,
      async () => {
        const r = await moveSponsor(eventId, s.id, dir);
        result = r.result;
        return r;
      },
      s.id,
    );
    if (ok && result?.moved) {
      setMoved({
        id: s.id,
        text: result.crossed
          ? `Moved to ${result.levelName}, ${ordinal(result.place)} of ${result.count}`
          : `Moved to ${ordinal(result.place)} of ${result.count}${levels.length && result.levelName ? ` in ${result.levelName}` : ""}`,
      });
    }
  };

  const toggle = async (s: Sponsor, on: boolean) => {
    setShown((m) => ({ ...m, [s.id]: on }));
    const ok = await run(`${on ? "showing" : "hiding"} ${s.name}`, () => setSponsorShown(eventId, s.id, on), s.id);
    if (!ok)
      setShown((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== s.id)));
  };

  const remove = async (s: Sponsor, confirmed = false) => {
    if (s.presentedBy && !confirmed) {
      setConfirmRemove(s);
      return;
    }
    setConfirmRemove(null);
    setEditing(null);
    setUndo(null);
    setMoved(null);
    const index = sponsors.filter((x) => x.levelId === s.levelId).findIndex((x) => x.id === s.id);
    const ok = await runRaw(`removing ${s.name}`, () => removeSponsor(eventId, s.id), s.id);
    if (ok) setUndo({ sponsor: s, levelId: s.levelId, index });
  };

  const undoRemove = async () => {
    const u = undo;
    if (!u) return;
    let back: boolean | undefined;
    const ok = await runRaw(
      `putting back ${u.sponsor.name}`,
      async () => {
        const r = await restoreSponsor(eventId, u.sponsor.id);
        back = r.presentedBy;
        return r;
      },
      u.sponsor.id,
    );
    if (!ok) return;
    setUndo(null);
    toast(u.sponsor.presentedBy && !back ? `${u.sponsor.name} is back. Another sponsor is Presented by now, so they aren't` : `${u.sponsor.name} is back`);
  };

  const removeLevel = (l: SponsorLevel) => {
    const its = sponsors.filter((s) => s.levelId === l.id);
    const other = levels.find((x) => x.id !== l.id) ?? null;
    if (its.length === 0) void run(`removing the ${l.name} level`, () => removeSponsorLevel(eventId, l.id, other?.id ?? null), "levels");
    else setRemovingLevel(l);
  };

  // The list, live: just-removed sponsors out (their Undo takes their place), switches as just set.
  const list = sponsors.filter((s) => s.id !== undo?.sponsor.id).map((s) => (s.id in shown ? { ...s, showPublic: shown[s.id] } : s));
  const showing = list.filter((s) => s.showPublic).length;
  const hidden = list.length - showing;
  const presents = undo?.sponsor.presentedBy ? null : (list.find((s) => s.presentedBy) ?? null);
  const groups: { level: SponsorLevel | null; li: number; items: Sponsor[] }[] = levels.length
    ? levels.map((l, li) => ({ level: l, li, items: list.filter((s) => s.levelId === l.id) }))
    : [{ level: null, li: 0, items: list }];
  const names = levels.map((l) => l.name);

  const arrowLabels = (s: Sponsor, i: number, n: number, li: number) => ({
    up: i > 0 ? `Move ${s.name} earlier` : li > 0 && levels.length ? `Move ${s.name} up to ${levels[li - 1].name}` : null,
    down: i < n - 1 ? `Move ${s.name} later` : li < levels.length - 1 ? `Move ${s.name} down to ${levels[li + 1].name}` : null,
  });

  const failureIn = (where: string) =>
    failure?.where === where ? (
      <p role="alert" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-danger">
        <span>
          <span aria-hidden>▲ </span>
          {failure.text}
        </span>
        <button type="button" onClick={failure.retry} className="inline-flex min-h-11 items-center rounded-md border-[1.5px] border-danger px-3">
          Try again
        </button>
      </p>
    ) : null;

  const busy = pending > 0;
  const levelsLine = levels.length ? (
    <p className="min-w-0 flex-1 basis-64 text-sm leading-6">
      <span className="font-semibold">Levels:</span> {names.join(", ")} <span className="text-muted">· highest first</span>
    </p>
  ) : (
    <p className="min-w-0 flex-1 basis-64 text-sm leading-6">
      <span className="font-semibold">No levels.</span> <span className="text-muted">Every sponsor shows at the same size.</span>
    </p>
  );

  return (
    <div className="space-y-6">
      <StatusCard mode={mode} kind={words.kind} total={list.length} showing={showing} hidden={hidden} presents={presents} publicUrl={publicUrl} previewHref={previewHref} />

      {yearTwo && lastYear && (
        <Card>
          <h2 className="text-lg font-semibold">Bring back last year&apos;s sponsors and levels</h2>
          <p className="mt-1 text-sm text-muted">
            {lastYear.name} had {plural(lastYear.sponsors, "sponsor")}
            {lastYear.levels ? ` in ${plural(lastYear.levels, "level")}` : ""}. Bring them back with their logos and websites, then change anything.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="button" onClick={() => setReuse("lastYear")}>
              Bring back last year&apos;s sponsors and levels ({plural(lastYear.sponsors, "sponsor")}, {lastYear.levels ? plural(lastYear.levels, "level") : "no levels"})
            </Button>
            <Button type="button" variant="secondary" onClick={() => setFreshStart(true)}>
              Start with your levels
            </Button>
          </div>
        </Card>
      )}

      {firstVisit ? (
        <Card>
          <h2 className="text-lg font-semibold">Start with your levels</h2>
          <p className="mt-1 text-sm text-muted">
            Levels set how big each sponsor&apos;s logo is and the order they&apos;re listed in, highest first. Up to 4. Use the names in your sponsor packet.
          </p>
          <ul className="mt-3 space-y-1 text-sm leading-6">
            {[0, 1, 2, 3].map((r) => (
              <li key={r}>
                <span className="font-semibold">{ordinal(r + 1)} level:</span> {levelGets(r, eventType, ["the 1st level", "the 2nd level", "the 3rd level"])}
              </li>
            ))}
          </ul>
          <LevelsEditor eventId={eventId} eventType={eventType} levels={levels} sponsors={list} run={run} onRemove={removeLevel} primaryAdd />
          {failureIn("levels")}
          <p className="mt-2 text-sm text-muted">Add the next level after this one. You can rename and reorder them any time.</p>
          <div className="mt-3 border-t border-border pt-2">
            <Button
              type="button"
              variant="ghost"
              className="px-0!"
              onClick={() => {
                setSkipped(true);
                setLevelSetup(false);
              }}
            >
              Skip levels (all sponsors the same size)
            </Button>
          </div>
        </Card>
      ) : levelSetup && levels.length > 0 ? (
        <Card>
          <h2 className="text-lg font-semibold">Your levels</h2>
          <p className="mt-1 text-sm text-muted">Highest first, up to 4. Each change saves as you go. Add the next one, or carry on to your sponsors.</p>
          <LevelsEditor eventId={eventId} eventType={eventType} levels={levels} sponsors={list} run={run} onRemove={removeLevel} primaryAdd />
          {failureIn("levels")}
          <div className="mt-4 border-t border-border pt-3">
            <Button type="button" variant="secondary" onClick={() => setLevelSetup(false)}>
              Done with levels
            </Button>
          </div>
        </Card>
      ) : (
        !yearTwo && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              {levelsLine}
              <Button type="button" variant="secondary" onClick={() => setLevelsOpen(true)}>
                {levels.length ? "Change levels" : "Add levels"}
              </Button>
            </div>
            {failureIn("levels")}
          </Card>
        )
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Sponsors</h2>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={firstVisit || yearTwo || (levelSetup && levels.length > 0) ? "secondary" : "primary"} onClick={() => setEditing("new")}>
              Add a sponsor
            </Button>
            {sources.length > 0 && (
              <Button type="button" variant="secondary" onClick={() => setReuse("other")}>
                Add sponsors from other events
              </Button>
            )}
          </div>
        </div>
        {failureIn("page")}
        {list.length === 0 && !undo ? (
          <p className="mt-3 text-sm leading-6">
            <span className="font-semibold">No sponsors yet.</span> <span className="text-muted">Nothing shows on your public page until you add one.</span>
          </p>
        ) : (
          groups.map((g) => {
            const n = g.items.length;
            const hid = g.items.filter((s) => !s.showPublic).length;
            const rows: ReactNode[] = g.items.map((s, i) => {
              const a = arrowLabels(s, i, n, g.li);
              return (
                <SponsorRow
                  key={s.id}
                  eventId={eventId}
                  s={s}
                  up={a.up}
                  down={a.down}
                  onMove={(dir) => move(s, dir)}
                  onToggle={(on) => toggle(s, on)}
                  onEdit={() => setEditing(s)}
                  moved={moved?.id === s.id ? moved.text : null}
                  failure={failureIn(s.id)}
                  disabled={busy}
                />
              );
            });
            if (undo && undo.levelId === (g.level?.id ?? null)) {
              rows.splice(
                Math.min(undo.index, rows.length),
                0,
                <li key={`undo-${undo.sponsor.id}`} role="status" className="-mx-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-brand-soft px-3 py-3">
                  <span className="min-w-0 flex-1 basis-56 text-sm">
                    <span className="font-semibold">{undo.sponsor.name} is removed,</span> logo and all{undo.sponsor.presentedBy ? ", and so is the Presented by line" : ""}.
                  </span>
                  <Button ref={undoButton} type="button" variant="secondary" onClick={undoRemove} disabled={busy}>
                    Undo<span className="sr-only"> removing {undo.sponsor.name}</span>
                  </Button>
                  {failureIn(undo.sponsor.id)}
                </li>,
              );
            }
            return (
              <div key={g.level?.id ?? "all"} className="mt-6">
                {g.level && (
                  <div className="border-b border-border pb-2">
                    <h3 className="text-base font-semibold">
                      {g.level.name}{" "}
                      <span className="font-normal text-muted">
                        · {plural(n, "sponsor")}
                        {hid ? `, ${hid} hidden` : ""}
                      </span>
                    </h3>
                    <p className="text-sm text-muted">Gets {levelGets(g.li, eventType, names)}</p>
                  </div>
                )}
                {rows.length === 0 ? (
                  <p className="py-3 text-sm text-muted">No sponsors at this level yet</p>
                ) : (
                  <ol className="divide-y divide-border">{rows}</ol>
                )}
              </div>
            );
          })
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-64">
            <h2 className="text-lg font-semibold">Presented by</h2>
            <p className="text-sm leading-6">
              {presents ? (
                <>
                  {presents.name}
                  {!presents.showPublic && <span className="text-muted"> · hidden, so the line doesn&apos;t show</span>}
                </>
              ) : undo?.sponsor.presentedBy ? (
                <span className="text-muted">Nobody until you Undo or Change</span>
              ) : (
                <span className="text-muted">Nobody yet. One sponsor&apos;s logo and name can show under your {words.kind}&apos;s name</span>
              )}
            </p>
          </div>
          {list.length ? (
            <Button type="button" variant="secondary" onClick={() => setPresentedOpen(true)}>
              Change<span className="sr-only"> Presented by</span>
            </Button>
          ) : (
            <span className="text-sm text-muted">Add a sponsor first</span>
          )}
        </div>
        {failureIn("presented")}
      </Card>

      <Card>
        <dl className="grid gap-3 text-sm leading-6 sm:grid-cols-2">
          <div>
            <dt className="font-semibold">Where sponsors show</dt>
            <dd className="text-muted">
              Your public event page: Presented by under its name, and the thank-you section near the end. On {words.day}, one line at the end of {words.live}.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Where they never show</dt>
            <dd className="text-muted">{words.never}. Nothing counts who sees or taps them.</dd>
          </div>
          {eventType === "fair" && (
            <div className="sm:col-span-2">
              <dt className="font-semibold">Booth hosts</dt>
              <dd className="text-muted">
                The thank-you section also thanks your booth hosts as community partners, by name. A business that&apos;s a sponsor and a booth host shows once, as a
                sponsor.
              </dd>
            </div>
          )}
        </dl>
      </Card>

      <div className="sticky bottom-[var(--day-bar,0px)] z-10 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border-t-2 border-border bg-surface px-4 py-3 text-sm shadow-[0_-6px_16px_rgb(0_0_0/0.10)] sm:px-6">
        <div className="min-w-0 flex-1" role="status">
          {busy ? (
            <p className="text-muted">Saving…</p>
          ) : failure ? (
            <p className="font-semibold text-danger">
              <span aria-hidden>▲ </span>Not saved<span className="max-sm:hidden">. {failure.where === "page" || failure.where === "levels" || failure.where === "presented" ? "See the note above" : "See the note in its row"}</span>
            </p>
          ) : saved ? (
            <p className="font-medium">
              <span aria-hidden className="text-success">
                ✓{" "}
              </span>
              Saved
              {/* One line on phones (pattern 13): the rest from tablet up. */}
              <span className="max-sm:hidden">{mode === "draft" ? ". Sponsors show when you publish." : ". Changes show on the public page right away."}</span>
            </p>
          ) : (
            <p className="text-muted">
              Saves as you go{list.length === 0 && <span className="max-sm:hidden">. Nothing shows until you add a sponsor.</span>}
            </p>
          )}
        </div>
        {stepped && (
          <Link
            href={`/dashboard/events/${eventId}#publish`}
            className="ml-auto inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:bg-background"
          >
            Next up:&nbsp;Publish →
          </Link>
        )}
      </div>

      {editing && (
        <SponsorWindow
          key={editing === "new" ? "new" : editing.id}
          eventId={eventId}
          eventName={eventName}
          eventType={eventType}
          levels={levels}
          sponsors={list}
          sponsor={editing === "new" ? null : editing}
          from={from}
          group={group}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setUndo(null);
            setFailure(null);
            setSaved(true);
            toast(message);
            router.refresh();
          }}
          onRemove={(s) => void remove(s)}
        />
      )}
      {confirmRemove && (
        <ConfirmWindow
          title={`Remove ${confirmRemove.name}?`}
          keepLabel={`Keep ${confirmRemove.name}`}
          actionLabel={`Remove ${confirmRemove.name}`}
          onKeep={() => setConfirmRemove(null)}
          onConfirm={() => void remove(confirmRemove, true)}
        >
          <ul className="list-disc space-y-2 pl-5">
            <li>They&apos;re Presented by, so the Presented by line under your {words.kind}&apos;s name goes too</li>
            <li>Their tile leaves the thank-you section</li>
            <li>Undo puts them back, Presented by too, until your next change</li>
          </ul>
        </ConfirmWindow>
      )}
      {levelsOpen && (
        <Window
          title="Levels"
          onClose={() => setLevelsOpen(false)}
          actions={
            <Button type="button" variant="secondary" onClick={() => setLevelsOpen(false)}>
              Done
            </Button>
          }
        >
          <p className="text-muted">Highest first, up to 4. Each change saves as you go. What each level gets on the public page is under its name.</p>
          {levels.length === 0 && list.length > 0 && <p>Your first level takes all {plural(list.length, "sponsor")} so far. You can move them after.</p>}
          <LevelsEditor eventId={eventId} eventType={eventType} levels={levels} sponsors={list} run={run} onRemove={removeLevel} />
          {failureIn("levels")}
        </Window>
      )}
      {removingLevel && (
        <RemoveLevelWindow
          level={removingLevel}
          levels={levels}
          sponsors={list}
          onKeep={() => setRemovingLevel(null)}
          onRemove={(to) => {
            const l = removingLevel;
            setRemovingLevel(null);
            const toName = levels.find((x) => x.id === to)?.name;
            void run(`removing the ${l.name} level${toName ? ` and moving its sponsors to ${toName}` : ""}`, () => removeSponsorLevel(eventId, l.id, to), "levels");
          }}
        />
      )}
      {presentedOpen && (
        <PresentedWindow
          eventId={eventId}
          kind={words.kind}
          day={words.day}
          sponsors={list}
          current={presents}
          onClose={() => setPresentedOpen(false)}
          onSave={(id) => {
            setPresentedOpen(false);
            const who = list.find((s) => s.id === id)?.name;
            void run(who ? `making ${who} Presented by` : "clearing Presented by", () => setPresentedBy(eventId, id), "presented");
          }}
        />
      )}
      {reuse && (
        <ReuseWindow
          eventId={eventId}
          sources={reuse === "lastYear" && lastYear ? [lastYear] : sources}
          levels={levels}
          yearTwo={reuse === "lastYear"}
          onClose={() => setReuse(null)}
          onDone={(message) => {
            setReuse(null);
            setUndo(null);
            setSaved(true);
            setLevelSetup(false);
            toast(message);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** Where sponsors stand on the public page: published, a draft, after the event (pattern 19). */
function StatusCard({
  mode,
  kind,
  total,
  showing,
  hidden,
  presents,
  publicUrl,
  previewHref,
}: {
  mode: SponsorsMode;
  kind: string;
  total: number;
  showing: number;
  hidden: number;
  presents: Sponsor | null;
  publicUrl: string;
  previewHref: string;
}) {
  const by = presents?.showPublic ? ` · Presented by ${presents.name}` : "";
  const badge =
    mode === "draft" ? (
      <Badge tone="neutral">Shows when you publish</Badge>
    ) : total === 0 || showing === 0 ? (
      <Badge tone="neutral">Not on the public page yet</Badge>
    ) : (
      <Badge tone="live">On the public page</Badge>
    );
  const line =
    total === 0
      ? "Nothing shows until you add a sponsor"
      : mode === "draft"
        ? `${plural(showing, "sponsor")} set to show${hidden ? `, ${hidden} hidden` : ""}${by}`
        : showing === 0
          ? `Every sponsor is hidden (${hidden}), so nothing shows`
          : `${showLine(showing, hidden)}${by}`;
  return (
    <Card>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        {badge}
        <span className="text-muted">{line}</span>
      </p>
      {mode === "after" && (
        <p className="mt-2 text-sm">
          The {kind} is over. The thank-you stays on your public page; the live line ended with the day.
        </p>
      )}
      {mode === "draft" && <p className="mt-2 text-sm">Your public link works once you publish. Until then, Preview shows the page as families will see it.</p>}
      <div className="mt-4">
        {mode !== "draft" && <p className="text-sm break-all text-muted">{publicUrl.replace(/^https?:\/\//, "")}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {mode !== "draft" && <CopyLink url={publicUrl} className={OUTLINE} ariaLabel="Copy the public page's link" />}
          <a href={previewHref} target="_blank" rel="noopener" className={OUTLINE}>
            Preview the public page
            <span aria-hidden className="ml-1">
              ↗
            </span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </Card>
  );
}

/** One sponsor: arrows (fixed columns), logo, name and link, Show on the public page, and Edit. */
function SponsorRow({
  eventId,
  s,
  up,
  down,
  onMove,
  onToggle,
  onEdit,
  moved,
  failure,
  disabled,
}: {
  eventId: string;
  s: Sponsor;
  up: string | null;
  down: string | null;
  onMove: (dir: "up" | "down") => void;
  onToggle: (on: boolean) => void;
  onEdit: () => void;
  moved: string | null;
  failure: ReactNode;
  disabled: boolean;
}) {
  return (
    <li className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 py-3 ${moved ? "-mx-2 rounded-md bg-brand-soft px-2" : ""}`}>
      <div className="grid grid-cols-2 gap-1 self-start">
        <ArrowButton dir="up" label={up} data={`${s.id}-up`} firstLast={`${s.name} is first`} onClick={() => !disabled && onMove("up")} />
        <ArrowButton dir="down" label={down} data={`${s.id}-down`} firstLast={`${s.name} is last`} onClick={() => !disabled && onMove("down")} />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <LogoThumb src={organizerSponsorLogoUrl(eventId, s.logoVersion, "t2")} width={s.logoWidth} height={s.logoHeight} name={s.name} />
        <div className="min-w-0 flex-1 basis-40">
          <p className="flex flex-wrap items-center gap-2 font-medium [overflow-wrap:anywhere]">
            {s.name}
            {s.presentedBy && <Badge tone="info">Presented by</Badge>}
            {!s.showPublic && <Badge tone="neutral">Hidden</Badge>}
          </p>
          <p className="text-sm text-muted [overflow-wrap:anywhere]">{s.website ? displayLink(s.website) : "No link"}</p>
          {moved && (
            <p role="status" className="text-sm font-medium">
              <span aria-hidden className="text-success">
                ✓{" "}
              </span>
              {moved}
            </p>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 lg:w-auto">
          <div>
            <button type="button" role="switch" aria-checked={s.showPublic} onClick={() => onToggle(!s.showPublic)} className="inline-flex min-h-11 items-center gap-2.5 text-left">
              <span
                aria-hidden
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 ${s.showPublic ? "border-brand bg-brand" : "border-field-border bg-background"}`}
              >
                <span className={`absolute size-4 rounded-full ${s.showPublic ? "left-[22px] bg-brand-foreground" : "left-[3px] bg-field-border"}`} />
              </span>
              <span className="text-sm">
                Show <span className="sr-only">{s.name} </span>on the public page
              </span>
            </button>
            {s.presentedBy && (
              <p className="text-xs leading-5 text-muted">{s.showPublic ? "Hiding them also hides the Presented by line" : "Hidden, so the Presented by line doesn't show"}</p>
            )}
          </div>
          <Button type="button" variant="secondary" onClick={onEdit}>
            Edit<span className="sr-only"> {s.name}</span>
          </Button>
        </div>
        {failure && <div className="w-full">{failure}</div>}
      </div>
    </li>
  );
}

/** Presented by (from Change): one showing sponsor, or nobody, with how it shows. */
function PresentedWindow({
  eventId,
  kind,
  day,
  sponsors,
  current,
  onClose,
  onSave,
}: {
  eventId: string;
  kind: string;
  day: string;
  sponsors: Sponsor[];
  current: Sponsor | null;
  onClose: () => void;
  onSave: (id: string | null) => void;
}) {
  const [pick, setPick] = useState(current?.id ?? "");
  const options = sponsors.filter((s) => s.showPublic || s.id === current?.id);
  const s = sponsors.find((x) => x.id === pick) ?? null;
  const logo = s ? organizerSponsorLogoUrl(eventId, s.logoVersion, "t1") : null;
  const hiddenCount = sponsors.filter((x) => !x.showPublic && x.id !== current?.id).length;
  return (
    <Window
      title="Presented by"
      onClose={onClose}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onSave(pick || null)} disabled={(pick || null) === (current?.id ?? null)}>
            Save
          </Button>
        </>
      }
    >
      <Field
        label="Presented by"
        hint={`One sponsor's logo and name show under your ${kind}'s name, on the public page and on ${day}.${hiddenCount ? ` Hidden sponsors can't be picked (${listAnd(sponsors.filter((x) => !x.showPublic && x.id !== current?.id).map((x) => x.name))}).` : ""}`}
      >
        <Select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Nobody</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.showPublic ? "" : " (hidden)"}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <p className="mb-1 text-xs">How it shows</p>
        <div className="rounded-md border border-border bg-background px-3">
          {s ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="text-sm text-muted">Presented by</span>
              <span className="inline-flex min-h-11 items-center gap-2.5">
                {logo && s.logoWidth && s.logoHeight && (
                  <span className={`flex h-16 w-44 shrink-0 items-center justify-center rounded-md px-2 py-1.5 ${LOGO_TILE}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- our own resized copy */}
                    <img src={logo} alt="" className="max-h-full max-w-full object-contain" />
                  </span>
                )}
                <span className={`font-semibold [overflow-wrap:anywhere] ${s.website ? "underline underline-offset-4" : ""}`}>{s.name}</span>
              </span>
            </p>
          ) : (
            <p className="py-3 text-sm text-muted">No Presented by line</p>
          )}
        </div>
      </div>
    </Window>
  );
}


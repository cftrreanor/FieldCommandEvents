"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { currentChecklist } from "@/app/dashboard/events/[eventId]/setup-actions";
import type { SetupChecklist, SetupStep } from "@/lib/setup-checklist";

/**
 * The host's setup checklist on the event page: a sticky panel beside it on
 * a computer, and a light bar along the bottom of a phone (showing the next
 * step) that slides up a drawer.
 */
export function SetupGuide({ checklist }: { checklist: SetupChecklist }) {
  const drawer = useRef<HTMLDialogElement>(null);
  const { progress, complete } = checklist;
  const { justDone, celebrate } = useJustDone(checklist, true);

  return (
    <>
      {/* Computer: beside the page, staying in view as you scroll. */}
      <aside aria-label="Event setup checklist" className="hidden lg:block">
        <ScrollPanel header={complete ? null : <StepsHeader checklist={checklist} />}>
          {complete ? (
            // Everything's done: a small note, with the list a tap away.
            <details>
              <summary className="cursor-pointer list-none text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <span className="text-success">✓</span> Setup complete
                <span className="mt-1 block text-xs font-normal text-muted">Show the checklist</span>
              </summary>
              <div className="mt-3">
                <Steps checklist={checklist} justDone={justDone} compact />
              </div>
            </details>
          ) : (
            <Steps checklist={checklist} justDone={justDone} header={false} compact />
          )}
        </ScrollPanel>
      </aside>

      {/* Phone and tablet: a light bar along the bottom with the next step; it opens the drawer. */}
      {!complete && (
        <div data-setup-bar className="fixed inset-x-0 bottom-0 z-30 border-t border-field-border bg-surface shadow-[0_-4px_12px_rgb(0_0_0/0.08)] lg:hidden print:hidden">
          <div className="mx-auto max-w-2xl">
          <Segments segments={checklist.segments} className="px-4 pt-2.5" />
          <button
            type="button"
            onClick={() => drawer.current?.showModal()}
            aria-haspopup="dialog"
            className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left"
          >
            <span className="min-w-0" aria-live="polite">
              <span className="block text-xs text-muted">Event setup · {progress.label}</span>
              <span className="block truncate text-sm font-semibold">{headline(checklist, celebrate)}</span>
            </span>
            <span aria-hidden className="text-lg text-brand">
              ›
            </span>
          </button>
          </div>
        </div>
      )}
      <ChecklistDrawer drawer={drawer} checklist={checklist} justDone={justDone} />
    </>
  );
}

/**
 * The computer panel: stays in view as the page scrolls. Its heading and progress stay put at the top;
 * the steps under them scroll on their own when they're taller than the screen, with a fade at the top
 * while there's more above and a fade with "More below" while there's more below. The list fits what's
 * left of the screen (shorter before the page scrolls), so its bottom edge is always in view.
 */
function ScrollPanel({ header, children }: { header: ReactNode; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ above: false, below: false });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const top = Math.max(el.getBoundingClientRect().top, 24);
      el.style.maxHeight = `${Math.max(window.innerHeight - top - 24, 160)}px`;
      const above = el.scrollTop > 8;
      const below = el.scrollHeight - el.scrollTop - el.clientHeight > 8;
      setEdges((e) => (e.above === above && e.below === below ? e : { above, below }));
    };
    fit();
    el.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    const ro = new ResizeObserver(fit);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", fit);
      window.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
      ro.disconnect();
    };
  }, []);
  return (
    <div className="sticky top-6 rounded-lg border border-border bg-surface shadow-card">
      {header && <div className="border-b border-border px-5 pt-5 pb-4">{header}</div>}
      <div className="relative">
        {/* Focusable, so the keyboard can scroll it (Page Down, arrows); focus stops clear of the fades. */}
        <div
          ref={box}
          tabIndex={0}
          role="region"
          aria-label="Setup steps"
          className={`scroll-pt-8 scroll-pb-20 overflow-y-auto rounded-b-lg px-5 pb-5 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${header ? "" : "rounded-t-lg pt-5"}`}
        >
          <div>{children}</div>
        </div>
        {edges.above && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-surface to-transparent" />}
        {edges.below && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 flex h-20 items-end justify-center rounded-b-lg bg-gradient-to-t from-surface from-50% to-transparent pb-3 text-sm font-semibold text-brand"
          >
            More below ↓
          </div>
        )}
      </div>
    </div>
  );
}

/** The bar's main line: a step just finished, a step part-way, or the next one. */
function headline(c: SetupChecklist, celebrate: SetupStep | null) {
  if (celebrate) return celebrate.id === "publish" ? "✓ Published · Your event is live" : `✓ Done: ${celebrate.label}`;
  if (c.inProgress) return `In progress: ${c.inProgress.label}`;
  return c.next ? `Next: ${c.next.label}` : "See the checklist";
}

/**
 * Steps finished since this browser last looked (remembered per event), so
 * each one gets its small moment once: when it's done here, or when the host
 * comes back later. The first visit only remembers; nothing plays.
 */
function useJustDone(checklist: SetupChecklist, enabled: boolean) {
  const [justDone, setJustDone] = useState<Set<string>>(() => new Set());
  const [celebrate, setCelebrate] = useState<SetupStep | null>(null);
  const steps = [...checklist.before, checklist.publish, ...checklist.after];
  const doneIds = steps
    .filter((st) => st.done)
    .map((st) => st.id)
    .join(",");
  const stepsRef = useRef(steps);
  useEffect(() => {
    stepsRef.current = steps;
  });

  useEffect(() => {
    if (!enabled) return;
    const key = `fc-setup-done:${checklist.eventId}`;
    const now = doneIds ? doneIds.split(",") : [];
    let seen: string[] | null = null;
    try {
      const raw = localStorage.getItem(key);
      seen = raw ? (JSON.parse(raw) as string[]) : null;
      localStorage.setItem(key, JSON.stringify(now));
    } catch {
      return; // No storage (private window): no moments, nothing else changes.
    }
    const fresh = seen ? now.filter((id) => !seen.includes(id)) : [];
    if (!fresh.length) return;
    const frame = requestAnimationFrame(() => {
      setJustDone((prev) => new Set([...prev, ...fresh]));
      setCelebrate(stepsRef.current.find((st) => st.id === fresh[fresh.length - 1]) ?? null);
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, checklist.eventId, doneIds]);

  // The bar says so for a few seconds, then goes back to what's next.
  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setCelebrate(null), 4500);
    return () => clearTimeout(t);
  }, [celebrate]);

  return { justDone, celebrate };
}

/** Pages where the host is running the day, not setting up: no setup bar there. */
const DAY_SCREENS = ["/contest-day", "/event-day", "/volunteers", "/conferences/meetings"];

/**
 * On every other page of the event: one slim line with where setup stands and
 * the next step, kept current as the host moves between pages. Sits above the
 * page (not pinned), so it never covers a page's own Save or Publish bar.
 */
export function SetupStrip({
  eventId,
  initial,
  skip = [],
}: {
  eventId: string;
  initial: SetupChecklist;
  /** Pages (after the event's own path) that show their own steps instead: a volunteer event's Details and Jobs and shifts. */
  skip?: readonly string[];
}) {
  const pathname = usePathname();
  const [checklist, setChecklist] = useState(initial);
  // Saving on this page refreshes the layout: take the new checklist straight away.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setChecklist(initial);
  }
  const base = `/dashboard/events/${eventId}`;
  // The guided setup (Event settings, ?setup=1) has its own steps along the top.
  const guided = useSearchParams().get("setup") === "1";
  const hidden =
    guided || pathname === base || pathname === `${base}/duplicate` || DAY_SCREENS.some((p) => pathname.startsWith(`${base}${p}`)) || skip.some((p) => pathname === `${base}${p}`);

  // Each page change: read it again, so a step finished on the last page shows as done.
  useEffect(() => {
    if (hidden) return;
    let live = true;
    currentChecklist(eventId).then((c) => {
      if (live && c) setChecklist(c);
    });
    return () => {
      live = false;
    };
  }, [eventId, pathname, hidden]);

  if (hidden || checklist.complete) return null;
  return <StripBar checklist={checklist} pathname={pathname} />;
}

function StripBar({ checklist, pathname }: { checklist: SetupChecklist; pathname: string }) {
  const drawer = useRef<HTMLDialogElement>(null);
  const { justDone, celebrate } = useJustDone(checklist, true);
  const { progress, inProgress } = checklist;
  // Part-way through something? That's where to pick up; otherwise, what's next.
  const next = inProgress ?? checklist.next;
  const here = next && next.href.split(/[?#]/)[0] === pathname;
  return (
    <>
      <div className="mb-5 overflow-hidden rounded-lg border border-border bg-surface text-sm print:hidden">
        <div className="flex items-center gap-3 px-3 py-2 sm:px-4">
          <p className="min-w-0 flex-1 leading-6" aria-live="polite">
            <span className="font-semibold">Setup</span> <span className="text-muted">· {progress.label}</span>
            {celebrate && (
              <span className="block truncate font-medium text-success sm:ml-1 sm:inline">
                <span className="hidden text-muted sm:inline">· </span>
                {celebrate.id === "publish" ? "✓ Published · Your event is live" : `✓ Done: ${celebrate.label}`}
              </span>
            )}
            {!celebrate && next && (
              <span className="block truncate sm:ml-1 sm:inline">
                <span className="hidden text-muted sm:inline">· </span>
                {here ? (
                  <span>
                    <span className="text-muted">{inProgress ? "You're picking up:" : "You're on the next step:"}</span>{" "}
                    <span className="font-medium">{next.label}</span>
                  </span>
                ) : inProgress ? (
                  <>
                    <span className="text-muted">In progress:</span> <span className="font-medium">{inProgress.label}</span>
                    {inProgress.partial && <span className="text-muted"> ({inProgress.partial.note})</span>}{" "}
                    <Link href={inProgress.href} className="font-semibold text-brand underline-offset-4 hover:underline">
                      Continue →
                    </Link>
                  </>
                ) : (
                  <>
                    <span className="text-muted">Next:</span>{" "}
                    <Link href={next.href} className="font-medium text-brand underline-offset-4 hover:underline">
                      {next.label}
                    </Link>
                  </>
                )}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => drawer.current?.showModal()}
            aria-haspopup="dialog"
            className="inline-flex min-h-10 shrink-0 items-center rounded-md px-2 font-medium text-brand hover:bg-brand-soft"
          >
            Checklist <span aria-hidden>&nbsp;›</span>
          </button>
        </div>
        <Segments segments={checklist.segments} className="px-3 pb-2.5 sm:px-4" />
      </div>
      <ChecklistDrawer drawer={drawer} checklist={checklist} justDone={justDone} everywhere />
    </>
  );
}

/** One segment per step that counts: green when done, part-filled blue when started, gray when not. */
function Segments({ segments, className = "" }: { segments: SetupChecklist["segments"]; className?: string }) {
  return (
    <div className={`flex gap-1 ${className}`} aria-hidden>
      {segments.map((sg) => (
        <span key={sg.id} className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
          <span
            className={`block h-full rounded-full transition-[width] duration-700 ease-out ${sg.state === "done" ? "bg-success" : "bg-brand"}`}
            style={{ width: `${Math.round(sg.fraction * 100)}%` }}
          />
        </span>
      ))}
    </div>
  );
}

/** The full checklist in a sheet that slides up (phones), or a centered panel (computers, from the strip). */
function ChecklistDrawer({
  drawer,
  checklist,
  justDone,
  everywhere = false,
}: {
  drawer: RefObject<HTMLDialogElement | null>;
  checklist: SetupChecklist;
  justDone: Set<string>;
  /** Opened from the strip, so on computers too. */
  everywhere?: boolean;
}) {
  return (
    <dialog
      ref={drawer}
      aria-label="Event setup checklist"
      onClick={(e) => e.target === e.currentTarget && drawer.current?.close()}
      className={`mx-0 mt-auto mb-0 max-h-[85vh] w-full max-w-none overflow-y-auto rounded-t-2xl border border-border bg-surface p-0 text-foreground shadow-elevated backdrop:bg-[#071a31]/50 ${
        everywhere ? "sm:m-auto sm:max-w-md sm:rounded-2xl" : "lg:hidden"
      }`}
    >
      <div className="px-5 pb-8 pt-3">
        <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border sm:hidden" />
        <div className="flex justify-end">
          <button type="button" onClick={() => drawer.current?.close()} className="min-h-11 rounded-md px-3 text-sm font-medium text-muted hover:text-foreground">
            Close
          </button>
        </div>
        <Steps checklist={checklist} justDone={justDone} onNavigate={() => drawer.current?.close()} />
      </div>
    </dialog>
  );
}

/** Steps done in event settings (the date and place, the team, maps and documents), listed in their own section. */
const SETTINGS_STEPS = new Set(["details", "team", "files"]);

/** The checklist's title and where setup stands. */
function StepsHeader({ checklist }: { checklist: SetupChecklist }) {
  return (
    <>
      <h2 className="text-lg font-semibold">Event setup</h2>
      <p className="mt-1 text-sm text-muted">{checklist.progress.label}</p>
      <Segments segments={checklist.segments} className="mt-3" />
    </>
  );
}

function Steps({
  checklist,
  justDone,
  onNavigate,
  header = true,
  compact = false,
}: {
  checklist: SetupChecklist;
  justDone: Set<string>;
  onNavigate?: () => void;
  /** The narrow computer panel: a step's description shows on the next step only. */
  compact?: boolean;
  /** The title and progress (left out where they're pinned above the list). */
  header?: boolean;
}) {
  // The bars point to a step that's part-way first, so "Next" sits on the same one here.
  const props = { next: checklist.inProgress ?? checklist.next, justDone, onNavigate, compact };
  const setup = checklist.before.filter((st) => !SETTINGS_STEPS.has(st.id));
  const settings = checklist.before.filter((st) => SETTINGS_STEPS.has(st.id));
  return (
    <div>
      {/* Two sections with the same heading: what's done on the event's pages, then what's done in event settings. */}
      {header && <StepsHeader checklist={checklist} />}

      {setup.length > 0 && <Group title="Before you publish" steps={setup} {...props} />}
      {/* Publishing is the step between the two lists, not a list of its own. */}
      <ol className="mt-4 border-y border-border py-2">
        <Step step={checklist.publish} {...props} />
      </ol>
      {checklist.after.length > 0 && <Group title="After you publish" steps={checklist.after} {...props} />}

      {settings.length > 0 && (
        <div className="mt-5 border-t border-border pt-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Event settings</h2>
            <Link href={`/dashboard/events/${checklist.eventId}/edit`} onClick={onNavigate} className="shrink-0 text-sm font-medium text-brand underline-offset-4 hover:underline">
              Open →
            </Link>
          </div>
          {/* All shown, done or not: it's a short list, and the date and place may still be needed to publish. */}
          <ol className="mt-2 space-y-1">
            {settings.map((st) => (
              <Step key={st.id} step={st} {...props} />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** Settings steps sit apart from the main list, so the ones publishing waits on say so. */
const NEEDED_PILL = new Set(["details"]);

type StepProps = { next: SetupStep | null; justDone: Set<string>; onNavigate?: () => void; compact?: boolean };

/** Open steps first (and any just finished, so its moment is seen); the rest fold into one line you can open. */
function Group({ title, steps, ...props }: { title: string; steps: SetupStep[] } & StepProps) {
  const open = steps.filter((st) => !st.done || props.justDone.has(st.id));
  const done = steps.filter((st) => st.done && !props.justDone.has(st.id));
  return (
    <div className="mt-5">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {open.length > 0 && (
        <ol className="mt-2 space-y-1">
          {open.map((st) => (
            <Step key={st.id} step={st} {...props} />
          ))}
        </ol>
      )}
      {done.length > 0 && (
        <details className="mt-1">
          <summary className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-muted hover:bg-brand-soft">
            <StatusRing step={{ done: true }} />
            {done.length} done · <span className="font-medium text-brand">Show</span>
          </summary>
          <ol className="mt-1 space-y-1">
            {done.map((st) => (
              <Step key={st.id} step={st} {...props} />
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

const RING = 2 * Math.PI * 8;

/**
 * A step's circle: an empty ring to do, a blue ring filled part way when
 * started, and a green check when done (which sweeps closed and draws in,
 * once, when the step has just been finished).
 */
function StatusRing({ step, justDone = false }: { step: Pick<SetupStep, "done" | "partial">; justDone?: boolean }) {
  const arc = (color: string, fraction: number, className?: string, style?: CSSProperties) => (
    <circle
      className={className}
      cx="10"
      cy="10"
      r="8"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeDasharray={RING}
      strokeDashoffset={RING * (1 - fraction)}
      transform="rotate(-90 10 10)"
      style={style}
    />
  );
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={`mt-0.5 size-5 shrink-0 overflow-visible ${justDone ? "setup-just-done" : ""}`}>
      {step.done ? (
        <>
          {justDone && arc("var(--success)", 1, "setup-sweep")}
          <circle className="setup-fill" cx="10" cy="10" r="9" fill="var(--success)" />
          <path
            className="setup-check"
            d="M6.2 10.4l2.6 2.6 5-5.4"
            fill="none"
            stroke="var(--success-foreground)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          {/* Started: a light track so the blue part reads; not started: a firmer gray ring. */}
          <circle cx="10" cy="10" r="8" fill="none" stroke={step.partial ? "var(--border)" : "var(--field-border)"} strokeWidth="2" />
          {step.partial && arc("var(--brand)", step.partial.fraction)}
        </>
      )}
    </svg>
  );
}

function Step({ step: st, next, justDone, onNavigate, compact = false }: { step: SetupStep } & StepProps) {
  const isNext = next?.id === st.id;
  return (
    <li>
      <Link
        href={st.href}
        onClick={onNavigate}
        aria-current={isNext ? "step" : undefined}
        className={`flex min-h-11 items-start gap-3 rounded-md px-2 py-2 ${isNext ? "bg-brand-soft ring-1 ring-brand/30" : "hover:bg-brand-soft"}`}
      >
        {/* Status only: the whole row is a link to where the step is done. */}
        <StatusRing step={st} justDone={justDone.has(st.id)} />
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-medium ${st.done ? "text-muted" : ""}`}>
            {st.label}
            <span className="sr-only">{st.done ? " (done)" : st.partial ? " (in progress)" : " (to do)"}</span>
          </span>
          {/* Pills on their own row, so they wrap inside the narrow sidebar instead of running past its edge. */}
          {(isNext || (!st.done && (!st.required || NEEDED_PILL.has(st.id)))) && (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {isNext && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-brand-foreground">Next</span>}
              {st.required && !st.done && NEEDED_PILL.has(st.id) && (
                <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">Needed to publish</span>
              )}
              {!st.required && !st.done && (
                <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold text-muted ring-1 ring-border">
                  {st.due ?? "Optional"}
                </span>
              )}
            </span>
          )}
          {!st.done &&
            (st.partial ? (
              <span className="mt-0.5 block text-xs leading-5">
                <span className="font-semibold text-brand">In progress</span> <span className="text-muted">· {st.partial.note}</span>
              </span>
            ) : (
              (!compact || isNext) && <span className="mt-0.5 block text-xs leading-5 text-muted">{st.hint}</span>
            ))}
        </span>
        {!st.done && (
          <span aria-hidden className="mt-0.5 shrink-0 text-brand">
            →
          </span>
        )}
      </Link>
    </li>
  );
}

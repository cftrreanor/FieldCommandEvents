"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import type { DayAction, DayActions, DayIcon } from "@/lib/event-day-actions";

/**
 * On the day of the event, the jobs of the day are always one tap away:
 * on the event page, a panel beside it (where the setup checklist was);
 * on its other pages, a row of buttons at the top; and on a phone, a tab bar
 * along the bottom of every page of the event.
 */
const pathOf = (href: string) => href.split("#")[0];
const routeOf = (href: string) => pathOf(href).split("?")[0];
const onPath = (href: string, pathname: string) => pathname === routeOf(href) || pathname.startsWith(`${routeOf(href)}/`);

/** The job whose page this is (the first, when two jobs share a page). */
function useHere(day: DayActions) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  // A sign-up's own button when its tab is open; otherwise the first job on this page.
  const here = (day.actions.find((a) => pathOf(a.href) === `${pathname}${search ? `?${search}` : ""}`) ?? day.actions.find((a) => onPath(a.href, pathname)))?.id;
  return { pathname, isHere: (a: DayAction) => a.id === here };
}

/**
 * After following a job's link, bring its part of the page into view and
 * open it if it's folded away (like "Push the schedule back"). The page may
 * still be loading, so keep looking for a moment.
 */
function openTarget(href: string) {
  const id = href.split("#")[1];
  if (!id) return;
  let tries = 0;
  const look = () => {
    const el = document.getElementById(id);
    if (!el) {
      if (tries++ < 40) setTimeout(look, 100);
      return;
    }
    const details = el instanceof HTMLDetailsElement ? el : el.querySelector("details");
    if (details) details.open = true;
    // A button that opens a window (Event day's "Push the schedule back", hidden on phones where this bar has it).
    el.querySelector<HTMLButtonElement>("[data-opens-from-bar]")?.click();
    el.scrollIntoView({ block: "start" });
  };
  look();
}

/** Computer, event page: the day's jobs, big, beside the page. */
export function DayRail({ day }: { day: DayActions }) {
  const { isHere } = useHere(day);
  return (
    <aside aria-label={day.title} className="hidden lg:block">
      <div className="sticky top-6 rounded-lg border-2 border-brand bg-surface p-4 shadow-card">
        <p className="text-xs font-semibold tracking-wide text-brand uppercase">Today</p>
        <h2 className="text-lg font-semibold">{day.title}</h2>
        <ul className="mt-3 space-y-2">
          {day.actions.map((a) => (
            <li key={a.id}>
              <ActionTile action={a} here={isHere(a)} />
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function ActionTile({ action: a, here, onNavigate }: { action: DayAction; here: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={a.href}
      onClick={() => {
        onNavigate?.();
        openTarget(a.href);
      }}
      aria-current={here ? "page" : undefined}
      className={`flex min-h-14 items-start gap-3 rounded-md border px-3 py-2.5 hover:border-brand ${
        here ? "border-brand bg-brand-soft" : "border-border bg-surface"
      }`}
    >
      <Icon name={a.icon} className="mt-0.5 size-5 shrink-0 text-brand" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{a.label}</span>
        <span className="block text-xs leading-5 text-muted">{a.hint}</span>
      </span>
    </Link>
  );
}

/**
 * Every page of the event, on the day: buttons along the top on a computer
 * (not on the event page, which has the panel), and a tab bar along the
 * bottom of a phone.
 */
export function DayBar({ day }: { day: DayActions }) {
  const { pathname, isHere } = useHere(day);
  const more = useRef<HTMLDialogElement>(null);
  const home = `/dashboard/events/${day.eventId}`;
  const onHome = pathname === home;
  // A phone has room for four tabs: with more jobs than that, three and "More".
  const tabs = day.actions.length > 4 ? day.actions.slice(0, 3) : day.actions;
  const overflow = day.actions.length > 4;

  // Bars pinned to the bottom of a page (Publish) sit above the tab bar.
  useEffect(() => {
    document.documentElement.style.setProperty("--day-bar", "4.5rem");
    return () => {
      document.documentElement.style.removeProperty("--day-bar");
    };
  }, []);

  return (
    <>
      {!onHome && (
        <nav aria-label={day.title} className="mb-5 hidden rounded-lg border-2 border-brand bg-surface px-3 py-2.5 lg:block print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm font-semibold">
              <span className="text-brand">Today</span> · {day.title}
            </span>
            {day.actions.map((a) => {
              const here = isHere(a);
              return (
                <Link
                  key={a.id}
                  href={a.href}
                  onClick={() => openTarget(a.href)}
                  aria-current={here ? "page" : undefined}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold hover:border-brand ${
                    here ? "border-brand bg-brand-soft" : "border-border"
                  }`}
                >
                  <Icon name={a.icon} className="size-4 text-brand" />
                  {a.label}
                </Link>
              );
            })}
            <Link href={home} className="ml-auto inline-flex min-h-10 items-center px-2 text-sm font-medium text-brand underline-offset-4 hover:underline">
              Event page
            </Link>
          </div>
        </nav>
      )}

      {/* Phone and tablet: a tab bar along the bottom, on every page of the event (the layout leaves room for it). */}
      <nav
        aria-label={day.title}
        className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-brand bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden"
      >
        <ul className="mx-auto flex max-w-xl">
          {tabs.map((a) => {
            const here = isHere(a);
            return (
              <li key={a.id} className="flex-1">
                <Link
                  href={a.href}
                  onClick={() => openTarget(a.href)}
                  aria-current={here ? "page" : undefined}
                  className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-tight font-semibold ${here ? "text-brand" : "text-foreground"}`}
                >
                  <span className={`flex h-7 w-12 items-center justify-center rounded-full ${here ? "bg-brand-soft" : ""}`}>
                    <Icon name={a.icon} className="size-5" />
                  </span>
                  <span className="line-clamp-2 max-w-full text-center">{a.short}</span>
                </Link>
              </li>
            );
          })}
          {overflow && (
            <li className="flex-1">
              <button
                type="button"
                onClick={() => more.current?.showModal()}
                aria-haspopup="dialog"
                className="flex min-h-16 w-full flex-col items-center justify-center gap-1 px-1 text-xs font-semibold"
              >
                <span className="flex h-7 w-12 items-center justify-center">
                  <Icon name="more" className="size-5" />
                </span>
                More
              </button>
            </li>
          )}
        </ul>
      </nav>
      <dialog
        ref={more}
        aria-label={day.title}
        onClick={(e) => e.target === e.currentTarget && more.current?.close()}
        className="mx-0 mt-auto mb-0 max-h-[85vh] w-full max-w-none overflow-y-auto rounded-t-2xl border border-border bg-surface p-0 text-foreground shadow-elevated backdrop:bg-[#071a31]/50 lg:hidden"
      >
        <div className="px-5 pb-8 pt-3">
          <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" />
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">
              <span className="text-brand">Today</span> · {day.title}
            </h2>
            <button type="button" onClick={() => more.current?.close()} className="min-h-11 rounded-md px-3 text-sm font-medium text-muted hover:text-foreground">
              Close
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {day.actions.map((a) => (
              <li key={a.id}>
                <ActionTile action={a} here={isHere(a)} onNavigate={() => more.current?.close()} />
              </li>
            ))}
            <li>
              <Link href={home} onClick={() => more.current?.close()} className="flex min-h-11 items-center px-3 text-sm font-medium text-brand">
                Event page
              </Link>
            </li>
          </ul>
        </div>
      </dialog>
    </>
  );
}

const PATHS: Record<DayIcon | "more", string> = {
  board: "M4 5h16v14H4zM8 9h8M8 13h5",
  checkin: "M9 4h6v3H9zM7 5.5H5.5V20h13V5.5H17M9 13.5l2 2 4-4.5",
  parents: "M9 8a2.5 2.5 0 1 0 0-.01M4 19c.5-3 2.5-5 5-5s4.5 2 5 5M16.5 9.5a2 2 0 1 0 0-.01M15.5 13.5c2 0 3.8 1.6 4.2 4.5",
  groups: "M4 20V9l8-5 8 5v11M9 20v-6h6v6",
  booths: "M4 9l1.5-5h13L20 9M4 9h16M4 9c0 1.5 1.3 2.5 2.7 2.5S9.3 10.5 9.3 9c0 1.5 1.3 2.5 2.7 2.5s2.7-1 2.7-2.5c0 1.5 1.3 2.5 2.6 2.5S20 10.5 20 9M5.5 11.5V20h13v-8.5",
  schedule: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  message: "M4 10v4h3l6 4V6L7 10zM16.5 9.5a3.5 3.5 0 0 1 0 5M19 7a7 7 0 0 1 0 10",
  meetings: "M5 6h14v13H5zM5 10h14M9 4v4M15 4v4",
  station: "M12 21s-6-5.5-6-10.5a6 6 0 0 1 12 0C18 15.5 12 21 12 21zM12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};

function Icon({ name, className = "" }: { name: DayIcon | "more"; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3 : 1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}

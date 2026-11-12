"use client";

import { useTabInView } from "@/components/use-tab-in-view";
import { LeaveStepLink } from "./setup-leave";
import { folderTab, folderTabNote, folderTabRow } from "@/components/folder-tabs";

export type SetupTab = {
  key: string;
  label: string;
  /** A shorter label for phones ("Groups" for "Group times"). When every tab has one, the tabs share a phone's width. */
  short?: string;
  /** Under the label: "3 bands", "Saved", "Optional". */
  status: string;
  /** A check (done), a yellow dot (still to do), or neither. */
  mark?: "done" | "todo";
  href: string;
  active: boolean;
};

/**
 * A setup page's tabs, like the sign-up tabs in Volunteer Setup. Leaving a tab
 * with something half-edited asks first (the same window as the setup steps).
 */
export function SetupTabs({
  label,
  tabs,
  way = "tab",
}: {
  label: string;
  tabs: SetupTab[];
  /** What the window says: "invite" for a half-typed invitation (Team setup). */
  way?: "tab" | "invite";
}) {
  const row = useTabInView<HTMLElement>(tabs.find((t) => t.active)?.key);
  // Short labels on a phone: equal segments that fit the screen, nothing cut off.
  const fit = tabs.length <= 2 || tabs.every((t) => t.short);
  return (
    <nav ref={row} aria-label={label} className="relative -mx-4 snap-x scroll-px-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {/* Two tabs on a phone share the width (a row as wide as its words ran off the screen). */}
      <ul className={`${folderTabRow} ${fit ? "max-sm:min-w-0" : ""}`}>
        {tabs.map((t) => (
          // On a phone each tab is a bit under half the screen, so the next one always peeks in at the edge: a cue to swipe.
          <li key={t.key} className={fit ? "max-sm:min-w-0 max-sm:flex-1" : "max-sm:w-[42vw] max-sm:shrink-0"}>
            <LeaveStepLink
              href={t.href}
              way={way}
              scroll={false}
              current={t.active}
              className={`${folderTab(t.active)} max-sm:h-full max-sm:w-full`}
            >
              <span className="flex items-center gap-1.5 whitespace-nowrap max-sm:whitespace-normal">
                {t.mark === "done" && <span aria-hidden>✓</span>}
                {t.short ? (
                  <>
                    <span className="sm:hidden">{t.short}</span>
                    <span className="max-sm:hidden">{t.label}</span>
                  </>
                ) : (
                  t.label
                )}
              </span>
              <span className={folderTabNote(t.mark === "todo")}>
                {t.mark === "todo" && <span aria-hidden>◆ </span>}
                {t.status}
              </span>
            </LeaveStepLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

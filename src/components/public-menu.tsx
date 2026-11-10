"use client";

import { headerLinkClass } from "@/components/logo";

/**
 * On phones the header has room only for Sign in and Join the pilot, so the page's other links sit behind a
 * Menu button (panel, 2026-11-10). Wider screens show the links themselves, so this hides from `sm` up.
 * Picking a link closes the menu.
 */
export function PublicMenu({ links }: { links: { href: string; label: string }[] }) {
  return (
    <details className="relative sm:hidden" onClick={(e) => {
      if ((e.target as HTMLElement).closest("a")) e.currentTarget.removeAttribute("open");
    }}>
      <summary className={`flex cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden ${headerLinkClass}`}>
        Menu
        <span aria-hidden className="text-xs">▾</span>
      </summary>
      <ul className="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-border bg-background p-2 text-foreground shadow-card">
        {links.map((l) => (
          <li key={l.href}>
            <a href={l.href} className="flex min-h-11 items-center rounded-md px-3 font-medium hover:bg-surface">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

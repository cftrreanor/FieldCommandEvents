"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { confirmDialog } from "@/components/confirm-dialog";

/** Words that read as "not done yet" rather than saying something true about the section. */
const NOT_FACTS = new Set(["Optional", "Default"]);

export type SettingsSection = { id: string; label: string; status?: string; done?: boolean };

/**
 * Edit details' section menu: down the side on wide screens, wrapped rows on
 * phones and tablets, so every section (and the open one) is always in view.
 * A plain menu, not a checklist: no done circles, and a word under a section
 * only when it's a fact ("Live", "2 files"), never "Optional" (light check,
 * 2026-11-08). Each section has its own link (?section=team). Leaving a
 * section with typed-in changes that weren't saved asks first.
 */
export function SettingsNav({ sections, current, base }: { sections: SettingsSection[]; current: string; base: string }) {
  const router = useRouter();
  const dirty = useRef(false);

  useEffect(() => {
    const panel = document.getElementById("settings-panel");
    if (!panel) return;
    // Typing or picking marks the section changed; saving (any form submit) clears it.
    const changed = () => (dirty.current = true);
    const saved = () => (dirty.current = false);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    panel.addEventListener("input", changed);
    panel.addEventListener("change", changed);
    panel.addEventListener("submit", saved);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      panel.removeEventListener("input", changed);
      panel.removeEventListener("change", changed);
      panel.removeEventListener("submit", saved);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [current]);

  const go = async (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!dirty.current || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const leave = await confirmDialog({
      title: "Leave without saving?",
      message: "You changed something in this section and didn't save it. Your changes will be lost.",
      confirmLabel: "Leave without saving",
      cancelLabel: "Keep editing",
      danger: true,
    });
    if (!leave) return;
    dirty.current = false;
    router.push(href);
  };

  return (
    <nav aria-label="Event settings" className="mb-6 lg:mb-0">
      <ul className="flex flex-wrap gap-2 lg:sticky lg:top-6 lg:flex-col lg:flex-nowrap lg:gap-1">
        {sections.map((s) => {
          const on = s.id === current;
          const href = `${base}?section=${s.id}`;
          return (
            <li key={s.id} className="shrink-0">
              <Link
                href={href}
                onClick={(e) => go(e, href)}
                aria-current={on ? "page" : undefined}
                className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm lg:whitespace-normal lg:border-0 lg:py-2 ${
                  on ? "border-brand bg-brand-soft font-semibold text-foreground" : "border-border text-muted hover:bg-background hover:text-foreground"
                }`}
              >
                <span className="min-w-0">
                  <span className="block">{s.label}</span>
                  {s.status && !NOT_FACTS.has(s.status) && <span className="hidden text-xs font-normal text-muted lg:block">{s.status}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

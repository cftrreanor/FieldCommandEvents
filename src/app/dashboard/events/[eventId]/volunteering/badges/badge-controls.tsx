"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { darkForWhiteText } from "@/lib/brand-color";
import { colorOf } from "@/lib/logo-color";

/** Opens the browser's print window, where "Save as PDF" is one of the printers. */
export function PrintBadgesButton({ disabled }: { disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => window.print()}
      className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand-hover disabled:cursor-not-allowed disabled:border-[1.5px] disabled:border-field-border disabled:bg-surface disabled:text-disabled"
    >
      Print or save as PDF
    </button>
  );
}

// The badge band when there's no logo (fixed, so dark mode can't change what prints).
const NAVY = "#0b3558";

/**
 * The badges, with the VOLUNTEER band in the account's color: the one saved
 * with the logo (or picked by the host), else read from the logo, else navy.
 * It's darkened until white text on the band is easy to read.
 */
export function BadgeColorScope({
  logo,
  color: saved,
  className,
  children,
}: {
  logo: string | null;
  color: string | null;
  className?: string;
  children: ReactNode;
}) {
  const [found, setFound] = useState<{ logo: string; color: string } | null>(null);
  const base = saved ?? (logo && found?.logo === logo ? found.color : NAVY);
  useEffect(() => {
    if (!logo || saved) return;
    let live = true;
    colorOf(logo).then((c) => {
      if (live) setFound({ logo, color: c ?? NAVY });
    });
    return () => {
      live = false;
    };
  }, [logo, saved]);
  return (
    <div className={className} style={{ "--badge-band": darkForWhiteText(base) } as CSSProperties}>
      {children}
    </div>
  );
}

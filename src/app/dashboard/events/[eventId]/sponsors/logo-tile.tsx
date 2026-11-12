import { isNarrowLogo, logoBox, type Tile } from "@/lib/sponsors";

/** Logo tiles: white in light mode, a soft off-white in dark mode so they don't glare (light check). */
export const LOGO_TILE = "border border-border bg-white dark:border-transparent dark:bg-[#ECE9E2]";

/** A logo at its real shape inside a box (fixed width and height), or "No logo". For the list and windows. */
export function LogoThumb({ src, width, height, name, box = { w: 80, h: 32 } }: { src: string | null; width: number | null; height: number | null; name: string; box?: { w: number; h: number } }) {
  if (!src || !width || !height) {
    return (
      <span className="flex h-12 w-24 shrink-0 items-center justify-center rounded-md border border-border bg-background px-2 text-center text-xs font-medium">
        No logo
      </span>
    );
  }
  const size = logoBox(box, width, height);
  return (
    <span className={`flex h-12 w-24 shrink-0 items-center justify-center rounded-md px-2 ${LOGO_TILE}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- our own resized copy, served with long caching */}
      <img src={src} alt={`${name} logo`} width={size.width} height={size.height} className="object-contain" />
    </span>
  );
}

/**
 * How a sponsor's tile looks on the public page at one size, for "How it shows": the logo in its box, the name
 * under small or narrow logos; without a logo, the name on the page's own color.
 */
export function TilePreview({ tile, name, src, width, height }: { tile: Tile; name: string; src: string | null; width: number | null; height: number | null }) {
  const shown = name.trim() || "Sponsor's name";
  if (!src || !width || !height) {
    return (
      <div className="flex min-h-[4.5rem] items-center justify-center rounded-md border border-border bg-surface px-3 py-3 dark:border-field-border">
        <span className={`${tile.name} text-center leading-snug font-semibold [overflow-wrap:anywhere]`}>{shown}</span>
      </div>
    );
  }
  const size = logoBox(tile, width, height);
  const under = tile.under || isNarrowLogo(width, height);
  return (
    <div className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-md px-3 py-3 ${LOGO_TILE}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- our own resized copy */}
      <img src={src} alt={under ? "" : shown} width={size.width} height={size.height} className="object-contain" />
      {under && <span className="text-center text-sm leading-snug font-medium text-[#1d2733] [overflow-wrap:anywhere]">{shown}</span>}
    </div>
  );
}

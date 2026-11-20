"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";

// Duplicate event (owner decision 2026-11-20): dates typed into copied text become "[new date]", and publishing waits
// until each is filled in. Every field that can hold one says so right above it, and every link to a spot ends in
// #new-date, which opens whatever it's folded in (More options, Edit shift) and puts the cursor on the marker.

const MARKER = "[new date]";

/**
 * "◆ Add the new date where it says [new date]", above a field whose text still holds the marker. `unmarked`: the
 * text was too long to mark (copied as it was), so its old dates are changed by hand.
 */
export function NewDateNote({
  value,
  spot,
  className = "",
  unmarked = false,
  children,
}: {
  value: string | null | undefined;
  spot: string;
  className?: string;
  unmarked?: boolean;
  /** Words for a field that isn't a text box (a meal option is removed and added again). */
  children?: ReactNode;
}) {
  if (!value?.includes(MARKER) && !unmarked) return null;
  return (
    // data-new-date: which kind of place, so #new-date-[spot] lands here (newDateSpotHref).
    <p data-new-date={spot} data-unmarked={unmarked || undefined} className={`scroll-mt-4 text-sm font-medium text-warning ${className}`}>
      <span aria-hidden>◆ </span>
      {unmarked
        ? "Change the old dates here. This text was too long to mark them with “[new date]”"
        : children ?? <>Add the new date where it says &ldquo;{MARKER}&rdquo;</>}
    </p>
  );
}

/** On Jobs and shifts: the other jobs that still hold "[new date]", each a link (their tabs have a ◆ too). */
export function NewDatesElsewhere({ here, others }: { here: boolean; others: { label: string; href: string }[] }) {
  if (!others.length) return null;
  return (
    <p className="mb-3 text-sm font-medium text-warning">
      <span aria-hidden>◆ </span>
      {here ? "Also in " : "Add the new date in "}
      {others.map((o, i) => (
        <span key={o.href}>
          {i > 0 && (i === others.length - 1 ? (others.length > 2 ? ", and " : " and ") : ", ")}
          <Link href={o.href} className="font-semibold text-brand underline underline-offset-4">
            {o.label}
          </Link>
        </span>
      ))}
    </p>
  );
}

/**
 * Arriving with #new-date: the first field holding "[new date]" is opened (any folded section around it), scrolled
 * to, and focused with the marker selected, so typing replaces it.
 */
export function NewDateScroll() {
  const pathname = usePathname();
  const query = useSearchParams();
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const go = (hash: string, wait: number) => {
      if (!hash.startsWith("#new-date")) return;
      clearTimeout(t);
      t = setTimeout(() => land(hash.slice("#new-date-".length)), wait);
    };
    go(window.location.hash, 400);
    // A link to another place on this same page (a step's Next while places are left): no navigation to wait for.
    const click = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href*='#new-date']") as HTMLAnchorElement | null;
      if (!a) return;
      const url = new URL(a.href, window.location.href);
      if (url.pathname === window.location.pathname && url.search === window.location.search) go(url.hash, 60);
    };
    document.addEventListener("click", click);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", click);
    };
  }, [pathname, query]);
  return null;
}

function land(spot: string) {
  // The note for this kind of place (or the first one), then the marked field after it.
  const notes = [...document.querySelectorAll<HTMLElement>("[data-new-date]")];
  const note = notes.find((n) => n.dataset.newDate === spot) ?? notes[0];
  const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].filter((f) => f.value.includes(MARKER));
  const after = (list: (HTMLInputElement | HTMLTextAreaElement)[]) => note && list.find((f) => note.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING);
  // A field too long to mark has no marker: the box right after its note.
  const boxes = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type=hidden]):not([type=checkbox]), textarea")];
  const field = after(fields) ?? (note?.dataset.unmarked ? after(boxes) : undefined) ?? fields[0];
  if (!field) {
    note?.scrollIntoView({ block: "center" });
    return;
  }
  for (let el: HTMLElement | null = field; el; el = el.parentElement) if (el instanceof HTMLDetailsElement) el.open = true;
  // The note and the field both in sight: the note at the top when they fit, else the field in the middle.
  if (note && field.getBoundingClientRect().bottom - note.getBoundingClientRect().top < window.innerHeight - 40) note.scrollIntoView({ block: "start" });
  else field.scrollIntoView({ block: "center" });
  field.focus({ preventScroll: true });
  const at = field.value.indexOf(MARKER);
  try {
    if (at >= 0) field.setSelectionRange(at, at + MARKER.length);
  } catch {
    // Not a text field: the cursor is there, at least.
  }
}

"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

// Duplicate event (owner decision 2026-11-20): dates typed into copied text become "[new date]", and publishing waits
// until each is filled in. Every field that can hold one says so right above it, and every link to a spot ends in
// #new-date, which opens whatever it's folded in (More options, Edit shift) and puts the cursor on the marker.

const MARKER = "[new date]";

/** "◆ Add the new date where it says [new date]", above a field whose text still holds the marker. */
export function NewDateNote({ value, spot, className = "" }: { value: string | null | undefined; spot: string; className?: string }) {
  if (!value?.includes(MARKER)) return null;
  return (
    // data-new-date: which kind of spot, so #new-date-[spot] lands here (newDateSpotHref).
    <p data-new-date={spot} className={`scroll-mt-4 text-sm font-medium text-warning ${className}`}>
      <span aria-hidden>◆ </span>Add the new date where it says &ldquo;{MARKER}&rdquo;
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
    const hash = window.location.hash;
    if (!hash.startsWith("#new-date")) return;
    const spot = hash.slice("#new-date-".length);
    const t = setTimeout(() => {
      // The note for this kind of spot (or the first one), then the marked field after it.
      const notes = [...document.querySelectorAll<HTMLElement>("[data-new-date]")];
      const note = notes.find((n) => n.dataset.newDate === spot) ?? notes[0];
      const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].filter((f) => f.value.includes(MARKER));
      const field = (note && fields.find((f) => note.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? fields[0];
      if (!field) return;
      for (let el: HTMLElement | null = field; el; el = el.parentElement) if (el instanceof HTMLDetailsElement) el.open = true;
      // The note and the field both in sight: the note at the top when they fit, else the field in the middle.
      if (note && field.getBoundingClientRect().bottom - note.getBoundingClientRect().top < window.innerHeight - 40) note.scrollIntoView({ block: "start" });
      else field.scrollIntoView({ block: "center" });
      field.focus({ preventScroll: true });
      const at = field.value.indexOf(MARKER);
      try {
        field.setSelectionRange(at, at + MARKER.length);
      } catch {
        // Not a text field: the cursor is there, at least.
      }
    }, 400);
    return () => clearTimeout(t);
  }, [pathname, query]);
  return null;
}

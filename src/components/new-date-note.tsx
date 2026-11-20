"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import type { NewDateSpot } from "@/lib/duplicate-words";

// Duplicate event (owner decision 2026-11-20): dates typed into copied text become "[new date]", and publishing waits
// until each is filled in. Every field that can hold one says so right under its box (like "Needed before you
// publish"): the box gets an amber border and the note is its description (aria-describedby). Every link to a place
// ends in #new-date-[what], which opens whatever it's folded in (More options, Edit shift) and puts the cursor on the
// marker.

const MARKER = "[new date]";

/** The marker, never broken across two lines. */
export const Marker = () => <span className="whitespace-nowrap">&ldquo;{MARKER}&rdquo;</span>;

/**
 * Every place on this copy still holding "[new date]" or an old date too long to mark (copy_new_date_spots), from the
 * event layout, so every field knows without each page passing it down.
 */
const Places = createContext<NewDateSpot[]>([]);

export function NewDatePlaces({ spots, children }: { spots: NewDateSpot[]; children: ReactNode }) {
  return <Places.Provider value={spots}>{children}</Places.Provider>;
}

const matches = (s: NewDateSpot, spot: string, stationId?: string | null, detail?: string | null) =>
  (s.what === spot || (spot === "file" && s.what === "document")) &&
  (stationId === undefined || s.station_id === stationId) &&
  (detail === undefined || s.detail === detail || s.job === detail);

/** Every place on this copy (empty for any other event). */
export const useNewDatePlaces = () => useContext(Places);

/** This copy's place of this kind (on this job), if it's listed: a box for it must be in sight. */
export function useNewDatePlace(spot: string, stationId?: string | null, detail?: string | null): NewDateSpot | undefined {
  return useContext(Places).find((s) => matches(s, spot, stationId, detail));
}

/**
 * "◆ Add the new date where it says [new date]", under a field whose text still holds the marker. `unmarked`: the
 * text was too long to mark (copied as it was), so its old dates are changed by hand (also known from the layout's
 * list, matched by `spot`, `stationId`, and `detail`). `field`: the name of the box it's about (else the box just
 * before the note), which gets the amber border and this note as its description.
 */
export function NewDateNote({
  value,
  spot,
  field,
  stationId,
  detail,
  className = "",
  unmarked,
  children,
}: {
  value: string | null | undefined;
  spot: string;
  field?: string;
  /** The job the box is on, to match the layout's list of places too long to mark. */
  stationId?: string | null;
  /** A room's or file's name, to match the layout's list too. */
  detail?: string | null;
  className?: string;
  /** Too long to mark. Left out: the layout's list says (true or false here decides it). */
  unmarked?: boolean;
  /** Words for a field that isn't a text box (a meal option is removed and added again): no box to point at. */
  children?: ReactNode;
}) {
  const listed = useContext(Places).some((s) => s.unmarked && matches(s, spot, stationId, detail));
  // Too long to mark: the text holds no marker (once it does, it's been changed, and the marker note shows).
  const old = (unmarked ?? listed) && !value?.includes(MARKER);
  const id = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const shown = Boolean(value?.includes(MARKER)) || old;
  useEffect(() => {
    const note = ref.current;
    if (!note || children) return;
    const box = boxFor(note, field);
    if (!box) return;
    const ids = (box.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    if (!ids.includes(id)) box.setAttribute("aria-describedby", [...ids, id].join(" "));
    box.setAttribute("data-new-date-box", "");
    return () => {
      const left = (box.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((x) => x && x !== id);
      if (left.length) box.setAttribute("aria-describedby", left.join(" "));
      else box.removeAttribute("aria-describedby");
      box.removeAttribute("data-new-date-box");
    };
    // Every render: a box whose own aria-describedby React rewrites (a hint or an error appearing) gets this back.
  });
  if (!shown) return null;
  return (
    // data-new-date: which kind of place, so #new-date-[spot] lands here (newDateSpotHref).
    <p
      ref={ref}
      id={id}
      data-new-date={spot}
      data-unmarked={old || undefined}
      className={`mt-1.5 flex scroll-mt-4 gap-1.5 text-sm font-medium text-warning ${className}`}
    >
      <span aria-hidden>◆</span>
      <span>
        {old && !children ? (
          <>
            Change the old dates in this box. It was too long to mark them with <Marker />
          </>
        ) : (
          children ?? (
            <>
              Add the new date where it says <Marker />
            </>
          )
        )}
      </span>
    </p>
  );
}

/** The box a note is about: the one named `field` near it, else the last box just before it. */
function boxFor(note: HTMLElement, field?: string): HTMLInputElement | HTMLTextAreaElement | null {
  const BOX = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea";
  if (field) {
    for (let el: HTMLElement | null = note.parentElement; el; el = el.parentElement) {
      const found = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${CSS.escape(field)}"]`);
      if (found) return found;
      if (el.tagName === "FORM" || el === document.body) break;
    }
    const outside = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(`[name="${CSS.escape(field)}"]`);
    if (outside.length === 1) return outside[0];
  }
  for (let sib = note.previousElementSibling; sib; sib = sib.previousElementSibling) {
    if (sib.matches(BOX)) return sib as HTMLInputElement;
    const inner = sib.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(BOX);
    if (inner.length) return inner[inner.length - 1];
  }
  return null;
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
  // The note for this kind of place (or the first one), then the box it describes (the one before it).
  const notes = [...document.querySelectorAll<HTMLElement>("[data-new-date]")];
  const note = notes.find((n) => n.dataset.newDate === spot) ?? notes[0];
  const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].filter((f) => f.value.includes(MARKER));
  const described = note?.id ? document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-describedby~="${CSS.escape(note.id)}"]`) : null;
  const field = described ?? fields[0];
  if (!field) {
    note?.scrollIntoView({ block: "center" });
    return;
  }
  for (let el: HTMLElement | null = field; el; el = el.parentElement) if (el instanceof HTMLDetailsElement) el.open = true;
  // The box and its note both in sight: the box at the top when they fit, else the box in the middle.
  const top = Math.min(field.getBoundingClientRect().top, note?.getBoundingClientRect().top ?? Infinity);
  const bottom = Math.max(field.getBoundingClientRect().bottom, note?.getBoundingClientRect().bottom ?? -Infinity);
  if (bottom - top < window.innerHeight - 40) {
    const label = field.closest("label") ?? field;
    label.scrollIntoView({ block: "start" });
    window.scrollBy(0, -16);
  } else field.scrollIntoView({ block: "center" });
  field.focus({ preventScroll: true });
  const at = field.value.indexOf(MARKER);
  try {
    if (at >= 0) field.setSelectionRange(at, at + MARKER.length);
  } catch {
    // Not a text field: the cursor is there, at least.
  }
}

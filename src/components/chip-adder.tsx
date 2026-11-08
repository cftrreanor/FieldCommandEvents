"use client";

import { useEffect, useId, useState } from "react";
import { setPending } from "@/components/pending-edits";
import { Input } from "@/components/ui";

/** "Pizza, Salad , pizza" → ["Pizza", "Salad"]: trimmed, blanks and repeats dropped. */
export function splitNames(text: string) {
  const out: string[] = [];
  for (const n of text.split(",").map((x) => x.trim()).filter(Boolean)) if (!out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n);
  return out;
}

const has = (list: string[], name: string) => list.some((x) => x.toLowerCase() === name.toLowerCase());

/**
 * Adding to a list of names (classifications, meal options), in the same order everywhere:
 * suggestions to tap first, then a box to type your own (more than one, separated by commas).
 * Nothing is added until Add (or Enter); names already on the list are skipped.
 */
export function ChipAdder({
  suggestions,
  existing,
  onAdd,
  placeholder,
  label,
  busy = false,
  max,
  maxLength = 40,
  invalid = false,
  describedBy,
}: {
  /** Groups of suggestions ("1A" … "6A"); a group with a title gets an "Add all" button. */
  suggestions: { title?: string; names: string[] }[];
  /** What's on the list already (hidden from the suggestions, skipped when adding). */
  existing: string[];
  onAdd: (names: string[]) => void;
  placeholder: string;
  /** The box's accessible name ("Add a meal option"). */
  label: string;
  busy?: boolean;
  /** The most the list can hold. */
  max?: number;
  maxLength?: number;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [typed, setTyped] = useState("");
  const key = useId();
  const hintId = `${key}-hint`;
  const previewId = `${key}-preview`;
  const fresh = splitNames(typed).filter((n) => !has(existing, n));
  const room = max == null ? Infinity : max - existing.length;
  // Typed but not added: leaving asks first.
  useEffect(() => {
    setPending(key, typed.trim() ? { kind: "unadded" } : null);
    return () => setPending(key, null);
  }, [typed, key]);

  const add = (names: string[]) => {
    const list = names.filter((n) => !has(existing, n)).slice(0, Math.max(room, 0));
    if (!list.length || busy) return;
    onAdd(list);
  };
  const addTyped = () => {
    if (!fresh.length || fresh.some((n) => n.length > maxLength)) return;
    add(fresh);
    setTyped("");
  };
  const groups = suggestions.map((g) => ({ ...g, left: g.names.filter((n) => !has(existing, n)) })).filter((g) => g.left.length > 0);
  const chip =
    "inline-flex min-h-11 items-center gap-1 rounded-full border-[1.5px] border-brand bg-surface px-4 text-sm font-semibold text-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:border-field-border disabled:text-disabled";

  return (
    <div className="space-y-3">
      {groups.length > 0 && room > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Add common ones</p>
          {groups.map((g, i) => (
            <div key={g.title ?? i} className="flex flex-wrap items-center gap-2">
              {g.left.map((n) => (
                <button key={n} type="button" disabled={busy} onClick={() => add([n])} className={chip} aria-label={`Add ${n}`}>
                  <span aria-hidden>+</span> {n}
                </button>
              ))}
              {g.title && g.left.length > 1 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => add(g.left)}
                  className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-brand underline underline-offset-4"
                >
                  Add all {g.title}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div>
        <div className="flex gap-2">
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTyped();
              }
            }}
            placeholder={placeholder}
            aria-label={label}
            aria-describedby={[describedBy, hintId, fresh.some((n) => n.length > maxLength) && previewId].filter(Boolean).join(" ")}
            aria-invalid={invalid || undefined}
            maxLength={maxLength * 4}
            disabled={room <= 0}
            className="min-w-0 flex-1"
          />
          <button
            type="button"
            disabled={busy || fresh.length === 0}
            onClick={addTyped}
            className="inline-flex min-h-11 items-center rounded-md border-[1.5px] border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand disabled:cursor-not-allowed disabled:text-disabled"
          >
            Add
          </button>
        </div>
        <p id={hintId} className="mt-1.5 text-sm text-muted">
          {room <= 0 ? `That's the most you can add (${max}).` : "Type your own. Separate more than one with commas, then select Add."}
        </p>
      </div>
      {fresh.some((n) => n.length > maxLength) && (
        <p id={previewId} role="alert" className="text-sm font-medium text-danger">
          Keep each one under {maxLength} characters.
        </p>
      )}
    </div>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button, Field, Input } from "./ui";

type Suggestion = { placeId: string; main: string; secondary: string };
type Place = { placeId: string; name: string | null; address: string; lat: number | null; lng: number | null };

export type VenueValue = {
  name?: string | null;
  address?: string | null;
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
};

const newSession = () => crypto.randomUUID();

/**
 * Venue search: type a stadium, school or street address and pick from Google
 * Maps suggestions. Submits venueName, venueAddress, venuePlaceId, venueLat and
 * venueLng. Falls back to plain text fields if search isn't available.
 */
export function VenuePicker({
  searchEnabled,
  initial,
  timezone,
  kind = "Venue",
  example = "e.g. Panther Stadium",
  required = true,
}: {
  /** Off in a step that saves itself: the rest saves while the address is still to come. */
  required?: boolean;
  searchEnabled: boolean;
  initial?: VenueValue;
  /** The event's time zone: suggestions favor that part of the country. */
  timezone?: string;
  /** What the place is called in labels: "Venue" ("Venue name", "Venue address") or "School". */
  kind?: string;
  /** Placeholder for the name. */
  example?: string;
}) {
  const [mode, setMode] = useState<"search" | "selected" | "manual">(
    initial?.address ? (initial.placeId ? "selected" : "manual") : searchEnabled ? "search" : "manual",
  );
  const [place, setPlace] = useState<Place | null>(
    initial?.address && initial.placeId
      ? {
          placeId: initial.placeId,
          name: initial.name ?? null,
          address: initial.address,
          lat: initial.lat ?? null,
          lng: initial.lng ?? null,
        }
      : null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  if (mode === "manual") {
    return (
      <div className="grid gap-4">
        {notice && <p className="text-sm text-muted">{notice}</p>}
        <Field label={`${kind} name`} hint="Optional.">
          <Input name="venueName" defaultValue={initial?.name ?? ""} placeholder={example} />
        </Field>
        <Field label={`${kind} address`}>
          <Input name="venueAddress" defaultValue={initial?.address ?? ""} required={required} autoComplete="street-address" />
        </Field>
        {searchEnabled && (
          <button
            type="button"
            className="justify-self-start text-sm font-medium text-brand underline-offset-4 hover:underline"
            onClick={() => {
              setNotice(null);
              setMode("search");
            }}
          >
            Search Google Maps instead
          </button>
        )}
      </div>
    );
  }

  if (mode === "selected" && place) {
    return (
      <div className="grid gap-4">
        <input type="hidden" name="venueAddress" value={place.address} />
        <input type="hidden" name="venuePlaceId" value={place.placeId} />
        <input type="hidden" name="venueLat" value={place.lat ?? ""} />
        <input type="hidden" name="venueLng" value={place.lng ?? ""} />
        <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{place.name ?? `${kind} address`}</p>
            <p className="text-sm text-muted">{place.address}</p>
          </div>
          <Button type="button" variant="secondary" className="min-h-9 shrink-0" onClick={() => setMode("search")}>
            Change
          </Button>
        </div>
        <Field label={`${kind} name`} hint="What people call it. You can edit this.">
          <Input name="venueName" key={place.placeId} defaultValue={place.name ?? ""} placeholder={example} />
        </Field>
      </div>
    );
  }

  return (
    <VenueSearch
      required={required}
      kind={kind}
      timezone={timezone}
      onSelect={(p) => {
        setPlace(p);
        setMode("selected");
      }}
      onUnavailable={(message) => {
        setNotice(message);
        setMode("manual");
      }}
      onManual={() => setMode("manual")}
    />
  );
}

function VenueSearch({
  kind,
  timezone,
  onSelect,
  onUnavailable,
  onManual,
  required = true,
}: {
  required?: boolean;
  kind: string;
  timezone?: string;
  onSelect: (place: Place) => void;
  onUnavailable: (message: string) => void;
  onManual: () => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const session = useRef(newSession());
  const unavailable = useRef(onUnavailable);
  useEffect(() => {
    unavailable.current = onUnavailable;
  });

  // Look up suggestions shortly after typing stops.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/places/autocomplete?q=${encodeURIComponent(q)}&session=${session.current}${timezone ? `&tz=${encodeURIComponent(timezone)}` : ""}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          unavailable.current("Address search isn't available right now, so please type the venue details.");
          return;
        }
        const json = (await res.json()) as { suggestions: Suggestion[] };
        setSuggestions(json.suggestions);
        setActive(json.suggestions.length ? 0 : -1);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          unavailable.current("Address search isn't available right now, so please type the venue details.");
        }
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, timezone]);

  async function choose(s: Suggestion) {
    setOpen(false);
    setLoading(true);
    try {
      const res = await fetch(`/api/places/details?id=${encodeURIComponent(s.placeId)}&session=${session.current}`);
      if (!res.ok) throw new Error(String(res.status));
      const { place } = (await res.json()) as { place: Place };
      session.current = newSession(); // A selection ends Google's billing session.
      onSelect(place);
    } catch {
      onUnavailable("We couldn't load that place, so please type the venue details.");
    } finally {
      setLoading(false);
    }
  }

  const showList = open && query.trim().length >= 3;

  return (
    <div className="grid gap-2">
      <Field label={kind} hint={kind === "Venue" ? "Start typing a stadium, school, or street address." : "Start typing your school's name or address."}>
        <div className="relative">
          <Input
            role="combobox"
            // A place is needed: picking one (or typing the address by hand) fills in the real fields.
            required={required}
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
            autoComplete="off"
            placeholder="e.g. Panther Stadium, Cedar Park"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim().length < 3) setOpen(false);
            }}
            onFocus={() => suggestions.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (!showList || suggestions.length === 0) {
                if (e.key === "Enter") e.preventDefault(); // Don't submit the form mid-search.
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => (i + 1) % suggestions.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (active >= 0) choose(suggestions[active]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          {loading && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">
              Searching…
            </span>
          )}
          {showList && (
            <ul
              id={listId}
              role="listbox"
              className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
            >
              {suggestions.length === 0 && !loading && (
                <li className="px-4 py-3 text-sm text-muted">No matches. Try adding the city.</li>
              )}
              {suggestions.map((s, i) => (
                <li
                  key={s.placeId}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`cursor-pointer px-4 py-2.5 ${i === active ? "bg-brand-soft" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault(); // Keep focus so blur doesn't close the list first.
                    choose(s);
                  }}
                >
                  <span className="block text-sm font-medium">{s.main}</span>
                  {s.secondary && <span className="block text-sm text-muted">{s.secondary}</span>}
                </li>
              ))}
              <li className="border-t border-border px-4 py-1.5 text-right text-xs text-muted" aria-hidden>
                Powered by Google
              </li>
            </ul>
          )}
        </div>
      </Field>
      <button
        type="button"
        className="justify-self-start text-sm font-medium text-brand underline-offset-4 hover:underline"
        onClick={onManual}
      >
        Can&apos;t find it? Enter the address yourself
      </button>
    </div>
  );
}

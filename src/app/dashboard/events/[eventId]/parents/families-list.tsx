"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui";
import type { Child } from "@/lib/parents";
import { formatDate } from "@/lib/time";

export type ListedFamily = {
  id: string;
  adults: string[];
  children: Child[];
  email: string;
  phone: string | null;
  /** "YYYY-MM-DD" in the event's time zone. */
  registeredOn: string;
};

/** Parent Registration → Registered families: everyone on the list, searchable, with a download. Check-in is on its own page. */
export function FamiliesList({ families, downloadHref }: { families: ListedFamily[]; downloadHref: string }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      q
        ? families.filter((f) => [...f.adults, f.email, f.phone ?? "", ...f.children.flatMap((c) => [c.name, c.teacher])].some((x) => x.toLowerCase().includes(q)))
        : families,
    [families, q],
  );

  if (!families.length) return <p className="text-muted">No families have registered yet.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="search" placeholder="Adult, child, or teacher" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a family" className="sm:max-w-xs" />
        {/* Built on the server (only Hosts and Co-hosts get it) and noted in the download log. */}
        <a
          href={downloadHref}
          download
          className="ml-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-field-border bg-surface px-4 text-sm font-semibold transition hover:border-brand hover:bg-background active:translate-y-px"
        >
          Download list
        </a>
      </div>
      {shown.length === 0 ? (
        <p className="text-muted">No one matches that.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {shown.map((f) => (
            <li key={f.id} className="grid gap-x-4 gap-y-1 px-4 py-3 text-sm sm:grid-cols-[1fr_1.3fr_1fr]">
              <div>
                <p className="font-semibold">{f.adults[0]}</p>
                {f.adults.length > 1 && <p className="text-xs text-muted">+ {f.adults.slice(1).join(", ")}</p>}
              </div>
              <ul>
                {f.children.map((c, i) => (
                  <li key={i}>
                    <span className="font-medium">{c.name}</span> <span className="text-muted">· {c.grade} · {c.teacher}</span>
                  </li>
                ))}
              </ul>
              <div className="text-muted">
                <p className="break-all">{f.email}</p>
                {f.phone && <p>{f.phone}</p>}
                <p className="text-xs">Registered {formatDate(f.registeredOn, { year: undefined, weekday: undefined })}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

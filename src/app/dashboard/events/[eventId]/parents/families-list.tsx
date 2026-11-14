"use client";

import { useMemo, useState } from "react";
import { Field, Input } from "@/components/ui";
import type { Child } from "@/lib/parents";
import { formatDate } from "@/lib/time";
import { FrontOfficeBadge, FrontOfficeControl } from "./visitor-controls";

export type ListedAdult = { id: string; name: string; firstName: string; sentToOffice: boolean; checkedIn: boolean };

export type ListedFamily = {
  id: string;
  adults: ListedAdult[];
  children: Child[];
  email: string;
  phone: string | null;
  /** "YYYY-MM-DD" in the event's time zone. */
  registeredOn: string;
};

/**
 * Parent Registration → Registered families: everyone on the list, searchable. Each adult has the quiet front-office
 * control while it can be set (`canStop`); the downloads sit above the list. Check-in is on its own page.
 */
export function FamiliesList({ eventId, families, canStop }: { eventId: string; families: ListedFamily[]; canStop: boolean }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      q
        ? families.filter((f) =>
            [...f.adults.map((a) => a.name), f.email, f.phone ?? "", ...f.children.flatMap((c) => [c.name, c.teacher])].some((x) => x.toLowerCase().includes(q)),
          )
        : families,
    [families, q],
  );

  if (!families.length) return <p className="text-muted">No families have registered yet.</p>;
  return (
    <div className="space-y-3">
      <Field label="Find a family" hint="An adult, child, or teacher" className="sm:max-w-sm">
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      </Field>
      {q && (
        <p className="text-sm text-muted" role="status">
          {shown.length === 1 ? "1 family matches" : `${shown.length} families match`}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="text-muted">No one matches that.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {shown.map((f) => (
            <li key={f.id} className="grid gap-x-4 gap-y-2 px-4 py-3 text-sm md:grid-cols-[1.4fr_1.2fr_1fr]">
              <ul className="space-y-1">
                {f.adults.map((a) => (
                  <li key={a.id} className="flex flex-col items-start">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{a.name}</span>
                      {a.sentToOffice && <FrontOfficeBadge />}
                    </p>
                    {canStop && (
                      <FrontOfficeControl
                        eventId={eventId}
                        adult={a}
                        others={f.adults.filter((o) => o.id !== a.id && !o.sentToOffice).map((o) => o.name)}
                      />
                    )}
                  </li>
                ))}
              </ul>
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

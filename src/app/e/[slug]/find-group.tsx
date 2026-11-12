"use client";

import { useState } from "react";
import { Input } from "@/components/ui";

export type FoundGroup = {
  id: string;
  name: string;
  school: string;
  day: string;
  /** Each room, in time order: "8:00–8:20 AM" and the room's name. */
  times: { room: string; time: string }[];
  /** On the day: "Now in Clinic Room", "Done", or "Next: Sight-Reading at 3:55 PM". */
  status?: string | null;
};

/**
 * "Find a group" on the festival page: by group or school. Each result is the group's day, then its times as
 * time-and-room rows (like the director's page), and on the day a live line from the team's marks.
 */
export function FindGroup({ groups, className = "" }: { groups: FoundGroup[]; className?: string }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const hits = needle ? groups.filter((g) => g.name.toLowerCase().includes(needle) || g.school.toLowerCase().includes(needle)).slice(0, 8) : [];
  return (
    <div className={`rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6 ${className}`}>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Find a group</span>
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Group or school" autoComplete="off" />
      </label>
      <div role="status" aria-live="polite">
        {needle && hits.length === 0 && <p className="mt-3 text-sm">No group or school matches “{q.trim()}”.</p>}
        {hits.length > 0 && (
          <ul className="mt-4 space-y-4">
            {hits.map((g) => (
              <li key={g.id} className="rounded-md border border-border p-3">
                <p className="font-semibold">{g.name}</p>
                <p className="text-sm text-muted">
                  {g.school} · {g.day}
                </p>
                {g.status && <p className="mt-1 text-sm font-semibold text-brand">{g.status}</p>}
                <ol className="mt-2 divide-y divide-border border-t border-border">
                  {g.times.map((t) => (
                    <li key={t.room} className="flex gap-3 py-2 text-sm">
                      <span className="w-[7rem] shrink-0 tabular-nums">{t.time}</span>
                      <span className="min-w-0 font-medium">{t.room}</span>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

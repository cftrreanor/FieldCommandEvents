"use client";

import { useState } from "react";
import { Input } from "@/components/ui";

export type FoundGroup = { id: string; name: string; school: string; day: string; times: { room: string; time: string }[] };

/** "Find a group" on the festival page: by group or school, each result starting with its day. */
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
          <ul className="mt-3 space-y-3">
            {hits.map((g) => (
              <li key={g.id}>
                <p className="font-semibold">{g.name}</p>
                <p className="text-sm text-muted">{g.school}</p>
                <p className="text-sm">
                  {g.day} · {g.times.map((t) => `${t.room} ${t.time}`).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

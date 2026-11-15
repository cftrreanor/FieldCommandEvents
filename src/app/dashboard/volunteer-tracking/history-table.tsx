"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "@/components/toaster";
import { Button, Input } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { downloadCsv } from "@/lib/csv";
import { formatDate } from "@/lib/time";
import { confirmDialog } from "@/components/confirm-dialog";

export type HistoryRow = {
  email: string;
  full_name: string;
  events: number;
  signed_up: number;
  checked_in: number;
  last_event_name: string;
  last_event_on: string;
};

type SortKey = "showed" | "checked" | "signed" | "events" | "name" | "last";

/** The share of their shifts someone checked in for, 0–100. */
const showedUp = (r: HistoryRow) => (r.signed_up ? Math.round((r.checked_in / r.signed_up) * 100) : 0);

const COMPARE: Record<SortKey, (a: HistoryRow, b: HistoryRow) => number> = {
  // Highest share first, then the most check-ins: 10 of 10 ranks above 1 of 1.
  showed: (a, b) => showedUp(b) - showedUp(a) || b.checked_in - a.checked_in,
  checked: (a, b) => b.checked_in - a.checked_in || showedUp(b) - showedUp(a),
  signed: (a, b) => b.signed_up - a.signed_up,
  events: (a, b) => b.events - a.events,
  name: (a, b) => a.full_name.localeCompare(b.full_name),
  last: (a, b) => b.last_event_on.localeCompare(a.last_event_on),
};

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "showed", label: "Showed up", numeric: true },
  { key: "checked", label: "Checked in", numeric: true },
  { key: "signed", label: "Signed up", numeric: true },
  { key: "events", label: "Events", numeric: true },
  { key: "last", label: "Last event" },
];

function csvRows(rows: HistoryRow[]) {
  const head = ["Name", "Email", "Showed up (%)", "Checked in", "Signed up", "Events", "Last event", "Last event date"];
  const body = rows.map((r) => [r.full_name, r.email, showedUp(r), r.checked_in, r.signed_up, r.events, r.last_event_name, r.last_event_on]);
  return [head, ...body];
}

/**
 * The account's volunteers, ranked by how often they showed up for the shifts
 * they signed up for (then by check-ins). Tap a heading to sort by it; tap
 * again to flip. Search by name or email, and download it as a spreadsheet.
 */
export function HistoryTable({ rows, remove }: { rows: HistoryRow[]; remove?: (email: string) => Promise<ActionState> }) {
  const [sort, setSort] = useState<SortKey>("showed");
  const [flip, setFlip] = useState(false);
  const [query, setQuery] = useState("");
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => !gone.has(r.email) && (!q || r.full_name.toLowerCase().includes(q) || r.email.includes(q)));
    const sorted = [...list].sort(COMPARE[sort]);
    return flip ? sorted.reverse() : sorted;
  }, [rows, gone, query, sort, flip]);

  const pick = (key: SortKey) => {
    if (key === sort) setFlip((f) => !f);
    else {
      setSort(key);
      setFlip(false);
    }
  };

  const download = () => downloadCsv("volunteer-history.csv", csvRows(shown));

  const removeOne = async (r: HistoryRow) => {
    if (!remove) return;
    const ok = await confirmDialog({
      title: `Remove ${r.full_name} from your volunteer tracking?`,
      message: "Their counts are deleted and can't be brought back.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await remove(r.email);
      if (result.error) toast(result.error);
      else {
        setGone((s) => new Set(s).add(r.email));
        toast(result.message ?? "Removed");
      }
    });
  };

  if (!rows.length) {
    return (
      <p className="rounded-xl border border-border bg-surface p-4 text-muted">
        No volunteers to show yet. This fills in as volunteers check in to shifts at your events.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or email"
          aria-label="Find a volunteer"
          className="sm:max-w-xs"
        />
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted">
            {shown.length} {shown.length === 1 ? "volunteer" : "volunteers"}
          </p>
          <Button type="button" variant="secondary" onClick={download}>
            Download spreadsheet
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sort === c.key ? (flip ? "ascending" : "descending") : undefined}
                  className={`px-3 py-2 font-semibold ${c.numeric ? "text-right" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => pick(c.key)}
                    className={`inline-flex min-h-9 items-center gap-1 hover:text-brand ${sort === c.key ? "text-brand" : ""}`}
                  >
                    {c.label}
                    <span aria-hidden className="text-xs">
                      {sort === c.key ? (flip ? "▲" : "▼") : ""}
                    </span>
                  </button>
                </th>
              ))}
              {remove && (
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.email} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <span className="block font-medium">{r.full_name}</span>
                  <a href={`mailto:${r.email}`} className="text-xs text-brand hover:underline">
                    {r.email}
                  </a>
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{showedUp(r)}%</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.checked_in}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.signed_up}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.events}</td>
                <td className="px-3 py-2">
                  <span className="block">{r.last_event_name}</span>
                  <span className="text-xs text-muted">{formatDate(r.last_event_on)}</span>
                </td>
                {remove && (
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => removeOne(r)}
                      className="min-h-9 text-xs font-medium text-muted underline hover:text-danger disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Showed up is the share of the shifts someone signed up for that they checked in to. Ranked by that, then by the most
        check-ins, so 10 of 10 comes before 1 of 1.
      </p>
    </div>
  );
}

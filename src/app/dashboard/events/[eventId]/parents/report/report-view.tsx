"use client";

import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { noteParentReportPrinted } from "../actions";
import { FrontOfficeBadge } from "../visitor-controls";

/** One adult on the report, ready to show (times already in the event's time zone). */
export type ReportLine = {
  id: string;
  /** "Lopez, Maria", or the name as typed while it still needs checking. */
  name: string;
  /** Everything the find box looks through: names, children, and teachers. */
  search: string;
  visiting: string;
  status: "not_yet" | "front_office" | "checked_in";
  /** "11:02 AM by Jordan Park" (or the time alone); a date first on multi-day events. */
  checkedIn: string | null;
};

const CELL =
  "py-2 pr-3 max-sm:block max-sm:py-0.5 max-sm:before:mr-1 max-sm:before:font-semibold max-sm:before:content-[attr(data-label)] print:table-cell print:py-1";

/**
 * Print or save as PDF. Notes it first ("printed or downloaded by…"), since the app can't know whether a copy was
 * really kept; the page says so.
 */
export function PrintReportButton({ eventId, rows, primary }: { eventId: string; rows: number; primary: boolean }) {
  return (
    <Button
      type="button"
      variant={primary ? "primary" : "secondary"}
      onClick={() => {
        void noteParentReportPrinted(eventId, rows).catch(() => undefined);
        window.print();
      }}
    >
      Print or save as PDF
    </Button>
  );
}

/**
 * Every adult, grouped the same way during the event and after (Not yet or Not checked in, Sent to the front office,
 * Checked in), with a find box. The find box narrows the screen only: a printed copy always has every row.
 */
export function ReportView({ lines, final }: { lines: ReportLine[]; final: boolean }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = (l: ReportLine) => !q || l.search.includes(q);
  const groups: { key: ReportLine["status"]; title: string }[] = [
    { key: "not_yet", title: final ? "Not checked in" : "Not yet" },
    { key: "front_office", title: "Sent to the front office" },
    { key: "checked_in", title: "Checked in" },
  ];
  const matched = q ? lines.filter(matches).length : null;

  return (
    <div>
      <div className="print:hidden">
        <Field label="Find an adult or child" hint="A name or a teacher" className="sm:max-w-sm">
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
        </Field>
        {matched !== null && (
          <p className="mt-2 text-sm text-muted" role="status">
            {matched === 0 ? "No one matches that." : matched === 1 ? "1 adult matches" : `${matched} adults match`}
          </p>
        )}
      </div>
      {groups.map((g) => {
        const rows = lines.filter((l) => l.status === g.key);
        const shown = rows.filter(matches).length;
        return (
          // A group with no matches leaves the screen while someone's searching; on paper every group shows.
          <section key={g.key} className={`mt-8 ${q && shown === 0 ? "hidden print:block" : ""} print:mt-5`}>
            <h2 className="text-lg font-semibold break-after-avoid">
              {g.title} <span className="tabular-nums">({rows.length})</span>
            </h2>
            {rows.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No one</p>
            ) : (
              // On phones each adult stacks, with labels; the table is for wider screens and paper (like the Meeting summary).
              <table className="mt-2 w-full border-collapse text-left text-sm max-sm:block print:table">
                <thead className="max-sm:hidden print:table-header-group">
                  <tr className="border-b-2 border-foreground">
                    <th scope="col" className="w-[30%] py-2 pr-3 font-semibold">
                      Adult
                    </th>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Visiting
                    </th>
                    <th scope="col" className="w-[30%] py-2 font-semibold">
                      Check-in
                    </th>
                  </tr>
                </thead>
                <tbody className="max-sm:block print:table-row-group">
                  {rows.map((l) => (
                    <tr
                      key={l.id}
                      className={`break-inside-avoid border-b border-border align-top max-sm:py-2 ${matches(l) ? "max-sm:block" : "hidden print:table-row"} print:table-row`}
                    >
                      <th scope="row" className="py-2 pr-3 text-left font-semibold max-sm:block max-sm:py-0.5 print:table-cell print:py-1">
                        {l.name}
                      </th>
                      <td data-label="Visiting" className={CELL}>
                        {l.visiting}
                      </td>
                      <td data-label="Check-in" className={CELL}>
                        {l.status === "front_office" ? (
                          <FrontOfficeBadge />
                        ) : l.status === "checked_in" ? (
                          l.checkedIn
                        ) : final ? (
                          "Not checked in"
                        ) : (
                          "Not yet"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}

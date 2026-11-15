"use client";

import { CSV_TYPE } from "@/lib/csv";
import { useId, useMemo, useRef, useState, useTransition } from "react";
import { Button, Select } from "@/components/ui";
import {
  guessChoice,
  guessColumns,
  MAX_IMPORT_ROWS,
  planBands,
  planParents,
  planVolunteers,
  templateCsv,
  toRecords,
  type Choice,
  type ImportField,
  type ImportKind,
  type ImportRecord,
  type ImportResult,
  type RowProblem,
} from "@/lib/imports";
import { readSpreadsheet } from "@/lib/spreadsheet";

type Props = {
  kind: ImportKind;
  fields: ImportField[];
  /** The answers for each list field (shifts, grades, classifications). */
  choices?: Record<string, Choice[]>;
  chaperoneLimit?: number;
  /** "band"/"bands", "family"/"families": what each import makes. */
  noun: { one: string; many: string };
  templateName: string;
  /** A checkbox for emailing each person a confirmation, when there's one to send. */
  emailOption?: string;
  action: (records: ImportRecord[], sendEmails: boolean) => Promise<ImportResult>;
};

/**
 * Bring in a spreadsheet of registrations: pick a .csv or .xlsx file, check
 * which column is which (and match list answers like shifts or grades), see
 * every row that can't come in and why, then import the rest.
 */
export function SpreadsheetImport({ kind, fields, choices = {}, chaperoneLimit = 500, noun, templateName, emailOption, action }: Props) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [columns, setColumns] = useState<Record<string, number | null>>({});
  const [choiceMaps, setChoiceMaps] = useState<Record<string, Record<string, string>>>({});
  const [readError, setReadError] = useState<string | null>(null);
  const [sendEmails, setSendEmails] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setFileName(null);
    setHeaders([]);
    setRows([]);
    setColumns({});
    setChoiceMaps({});
    setReadError(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  async function pick(file: File | undefined) {
    reset();
    setResult(null);
    if (!file) return;
    try {
      const all = await readSpreadsheet(file);
      if (all.length < 2) throw new Error("That file needs a row of headings and at least one row of people.");
      if (all.length - 1 > MAX_IMPORT_ROWS) throw new Error(`That file has ${all.length - 1} rows. Please split it into files of ${MAX_IMPORT_ROWS} rows or fewer.`);
      const [head, ...body] = all;
      const guessed = guessColumns(fields, head);
      setFileName(file.name);
      setHeaders(head);
      setRows(body);
      setColumns(guessed);
      setChoiceMaps(matchChoices(fields, choices, body, guessed));
    } catch (e) {
      setReadError(e instanceof Error ? e.message : "We couldn't read that file.");
    }
  }

  const setColumn = (key: string, col: number | null) => {
    const next = { ...columns, [key]: col };
    setColumns(next);
    setChoiceMaps(matchChoices(fields, choices, rows, next));
  };

  const records = useMemo(() => toRecords(rows, columns, choiceMaps), [rows, columns, choiceMaps]);
  const missing = fields.filter((f) => f.required && columns[f.key] == null);
  const plan = useMemo(() => {
    if (missing.length) return null;
    if (kind === "bands") return planBands(records, { chaperoneLimit });
    if (kind === "volunteers") return planVolunteers(records);
    return planParents(records);
  }, [kind, records, chaperoneLimit, missing.length]);

  const choiceFields = fields.filter((f) => f.choice && columns[f.key] != null && choices[f.key]);

  function submit() {
    if (!plan?.items.length) return;
    startTransition(async () => {
      const r = await action(records, Boolean(emailOption) && sendEmails);
      setResult(r);
      if (r.ok) reset();
    });
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([templateCsv(fields)], { type: CSV_TYPE }));
    const a = document.createElement("a");
    a.href = url;
    a.download = templateName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      {result?.ok && (
        <div role="status" className="rounded-md border border-success/40 bg-success-soft px-4 py-3">
          <p className="font-semibold">✓ {result.message}</p>
          {result.skipped && result.skipped.length > 0 && <Problems problems={result.skipped} title={`${result.skipped.length} couldn't be added`} open />}
        </div>
      )}
      {result?.error && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {result.error}
        </p>
      )}

      {!fileName ? (
        <div className="space-y-3">
          <label htmlFor={`${id}-file`} className="block text-sm font-semibold">
            Pick a spreadsheet file
          </label>
          <input
            ref={fileInput}
            id={`${id}-file`}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => pick(e.target.files?.[0])}
            className="block w-full text-sm file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-surface file:px-4 file:text-sm file:font-semibold hover:file:bg-background"
          />
          <p className="text-sm text-muted">
            An Excel file (.xlsx) or a .csv file. From Google Sheets: File → Download → Microsoft Excel or CSV. The first
            row should be the column headings.{" "}
            <button type="button" onClick={downloadTemplate} className="font-medium text-brand underline underline-offset-2">
              Download a sample file
            </button>
          </p>
          {readError && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {readError}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <span className="font-semibold">{fileName}</span>
              <span className="text-muted"> · {rows.length} row{rows.length === 1 ? "" : "s"}</span>
            </p>
            <Button type="button" variant="ghost" onClick={reset} className="px-2">
              Pick a different file
            </Button>
          </div>

          <fieldset>
            <legend className="font-semibold">Which column is which?</legend>
            <p className="mt-1 text-sm text-muted">We matched what we could from your headings. Fix any that are wrong.</p>
            <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {fields.map((f) => (
                <label key={f.key} className="flex flex-col gap-1">
                  <span className="text-sm font-medium">
                    {f.label}
                    {f.required ? <span className="text-danger"> *</span> : <span className="font-normal text-muted"> (optional)</span>}
                  </span>
                  <Select
                    value={columns[f.key] ?? ""}
                    onChange={(e) => setColumn(f.key, e.target.value === "" ? null : Number(e.target.value))}
                    aria-invalid={f.required && columns[f.key] == null ? true : undefined}
                  >
                    <option value="">— Not in my spreadsheet —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </label>
              ))}
            </div>
            {missing.length > 0 && (
              <p role="alert" className="mt-3 text-sm font-semibold text-danger">
                Pick a column for {missing.map((f) => f.label).join(", ")}.
              </p>
            )}
          </fieldset>

          {choiceFields.map((f) => (
            <ChoiceMatcher
              key={f.key}
              field={f}
              raws={distinct(rows, columns[f.key]!)}
              choices={choices[f.key]}
              value={choiceMaps[f.key] ?? {}}
              onChange={(map) => setChoiceMaps({ ...choiceMaps, [f.key]: map })}
            />
          ))}

          {plan && (
            <section aria-live="polite" className="space-y-3 rounded-md border border-border bg-background p-4">
              <h3 className="font-semibold">Ready to import</h3>
              <p>
                <span className="text-2xl font-semibold">{plan.items.length}</span>{" "}
                {plan.items.length === 1 ? noun.one : noun.many}
                {plan.items.length > 0 && <span className="text-muted"> from {plan.items.reduce((n, i) => n + i.rows.length, 0)} rows</span>}
              </p>
              {plan.problems.length > 0 && (
                <Problems problems={plan.problems} title={`${countRows(plan.problems)} row${countRows(plan.problems) === 1 ? "" : "s"} won't be imported`} />
              )}
              <Preview fields={fields} records={records} problems={plan.problems} choices={choices} />
              {emailOption && (
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" checked={sendEmails} onChange={(e) => setSendEmails(e.target.checked)} className="mt-0.5 h-5 w-5" />
                  <span>{emailOption}</span>
                </label>
              )}
              <Button type="button" onClick={submit} disabled={pending || plan.items.length === 0}>
                {pending ? "Importing…" : `Import ${plan.items.length} ${plan.items.length === 1 ? noun.one : noun.many}`}
              </Button>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Each field's list answers, guessed for every different value in its column. */
function matchChoices(fields: ImportField[], choices: Record<string, Choice[]>, rows: string[][], columns: Record<string, number | null>) {
  const maps: Record<string, Record<string, string>> = {};
  for (const f of fields) {
    const col = columns[f.key];
    if (!f.choice || col == null || !choices[f.key]) continue;
    maps[f.key] = Object.fromEntries(distinct(rows, col).map((raw) => [raw, guessChoice(raw, choices[f.key]) ?? ""]));
  }
  return maps;
}

const distinct = (rows: string[][], col: number) => [...new Set(rows.map((r) => (r[col] ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const countRows = (problems: RowProblem[]) => problems.reduce((n, p) => n + p.rows.length, 0);

function ChoiceMatcher({
  field,
  raws,
  choices,
  value,
  onChange,
}: {
  field: ImportField;
  raws: string[];
  choices: Choice[];
  value: Record<string, string>;
  onChange: (map: Record<string, string>) => void;
}) {
  const unmatched = raws.filter((r) => !value[r]).length;
  return (
    <fieldset>
      <legend className="font-semibold">Match each {field.label.toLowerCase()}</legend>
      <p className="mt-1 text-sm text-muted">
        {unmatched
          ? `${unmatched} of ${raws.length} still need${unmatched === 1 ? "s" : ""} a match.${field.required ? " Rows left unmatched won't be imported." : " Unmatched ones are left blank."}`
          : `All ${raws.length} matched.`}
      </p>
      <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
        {raws.map((raw) => (
          <label key={raw} className="grid items-center gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-4">
            <span className="text-sm break-words">
              {raw}
              <span className="sr-only"> means</span>
            </span>
            <Select value={value[raw] ?? ""} onChange={(e) => onChange({ ...value, [raw]: e.target.value })}>
              <option value="">{field.required ? "— Don't import these —" : "— Leave blank —"}</option>
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Problems({ problems, title, open = false }: { problems: RowProblem[]; title: string; open?: boolean }) {
  return (
    <details open={open} className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto">
        {[...problems].sort((a, b) => a.rows[0] - b.rows[0]).map((p, i) => (
          <li key={i}>
            <span className="font-medium">{p.rows.length === 1 ? `Row ${p.rows[0]}` : `Rows ${p.rows.join(", ")}`}:</span> {p.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The first rows as they'll come in, with any problem beside them. */
function Preview({
  fields,
  records,
  problems,
  choices,
}: {
  fields: ImportField[];
  records: ImportRecord[];
  problems: RowProblem[];
  choices: Record<string, Choice[]>;
}) {
  const shown = fields.filter((f) => records.some((r) => r.values[f.key]));
  const problemOf = new Map(problems.flatMap((p) => p.rows.map((row) => [row, p.message])));
  const label = (f: ImportField, v: string) => (f.choice ? (choices[f.key]?.find((c) => c.value === v)?.label ?? v) : v);
  const first = records.slice(0, 8);
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface">
      <table className="w-full min-w-max text-left text-sm">
        <caption className="sr-only">The first rows of your spreadsheet</caption>
        <thead className="border-b border-border text-xs text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">Row</th>
            {shown.map((f) => (
              <th key={f.key} scope="col" className="px-3 py-2 font-semibold">
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {first.map((r) => (
            <tr key={r.row} className="border-b border-border last:border-0 align-top">
              <th scope="row" className="px-3 py-2 font-medium">
                {r.row}
                {problemOf.has(r.row) && (
                  <span className="block max-w-56 whitespace-normal text-xs font-semibold text-danger">{problemOf.get(r.row)}</span>
                )}
              </th>
              {shown.map((f) => (
                <td key={f.key} className="max-w-56 truncate px-3 py-2">
                  {label(f, r.values[f.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {records.length > first.length && <p className="px-3 py-2 text-xs text-muted">and {records.length - first.length} more rows</p>}
    </div>
  );
}

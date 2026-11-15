// The one spreadsheet (CSV) writer for every download and the import template.
//
// Every field is quoted; text that a spreadsheet would run as a formula (it
// starts with = + - @, a tab, or a carriage return) gets a leading apostrophe,
// so a name typed on a public form can't run in the school's spreadsheet.
// Lines end in CRLF, and the file starts with a UTF-8 byte-order mark so Excel
// reads accents ("García López") correctly. Works on the server and in the
// browser (no imports).

export type CsvValue = string | number | boolean | null | undefined;

/** U+FEFF: tells Excel the file is UTF-8. */
export const CSV_BOM = "﻿";

/** One field, quoted, with formula-like text kept as plain text. Numbers are written as they are. */
export function csvCell(value: CsvValue): string {
  if (value == null) return '""';
  if (typeof value === "number") return Number.isFinite(value) ? `"${value}"` : '""';
  const text = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** A whole file: a heading row and the rows, CRLF line ends, with the byte-order mark. */
export function toCsv(rows: CsvValue[][]): string {
  return CSV_BOM + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** The Content-Type for a CSV download. */
export const CSV_TYPE = "text/csv; charset=utf-8";

/** "Open House visitor list.csv" -> a file name that's safe in a download header. */
export function csvFileName(name: string, fallback = "download") {
  const base = name.replace(/[^\p{L}\p{N} ._-]+/gu, "").replace(/\s+/g, " ").trim() || fallback;
  return base.toLowerCase().endsWith(".csv") ? base : `${base}.csv`;
}

/** In the browser: save rows as a .csv file. */
export function downloadCsv(fileName: string, rows: CsvValue[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: CSV_TYPE }));
  const a = document.createElement("a");
  a.href = url;
  a.download = csvFileName(fileName);
  a.click();
  URL.revokeObjectURL(url);
}

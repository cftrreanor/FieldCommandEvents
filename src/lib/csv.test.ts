// Run with: npm test (node's built-in test runner; Node strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CSV_BOM, csvCell, csvFileName, toCsv } from "./csv.ts";

test("every field is quoted, quotes doubled", () => {
  assert.equal(csvCell("Ava Lopez"), '"Ava Lopez"');
  assert.equal(csvCell('Say "hi"'), '"Say ""hi"""');
  assert.equal(csvCell("a,b\nc"), '"a,b\nc"');
  assert.equal(csvCell(""), '""');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
});

test("text that starts like a formula is kept as text", () => {
  for (const start of ["=", "+", "-", "@", "\t", "\r"]) {
    assert.equal(csvCell(`${start}SUM(A1)`), `"'${start}SUM(A1)"`);
  }
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell("Ann-Marie"), '"Ann-Marie"', "a dash inside is fine");
  assert.equal(csvCell(" =1"), '" =1"', "only the first character counts");
});

test("numbers and yes/no", () => {
  assert.equal(csvCell(-5), '"-5"', "a number is not a formula");
  assert.equal(csvCell(12), '"12"');
  assert.equal(csvCell(Number.NaN), '""');
  assert.equal(csvCell(true), '"Yes"');
  assert.equal(csvCell(false), '"No"');
});

test("a file: byte-order mark, CRLF line ends, accents kept", () => {
  const csv = toCsv([
    ["First name", "Last name"],
    ["Ana", "García López"],
  ]);
  assert.ok(csv.startsWith(CSV_BOM));
  assert.equal(csv, `${CSV_BOM}"First name","Last name"\r\n"Ana","García López"\r\n`);
  assert.equal(Buffer.from(csv, "utf8").subarray(0, 3).toString("hex"), "efbbbf");
});

test("file names", () => {
  assert.equal(csvFileName("Open House: visitor list"), "Open House visitor list.csv");
  assert.equal(csvFileName("a/b\\c.csv"), "abc.csv");
  assert.equal(csvFileName("***"), "download.csv");
});

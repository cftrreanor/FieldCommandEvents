import { GRADES } from "@/lib/grades";
import { normalizePhone } from "@/lib/phone";

/**
 * Spreadsheet imports: which columns each kind of import reads, and how its
 * rows become registrations. The host's browser uses this to preview the
 * import; the server runs the same checks again before saving anything.
 */
export type ImportKind = "bands" | "volunteers" | "parents";

export type ImportField = {
  key: string;
  label: string;
  required?: boolean;
  /** Other headings this column often has. */
  aliases: string[];
  /** For the template's sample row. */
  example: string;
  /** Matched against a list (a shift, a grade, a classification) value by value. */
  choice?: boolean;
};

/** One answer on a list, with other ways a spreadsheet might write it. */
export type Choice = { value: string; label: string; also?: string[] };

/** A spreadsheet row by field key, with its row number in the file. */
export type ImportRecord = { row: number; values: Record<string, string> };

export type RowProblem = { rows: number[]; message: string };

/** What an import reports back: how it went, and the rows left out. */
export type ImportResult = { ok?: boolean; error?: string; message?: string; skipped?: RowProblem[] };

export type ImportPlan<T> = { items: (T & { rows: number[] })[]; problems: RowProblem[] };

/** At most this many rows in one import. */
export const MAX_IMPORT_ROWS = 1000;

const bandFields = (words: { one: string; One: string }, trucks: boolean): ImportField[] => [
  { key: "bandName", label: `${words.One} name`, required: true, aliases: ["band", "group", "ensemble", "ensemble name", "choir", "organization"], example: words.one === "band" ? "Lakeview Marching Band" : "Lakeview Chorale" },
  { key: "schoolName", label: "School", aliases: ["school name", "campus", "high school"], example: "Lakeview High School" },
  { key: "headDirectorName", label: "Head director's name", aliases: ["director", "director name", "head director", "band director", "choir director", "name"], example: "Jordan Lee" },
  { key: "headDirectorEmail", label: "Head director's email", required: true, aliases: ["director email", "email", "email address", "head director email"], example: "jlee@lakeviewisd.org" },
  { key: "headDirectorPhone", label: "Head director's mobile", aliases: ["phone", "mobile", "cell", "director phone", "phone number", "cell phone"], example: "(512) 555-0142" },
  { key: "contactEmail", label: `${words.One} contact email`, aliases: ["contact email", "booster email", "band email", "group email"], example: "boosters@lakeviewisd.org" },
  { key: "classification", label: "Classification", aliases: ["class", "division", "conference", "size"], example: "5A", choice: true },
  { key: "schoolAddress", label: "School address", aliases: ["address", "mailing address", "street address"], example: "100 School Rd, Lakeview, TX 75001" },
  { key: "assistantDirectors", label: "Assistant directors", aliases: ["assistants", "assistant director", "other directors"], example: "Sam Ortiz, Ana Ruiz" },
  { key: "studentCount", label: words.one === "band" ? "Students" : "Performers", aliases: ["students", "participants", "performers", "members", "student count", "number of students"], example: "85" },
  { key: "chaperoneCount", label: "Chaperones", aliases: ["chaperone", "chaperone count", "number of chaperones", "adults"], example: "6" },
  ...(trucks
    ? [
        { key: "busCount", label: "Buses", aliases: ["bus", "bus count", "number of buses"], example: "3" },
        { key: "boxTruckCount", label: "Box trucks", aliases: ["box truck", "equipment truck"], example: "1" },
        { key: "truckTrailerCount", label: "Truck/trailer combos", aliases: ["truck trailer", "trailers", "trailer"], example: "0" },
        { key: "semiTruckCount", label: "Semi trucks", aliases: ["semi", "semis", "18 wheeler"], example: "0" },
      ]
    : [{ key: "busCount", label: "Buses", aliases: ["bus", "bus count", "number of buses"], example: "2" }]),
  { key: "specialNeeds", label: "Accessibility or staging needs", aliases: ["special needs", "accessibility", "notes", "staging"], example: "" },
];

const volunteerFields: ImportField[] = [
  { key: "name", label: "Name", required: true, aliases: ["full name", "volunteer", "volunteer name", "first and last name"], example: "Maria Gomez" },
  { key: "email", label: "Email", required: true, aliases: ["email address", "e-mail"], example: "maria@example.com" },
  { key: "phone", label: "Mobile phone", aliases: ["phone", "mobile", "cell", "phone number", "cell phone"], example: "(512) 555-0199" },
  { key: "shift", label: "Shift", required: true, aliases: ["slot", "time slot", "shift time", "station", "job", "role", "sign up", "item"], example: "Concessions 9-11 AM", choice: true },
  { key: "minor", label: "Under 18?", aliases: ["under 18", "minor", "student", "is minor", "child"], example: "No" },
];

const parentFields: ImportField[] = [
  { key: "parentName", label: "Parent's name", required: true, aliases: ["parent", "parent name", "guardian", "guardian name", "your name", "name"], example: "Chris Lopez" },
  { key: "email", label: "Email", required: true, aliases: ["email address", "parent email", "e-mail"], example: "chris@example.com" },
  { key: "phone", label: "Mobile phone", aliases: ["phone", "mobile", "cell", "phone number"], example: "(512) 555-0123" },
  { key: "childName", label: "Child's name", required: true, aliases: ["child", "student", "student name", "child name", "students name"], example: "Ava Lopez" },
  { key: "teacher", label: "Teacher", required: true, aliases: ["teacher name", "teachers name", "homeroom", "class"], example: "Smith" },
  { key: "grade", label: "Grade", required: true, aliases: ["grade level", "student grade"], example: "3rd", choice: true },
  { key: "otherAdults", label: "Other adults coming", aliases: ["other adults", "additional adults", "guests", "other guests", "who else is coming"], example: "Marco Lopez" },
];

export function importFields(kind: ImportKind, opts: { words?: { one: string; One: string }; trucks?: boolean } = {}): ImportField[] {
  if (kind === "volunteers") return volunteerFields;
  if (kind === "parents") return parentFields;
  return bandFields(opts.words ?? { one: "band", One: "Band" }, opts.trucks ?? true);
}

/** Grades as parents write them: "3", "Third", "3rd grade", "Kindergarten". */
export const GRADE_CHOICES: Choice[] = GRADES.map((g, i) => {
  const words = ["", "", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];
  const also =
    g === "Pre-K" ? ["prek", "pre kindergarten", "prekindergarten", "pk"] : g === "K" ? ["kinder", "kindergarten", "kg"] : [String(i - 1), words[i], `grade ${i - 1}`, `${g} grade`];
  return { value: g, label: g, also };
});

// ---------------------------------------------------------------------------
// Matching the spreadsheet to the fields.
// ---------------------------------------------------------------------------

/** "Head Director's E-mail:" -> "headdirectorsemail" */
export const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Which spreadsheet column (by index) each field reads, guessed from the headings. */
export function guessColumns(fields: ImportField[], headers: string[]): Record<string, number | null> {
  const used = new Set<number>();
  const result: Record<string, number | null> = {};
  const names = (f: ImportField) => [f.label, f.key, ...f.aliases].map(squash).filter(Boolean);
  const pick = (f: ImportField, test: (h: string, n: string) => boolean) => {
    if (result[f.key] != null) return;
    const i = headers.findIndex((h, i) => !used.has(i) && names(f).some((n) => test(squash(h), n)));
    if (i >= 0) {
      result[f.key] = i;
      used.add(i);
    }
  };
  // Exact headings first, then headings that contain a name ("Parent Email Address").
  for (const f of fields) pick(f, (h, n) => h === n);
  for (const f of fields) pick(f, (h, n) => n.length >= 4 && h.includes(n));
  for (const f of fields) result[f.key] ??= null;
  return result;
}

/** The answer a spreadsheet value means, if it plainly matches one. */
export function guessChoice(raw: string, choices: Choice[]): string | null {
  const v = squash(raw);
  if (!v) return null;
  const names = (c: Choice) => [c.value, c.label, ...(c.also ?? [])].map(squash);
  const exact = choices.find((c) => names(c).some((x) => x === v));
  if (exact) return exact.value;
  // Otherwise only an answer that's plainly the one meant: the only one that
  // contains it, or is a word in it ("Class 6A" -> 6A).
  const words = raw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const close = choices.filter((c) =>
    names(c).some((x) => (v.length >= 4 && (x.includes(v) || (x.length >= 4 && v.includes(x)))) || words.includes(x)),
  );
  return close.length === 1 ? close[0].value : null;
}

/** Rows as field values: each field's column, and list answers as matched. */
export function toRecords(
  rows: string[][],
  columns: Record<string, number | null>,
  choiceMaps: Record<string, Record<string, string>>,
): ImportRecord[] {
  return rows.map((cells, i) => {
    const values: Record<string, string> = {};
    for (const [key, col] of Object.entries(columns)) {
      if (col == null) continue;
      const raw = (cells[col] ?? "").trim();
      values[key] = choiceMaps[key] ? (choiceMaps[key][raw] ?? "") : raw;
    }
    // Row 1 is the headings.
    return { row: i + 2, values };
  });
}

// ---------------------------------------------------------------------------
// From rows to what gets saved.
// ---------------------------------------------------------------------------

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const isEmail = (s: string) => EMAIL.test(s);
const yes = (s: string) => /^(y|yes|true|x|1|✓|under 18|minor|student)$/i.test(s.trim());
const list = (s: string) =>
  s
    .split(/[\n,;]/)
    .map((x) => x.trim().replace(/\s+/g, " "))
    .filter(Boolean);
const blankRow = (r: ImportRecord) => Object.values(r.values).every((v) => !v);

/** "85", "85 students" -> 85. Blank -> null. */
function whole(raw: string | undefined, label: string, max: number): { n: number | null; problem?: string } {
  const s = (raw ?? "").trim();
  if (!s) return { n: null };
  const m = s.match(/^\D*?(\d+)(?:\.0+)?\b/);
  if (!m) return { n: null, problem: `${label} isn't a number (“${s}”).` };
  const n = Number(m[1]);
  if (n > max) return { n: null, problem: `${label} looks too high (${n}).` };
  return { n };
}

export type BandPrefill = {
  email: string;
  band_name: string;
  school_name: string | null;
  classification: string | null;
  school_address: string | null;
  contact_email: string | null;
  head_director_name: string | null;
  head_director_phone: string | null;
  assistant_directors: string[];
  student_count: number | null;
  chaperone_count: number | null;
  bus_count: number | null;
  box_truck_count: number | null;
  truck_trailer_count: number | null;
  semi_truck_count: number | null;
  special_needs: string | null;
};

/** Each row is one director's band or group. A blank or unknown classification is left for the director to pick. */
export function planBands(records: ImportRecord[], ctx: { chaperoneLimit: number }): ImportPlan<BandPrefill> {
  const items: ImportPlan<BandPrefill>["items"] = [];
  const problems: RowProblem[] = [];
  const seen = new Map<string, number>();
  for (const r of records) {
    if (blankRow(r)) continue;
    const v = r.values;
    const fail = (message: string) => problems.push({ rows: [r.row], message });
    const email = (v.headDirectorEmail ?? "").toLowerCase();
    const bandName = (v.bandName ?? "").replace(/\s+/g, " ");
    if (bandName.length < 2) {
      fail("The ensemble name is missing.");
      continue;
    }
    if (!isEmail(email)) {
      fail(email ? `The head director's email isn't valid (“${email}”).` : "The head director's email is missing.");
      continue;
    }
    const contact = (v.contactEmail ?? "").toLowerCase();
    if (contact && !isEmail(contact)) {
      fail(`The contact email isn't valid (“${contact}”).`);
      continue;
    }
    let phone: string | null = null;
    if (v.headDirectorPhone) {
      phone = normalizePhone(v.headDirectorPhone);
      if (!phone) {
        fail(`The mobile number needs 10 digits (“${v.headDirectorPhone}”).`);
        continue;
      }
    }
    const counts = {
      student_count: whole(v.studentCount, "Students", 1000),
      chaperone_count: whole(v.chaperoneCount, "Chaperones", 500),
      bus_count: whole(v.busCount, "Buses", 50),
      box_truck_count: whole(v.boxTruckCount, "Box trucks", 20),
      truck_trailer_count: whole(v.truckTrailerCount, "Truck/trailer combos", 20),
      semi_truck_count: whole(v.semiTruckCount, "Semi trucks", 20),
    };
    const countProblem = Object.values(counts).find((c) => c.problem)?.problem;
    if (countProblem) {
      fail(countProblem);
      continue;
    }
    if ((counts.chaperone_count.n ?? 0) > ctx.chaperoneLimit) {
      fail(`This event allows ${ctx.chaperoneLimit} chaperones; this row has ${counts.chaperone_count.n}.`);
      continue;
    }
    const key = `${email}|${bandName.toLowerCase()}`;
    if (seen.has(key)) {
      fail(`${bandName} for ${email} is already on row ${seen.get(key)}.`);
      continue;
    }
    seen.set(key, r.row);
    const text = (s: string | undefined, max: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
    items.push({
      rows: [r.row],
      email,
      band_name: bandName.slice(0, 150),
      school_name: text(v.schoolName, 150),
      classification: v.classification || null,
      school_address: text(v.schoolAddress, 300),
      contact_email: contact || null,
      head_director_name: text(v.headDirectorName, 150),
      head_director_phone: phone,
      assistant_directors: list(v.assistantDirectors ?? "").slice(0, 20),
      student_count: counts.student_count.n,
      chaperone_count: counts.chaperone_count.n,
      bus_count: counts.bus_count.n,
      box_truck_count: counts.box_truck_count.n,
      truck_trailer_count: counts.truck_trailer_count.n,
      semi_truck_count: counts.semi_truck_count.n,
      special_needs: (v.specialNeeds ?? "").trim().slice(0, 2000) || null,
    });
  }
  return { items, problems };
}

export type VolunteerImport = {
  name: string;
  email: string;
  phone: string | null;
  minor: boolean;
  companions: { name: string; minor: boolean }[];
  shiftIds: string[];
};

/**
 * One row per person per shift. Rows sharing an email are one sign-up: the
 * first adult is the contact and everyone in it takes all its shifts (like
 * signing up together on the public form).
 */
export function planVolunteers(records: ImportRecord[]): ImportPlan<VolunteerImport> {
  const problems: RowProblem[] = [];
  const groups = new Map<string, ImportRecord[]>();
  for (const r of records) {
    if (blankRow(r)) continue;
    const v = r.values;
    const fail = (message: string) => problems.push({ rows: [r.row], message });
    const email = (v.email ?? "").toLowerCase();
    if ((v.name ?? "").trim().length < 2) fail("The name is missing.");
    else if (!isEmail(email)) fail(email ? `The email isn't valid (“${email}”).` : "The email is missing.");
    else if (!v.shift) fail("The shift isn't matched to one of your shifts.");
    else if (v.phone && !normalizePhone(v.phone)) fail(`The mobile number needs 10 digits (“${v.phone}”).`);
    else groups.set(email, [...(groups.get(email) ?? []), r]);
  }

  const items: ImportPlan<VolunteerImport>["items"] = [];
  for (const [email, rows] of groups) {
    const people = new Map<string, { name: string; minor: boolean }>();
    for (const r of rows) {
      const name = r.values.name.trim().replace(/\s+/g, " ");
      if (!people.has(name.toLowerCase())) people.set(name.toLowerCase(), { name, minor: yes(r.values.minor ?? "") });
    }
    const everyone = [...people.values()];
    const contact = everyone.find((p) => !p.minor) ?? everyone[0];
    const companions = everyone.filter((p) => p !== contact);
    const rowNumbers = rows.map((r) => r.row);
    if (companions.length > 4) {
      problems.push({ rows: rowNumbers, message: `${everyone.length} people share ${email}; up to 5 can sign up together.` });
      continue;
    }
    const phone = rows.map((r) => (r.values.phone ? normalizePhone(r.values.phone) : null)).find(Boolean) ?? null;
    items.push({
      rows: rowNumbers,
      name: contact.name,
      email,
      phone,
      minor: contact.minor,
      companions,
      shiftIds: [...new Set(rows.map((r) => r.values.shift))],
    });
  }
  return { items, problems };
}

export type ParentImport = {
  parentName: string;
  email: string;
  phone: string | null;
  children: { name: string; teacher: string; grade: string }[];
  otherAdults: string[];
};

/** One row per child. Rows sharing an email are one family's registration. */
export function planParents(records: ImportRecord[]): ImportPlan<ParentImport> {
  const problems: RowProblem[] = [];
  const families = new Map<string, ImportRecord[]>();
  for (const r of records) {
    if (blankRow(r)) continue;
    const v = r.values;
    const fail = (message: string) => problems.push({ rows: [r.row], message });
    const email = (v.email ?? "").toLowerCase();
    if ((v.parentName ?? "").trim().length < 2) fail("The parent's name is missing.");
    else if (!isEmail(email)) fail(email ? `The email isn't valid (“${email}”).` : "The email is missing.");
    else if ((v.childName ?? "").trim().length < 2) fail("The child's name is missing.");
    else if (!(v.teacher ?? "").trim()) fail("The teacher is missing.");
    else if (!v.grade) fail("The grade isn't matched to a grade.");
    else if (v.phone && !normalizePhone(v.phone)) fail(`The mobile number needs 10 digits (“${v.phone}”).`);
    else families.set(email, [...(families.get(email) ?? []), r]);
  }

  const items: ImportPlan<ParentImport>["items"] = [];
  for (const [email, rows] of families) {
    const rowNumbers = rows.map((r) => r.row);
    const children = new Map<string, ParentImport["children"][number]>();
    for (const r of rows) {
      const name = r.values.childName.trim().replace(/\s+/g, " ").slice(0, 120);
      children.set(name.toLowerCase(), { name, teacher: r.values.teacher.trim().slice(0, 80), grade: r.values.grade });
    }
    const parentName = rows[0].values.parentName.trim().replace(/\s+/g, " ");
    const otherAdults = [
      ...new Map(rows.flatMap((r) => list(r.values.otherAdults ?? "")).map((a) => [a.toLowerCase(), a.slice(0, 120)])).values(),
    ].filter((a) => a.toLowerCase() !== parentName.toLowerCase());
    if (children.size > 8) problems.push({ rows: rowNumbers, message: `${email} has ${children.size} children; up to 8 fit on one registration.` });
    else if (otherAdults.length > 5) problems.push({ rows: rowNumbers, message: `${email} lists ${otherAdults.length} other adults; up to 5 can come.` });
    else if (otherAdults.some((a) => a.length < 2)) problems.push({ rows: rowNumbers, message: `Please give each other adult's full name for ${email}.` });
    else {
      const phone = rows.map((r) => (r.values.phone ? normalizePhone(r.values.phone) : null)).find(Boolean) ?? null;
      items.push({ rows: rowNumbers, parentName: parentName.slice(0, 200), email, phone, children: [...children.values()], otherAdults });
    }
  }
  return { items, problems };
}

/** The sample file a host can download and fill in. */
export function templateCsv(fields: ImportField[]) {
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return `${fields.map((f) => cell(f.label)).join(",")}\n${fields.map((f) => cell(f.example)).join(",")}\n`;
}

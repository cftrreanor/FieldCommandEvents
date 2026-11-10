"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { NumberInput } from "@/components/number-input";
import { Field, Input } from "@/components/ui";
import { EVENT_TYPES } from "@/lib/event-types";
import type { Tier } from "@/lib/package-names";
import { dollars, PACKAGES } from "@/lib/plan";
import {
  createPackage,
  packageImpact,
  savePackage,
  savePackageDetails,
  savePassPrice,
  setPackageRetired,
  type Impact,
  type PackageDetails,
  type PackageValues,
} from "./actions";

type Setting = "yes" | "one" | "no";
type Editing =
  | { kind: "type"; code: string; type: string }
  | { kind: "event_staff" | "volunteer_history"; code: string }
  | { kind: "team"; code: string }
  | { kind: "details"; code: string }
  | { kind: "pass"; code: string };

const SETTING_LABEL: Record<Setting, string> = { yes: "Included", one: "One at a time", no: "Not included" };
const cellClass: Record<Setting, string> = {
  yes: "bg-success-soft text-success",
  one: "bg-warning-soft text-warning",
  no: "border border-border text-muted",
};

const valuesOf = (p: Tier): PackageValues => ({
  event_types: p.event_types,
  one_at_a_time: p.one_at_a_time,
  max_team: p.max_team,
  event_staff: p.event_staff,
  volunteer_history: p.volunteer_history,
});
const typeSetting = (p: Tier, type: string): Setting =>
  p.one_at_a_time.includes(type) ? "one" : p.event_types.includes(type) ? "yes" : "no";
const withType = (v: PackageValues, type: string, s: Setting): PackageValues => ({
  ...v,
  event_types: s === "no" ? v.event_types.filter((t) => t !== type) : [...new Set([...v.event_types, type])],
  one_at_a_time: s === "one" ? [...new Set([...v.one_at_a_time, type])] : v.one_at_a_time.filter((t) => t !== type),
});
const money = (cents: number | null | undefined) => (cents == null ? "Not set" : dollars(cents));
const priceClass = (cents: number | null | undefined) => (cents == null ? "border border-border font-normal text-muted" : "border border-border");
const toDollars = (cents: number | null | undefined) => (cents == null ? "" : String(Math.round(cents / 100)));
// The packages that came with the product: never tagged "New".
const BUILT_IN: string[] = PACKAGES.map((p) => p.value);
// New accounts and teachers start on these, so they can't be retired (20270127000000_package_create_retire.sql).
const CANT_RETIRE = ["free_teacher", "free", "event"];
const tagClass = "mx-auto mt-1 block w-fit rounded-sm px-1.5 py-px text-xs font-semibold text-foreground ring-1";

/** The packages as a grid: a column each, a row for each thing they include. Selecting a box opens its editor. */
export function PackagesGrid({ packages, passes, counts }: { packages: Tier[]; passes: Tier[]; counts: Record<string, number> }) {
  const [editing, setEditingState] = useState<Editing | null>(null);
  const [creating, setCreating] = useState(false);
  // The box that opened the editor, to put focus back on when it closes.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const setEditing = (e: Editing | null) => {
    if (e) setOpener(document.activeElement as HTMLElement | null);
    setEditingState(e);
    if (!e) requestAnimationFrame(() => opener?.focus());
  };
  const [saved, setSaved] = useState<{ message: string; undo?: () => Promise<{ ok: true } | { error: string }> } | null>(null);
  const router = useRouter();
  const [undoing, startUndo] = useTransition();
  const pkg = (code: string) => packages.find((p) => p.code === code)!;

  const cell = (label: string, cls: string, onClick: () => void, aria: string) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={aria}
      className={`inline-flex min-h-9 items-center justify-center rounded-full px-3 text-sm font-semibold whitespace-nowrap hover:ring-2 hover:ring-brand/40 ${cls}`}
    >
      {label}
    </button>
  );
  const sectionRow = (title: string) => (
    <tr>
      <td colSpan={packages.length + 1} className="border-b border-border bg-background px-3 py-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
        <span className="sticky left-3">{title}</span>
      </td>
    </tr>
  );
  const row = (title: string, render: (p: Tier) => React.ReactNode) => (
    <tr className="border-b border-border last:border-0">
      <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-sm font-semibold">
        {title}
      </th>
      {packages.map((p) => (
        <td key={p.code} className="px-2 py-2 text-center">
          {render(p)}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted lg:hidden">Scroll sideways to see every package →</p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-auto inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:bg-background"
        >
          + New package
        </button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-background">
              <th scope="col" className="sticky left-0 z-10 bg-background px-3 py-2 text-left font-semibold">
                What it includes
              </th>
              {packages.map((p) => (
                <th key={p.code} scope="col" className="px-2 py-2 text-center align-bottom">
                  <button
                    type="button"
                    onClick={() => setEditing({ kind: "details", code: p.code })}
                    className="rounded-sm px-1 font-semibold text-brand underline decoration-dotted underline-offset-4 hover:decoration-solid"
                    aria-label={`${p.name}: change its name and prices`}
                  >
                    {p.name}
                  </button>
                  <span className="block text-xs font-normal text-muted">
                    {counts[p.code] ?? 0} account{(counts[p.code] ?? 0) === 1 ? "" : "s"}
                    {/* "New" until its first account joins; "Retired" while it isn't offered. */}
                    {p.retired_at ? (
                      <span className={`${tagClass} bg-warning-soft ring-warning/50`}>Retired</span>
                    ) : (
                      !BUILT_IN.includes(p.code) && !counts[p.code] && <span className={`${tagClass} bg-success-soft ring-success/50`}>New</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sectionRow("Price")}
            {row("Monthly", (p) => cell(money(p.price_month_cents), priceClass(p.price_month_cents), () => setEditing({ kind: "details", code: p.code }), `${p.name} monthly price: ${money(p.price_month_cents)}. Change`))}
            {row("Yearly", (p) => cell(money(p.price_year_cents), priceClass(p.price_year_cents), () => setEditing({ kind: "details", code: p.code }), `${p.name} yearly price: ${money(p.price_year_cents)}. Change`))}
            {row("Teacher rate", (p) =>
              p.teacher_rate ? (
                cell(
                  `${money(p.teacher_month_cents)} / ${money(p.teacher_year_cents)}`,
                  "border border-border",
                  () => setEditing({ kind: "details", code: p.code }),
                  `${p.name} teacher prices: ${money(p.teacher_month_cents)} a month, ${money(p.teacher_year_cents)} a year. Change`,
                )
              ) : (
                <span className="text-sm text-muted">No teacher price</span>
              ),
            )}
            {sectionRow("Event types")}
            {EVENT_TYPES.map((t) =>
              row(t.label, (p) => {
                const s = typeSetting(p, t.value);
                return cell(SETTING_LABEL[s], cellClass[s], () => setEditing({ kind: "type", code: p.code, type: t.value }), `${t.label} on ${p.name}: ${SETTING_LABEL[s]}`);
              }),
            )}
            {sectionRow("Volunteers and team")}
            {row("Volunteer tracking", (p) => {
              const s: Setting = p.volunteer_history ? "yes" : "no";
              return cell(SETTING_LABEL[s], cellClass[s], () => setEditing({ kind: "volunteer_history", code: p.code }), `Volunteer tracking on ${p.name}: ${SETTING_LABEL[s]}`);
            })}
            {row("Volunteer Leads and Coordinators", (p) => {
              const s: Setting = p.event_staff ? "yes" : "no";
              return cell(SETTING_LABEL[s], cellClass[s], () => setEditing({ kind: "event_staff", code: p.code }), `Volunteer Leads and Coordinators on ${p.name}: ${SETTING_LABEL[s]}`);
            })}
            {row("Team spots", (p) =>
              cell(p.max_team == null ? "Unlimited" : String(p.max_team), "border border-border", () => setEditing({ kind: "team", code: p.code }), `Team spots on ${p.name}: ${p.max_team ?? "unlimited"}`),
            )}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">
        Nothing anyone already has is taken away: published events stay live and nobody is removed from a team. A change only stops new
        publishing or new invitations. These prices aren&apos;t charged yet; they&apos;re for reference. Every change is in{" "}
        <a href="/admin/activity" className="font-semibold text-brand underline underline-offset-4">
          Activity
        </a>
        .
      </p>

      <section className="max-w-xl rounded-md border border-border bg-surface">
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">Event passes</h2>
          <p className="text-sm text-muted">One event of a type the package doesn&apos;t include.</p>
        </div>
        <ul className="divide-y divide-border">
          {passes.map((p) => (
            <li key={p.code} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="font-semibold">{p.name}</span>
              {cell(money(p.price_cents), priceClass(p.price_cents), () => setEditing({ kind: "pass", code: p.code }), `${p.name} price: ${money(p.price_cents)}. Change`)}
            </li>
          ))}
        </ul>
      </section>

      {/* Saved, with Undo: pinned to the bottom of the screen, so it shows wherever the change was made. */}
      <div aria-live="polite" className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 print:hidden">
        {saved && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-success/40 bg-surface px-4 py-3 text-sm shadow-elevated">
            <span>
              <span className="font-semibold text-success">✓ Saved.</span> {saved.message}
            </span>
            {saved.undo && (
              <button
                type="button"
                disabled={undoing}
                onClick={() =>
                  startUndo(async () => {
                    const r = await saved.undo!();
                    setSaved("error" in r ? { message: `Couldn't undo: ${r.error}` } : { message: "Put back as it was." });
                    router.refresh();
                  })
                }
                className="inline-flex min-h-9 items-center font-semibold text-brand underline underline-offset-4"
              >
                {undoing ? "Undoing…" : "Undo"}
              </button>
            )}
            <button type="button" onClick={() => setSaved(null)} className="inline-flex min-h-9 items-center text-muted underline underline-offset-4">
              Close
            </button>
          </div>
        )}
      </div>

      {creating && (
        <NewPackage
          packages={packages.filter((p) => !p.retired_at)}
          onClose={() => setCreating(false)}
          onCreated={(message) => {
            setCreating(false);
            setSaved({ message });
            router.refresh();
          }}
        />
      )}

      {editing && (
        <Editor
          key={JSON.stringify(editing)}
          editing={editing}
          pkg={editing.kind === "pass" ? null : pkg(editing.code)}
          pass={editing.kind === "pass" ? passes.find((p) => p.code === editing.code)! : null}
          onClose={() => setEditing(null)}
          onSaved={(message, undo) => {
            setEditing(null);
            setSaved({ message, undo });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** The editor for one box, in a window: the choice, who it affects, a note, and Save. */
function Editor({
  editing,
  pkg,
  pass,
  onClose,
  onSaved,
}: {
  editing: Editing;
  pkg: Tier | null;
  pass: Tier | null;
  onClose: () => void;
  onSaved: (message: string, undo?: () => Promise<{ ok: true } | { error: string }>) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  // Who the current choice affects: null while checking; "failed" if the check didn't come back.
  const [impact, setImpact] = useState<Impact | "failed" | null>(null);
  const [checkKey, setCheckKey] = useState(0);

  // The current setting, and the one being picked.
  const typeLabel = editing.kind === "type" ? EVENT_TYPES.find((t) => t.value === editing.type)?.label ?? editing.type : "";
  const now: Setting | null =
    pkg && editing.kind === "type"
      ? typeSetting(pkg, editing.type)
      : pkg && (editing.kind === "event_staff" || editing.kind === "volunteer_history")
        ? pkg[editing.kind]
          ? "yes"
          : "no"
        : null;
  const [choice, setChoice] = useState<Setting | null>(now);
  const [team, setTeam] = useState(pkg?.max_team == null ? "" : String(pkg.max_team));
  const [details, setDetails] = useState({
    name: pkg?.name ?? "",
    month: toDollars(pkg?.price_month_cents),
    year: toDollars(pkg?.price_year_cents),
    teacher_month: toDollars(pkg?.teacher_month_cents),
    teacher_year: toDollars(pkg?.teacher_year_cents),
  });
  const [price, setPrice] = useState(toDollars(pass?.price_cents));

  // Who the change would affect, as the choice changes.
  const row = editing.kind === "type" ? editing.type : editing.kind === "team" ? "max_team" : editing.kind;
  const teamNumber = team.trim() === "" ? null : Number(team);
  const needsCheck = editing.kind !== "details" && editing.kind !== "pass";
  useEffect(() => {
    if (!pkg || !needsCheck) return;
    let live = true;
    const t = setTimeout(async () => {
      setImpact(null);
      try {
        const r = await packageImpact(pkg.code, row, choice, editing.kind === "team" ? teamNumber : null);
        if (live) setImpact("error" in r ? "failed" : r);
      } catch {
        if (live) setImpact("failed");
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [pkg, needsCheck, editing.kind, row, choice, teamNumber, checkKey]);

  // Why Save is off, in words (null when it can save).
  const problem =
    editing.kind === "team" && team.trim() !== "" && (teamNumber === null || teamNumber < 1)
      ? "Enter 1 or more, or leave it empty for unlimited."
      : editing.kind === "details" && details.name.trim().length < 2
        ? "Give the package a name."
        : editing.kind === "pass" && price.trim() === ""
          ? "Enter a price, or 0."
          : null;
  const changed =
    editing.kind === "team"
      ? teamNumber !== pkg?.max_team && (teamNumber === null || teamNumber >= 1)
      : editing.kind === "details"
        ? details.name.trim() !== pkg?.name ||
          details.month !== toDollars(pkg?.price_month_cents) ||
          details.year !== toDollars(pkg?.price_year_cents) ||
          details.teacher_month !== toDollars(pkg?.teacher_month_cents) ||
          details.teacher_year !== toDollars(pkg?.teacher_year_cents)
        : editing.kind === "pass"
          ? price !== toDollars(pass?.price_cents)
          : choice !== now;
  const checking = needsCheck && changed && impact === null;

  const save = () =>
    startSave(async () => {
      setError(null);
      if (editing.kind === "pass" && pass) {
        const was = pass.price_cents ?? 0;
        const r = await savePassPrice(pass.code, Number(price), note);
        if ("error" in r) return setError(r.error);
        return onSaved(`${pass.name} is now ${dollars(Number(price) * 100)}.`, () => savePassPrice(pass.code, Math.round(was / 100), "Undo"));
      }
      if (!pkg) return;
      if (editing.kind === "details") {
        const num = (v: string) => (v.trim() === "" ? null : Number(v));
        const d: PackageDetails = {
          name: details.name.trim(),
          month: num(details.month),
          year: num(details.year),
          teacher_month: num(details.teacher_month),
          teacher_year: num(details.teacher_year),
        };
        const before: PackageDetails = {
          name: pkg.name,
          month: pkg.price_month_cents == null ? null : pkg.price_month_cents / 100,
          year: pkg.price_year_cents == null ? null : pkg.price_year_cents / 100,
          teacher_month: pkg.teacher_month_cents == null ? null : pkg.teacher_month_cents / 100,
          teacher_year: pkg.teacher_year_cents == null ? null : pkg.teacher_year_cents / 100,
        };
        const r = await savePackageDetails(pkg.code, d, note);
        if ("error" in r) return setError(r.error);
        return onSaved(`${d.name} is saved.`, () => savePackageDetails(pkg.code, before, "Undo"));
      }
      const before = valuesOf(pkg);
      let next = before;
      let message = "";
      if (editing.kind === "type" && choice) {
        next = withType(before, editing.type, choice);
        message = `${typeLabel}: ${SETTING_LABEL[choice].toLowerCase()} on ${pkg.name}.`;
      } else if ((editing.kind === "event_staff" || editing.kind === "volunteer_history") && choice) {
        next = { ...before, [editing.kind]: choice === "yes" };
        message = `${editing.kind === "event_staff" ? "Volunteer Leads and Coordinators" : "Volunteer tracking"}: ${SETTING_LABEL[choice].toLowerCase()} on ${pkg.name}.`;
      } else if (editing.kind === "team") {
        next = { ...before, max_team: teamNumber };
        message = `${pkg.name} now has ${teamNumber == null ? "unlimited" : teamNumber} team spots.`;
      }
      const r = await savePackage(pkg.code, next, note);
      if ("error" in r) return setError(r.error);
      onSaved(message, () => savePackage(pkg.code, before, "Undo"));
    });

  const title =
    editing.kind === "type"
      ? `${typeLabel} on ${pkg?.name}`
      : editing.kind === "event_staff"
        ? `Volunteer Leads and Coordinators on ${pkg?.name}`
        : editing.kind === "volunteer_history"
          ? `Volunteer tracking on ${pkg?.name}`
          : editing.kind === "team"
            ? `Team spots on ${pkg?.name}`
            : editing.kind === "details"
              ? pkg && !CANT_RETIRE.includes(pkg.code)
                ? `${pkg.name}: name, prices, and retiring`
                : `${pkg?.name}: name and prices`
              : `${pass?.name}: price`;
  const options: { value: Setting; hint: string }[] =
    editing.kind === "type"
      ? [
          { value: "yes", hint: "Publish as many as they like" },
          { value: "one", hint: "One published at a time; more can be drafts" },
          { value: "no", hint: "They can still try it in a draft, or buy a pass" },
        ]
      : [
          { value: "yes", hint: "" },
          { value: "no", hint: "" },
        ];

  const affectedNote = () => {
    if (!pkg || !needsCheck) return null;
    if (impact === null) return changed ? <p className="mt-3 text-sm text-muted">Checking who this affects…</p> : null;
    if (impact === "failed")
      return (
        <p className="mt-3 text-sm">
          <span className="font-semibold text-danger">Couldn&apos;t check who this affects.</span>{" "}
          <button type="button" onClick={() => setCheckKey((k) => k + 1)} className="font-semibold text-brand underline underline-offset-4">
            Try again
          </button>
        </p>
      );
    const n = impact.accounts;
    const accounts = `${n} account${n === 1 ? " is" : "s are"} on ${pkg.name}.`;
    if (!impact.affected.length) {
      if (choice && choice !== "no" && choice !== now && editing.kind !== "team") return <p className="mt-3 text-sm">{accounts} The change applies to them as soon as you save.</p>;
      return <p className="mt-3 text-sm">{accounts}</p>;
    }
    const what =
      editing.kind === "team"
        ? `would be over ${teamNumber}. Nobody is removed; they can't invite anyone new until they're under it.`
        : editing.kind === "event_staff"
          ? "have Volunteer Leads or Coordinators on upcoming events. They stay; these accounts can't invite more."
          : `have a published ${typeLabel.toLowerCase()}. Those stay live and editable; ${choice === "one" ? "they can't publish another while one is up" : "these accounts can't publish another until they upgrade or buy a pass"}.`;
    return (
      <div className="mt-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
        <p className="font-semibold">
          {impact.affected.length} of {n} account{n === 1 ? "" : "s"} {what.split(".")[0]}.
        </p>
        <ul className="mt-1 list-disc pl-5">
          {impact.affected.slice(0, 8).map((a) => (
            <li key={a.id}>
              {a.name}: {a.detail}
            </li>
          ))}
          {impact.affected.length > 8 && <li>and {impact.affected.length - 8} more</li>}
        </ul>
        <p className="mt-1">{what.split(". ").slice(1).join(". ")}</p>
      </div>
    );
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="pkg-editor-title"
      onClose={onClose}
      className="m-auto w-[min(560px,calc(100vw-2rem))] rounded-lg border border-field-border bg-surface p-5 text-foreground shadow-elevated backdrop:bg-[#071a31]/55"
    >
      <h2 id="pkg-editor-title" className="text-lg font-semibold">
        {title}
      </h2>

      {(editing.kind === "type" || editing.kind === "event_staff" || editing.kind === "volunteer_history") && (
        <fieldset className="mt-3 space-y-2">
          <legend className="sr-only">{title}</legend>
          {options.map((o) => (
            <label
              key={o.value}
              className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 ${choice === o.value ? "border-brand bg-brand-soft" : "border-border"}`}
            >
              <input type="radio" name="setting" checked={choice === o.value} onChange={() => setChoice(o.value)} className="mt-1 size-4 accent-[var(--brand)]" />
              <span className="text-sm">
                <span className="font-semibold">{SETTING_LABEL[o.value]}</span>
                {o.value === now && <span className="text-muted"> (now)</span>}
                {o.hint && <span className="block text-muted">{o.hint}</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {editing.kind === "team" && (
        <Field label="Team spots" hint={`Leave empty for unlimited. Now: ${pkg?.max_team ?? "unlimited"}.`} className="mt-3 max-w-xs">
          <NumberInput value={team} onChange={(e) => setTeam(e.target.value)} />
        </Field>
      )}

      {editing.kind === "details" && pkg && (
        <div className="mt-3 space-y-3">
          <Field label="Name" hint="Renaming changes it everywhere: account pages, invitations, and messages. Accounts stay on this package.">
            <Input value={details.name} maxLength={60} onChange={(e) => setDetails({ ...details, name: e.target.value })} />
          </Field>
          <p className="text-sm text-muted">Prices in whole dollars. Leave any price empty for not set.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Monthly price ($)">
              <NumberInput value={details.month} onChange={(e) => setDetails({ ...details, month: e.target.value })} />
            </Field>
            <Field label="Yearly price ($)">
              <NumberInput value={details.year} onChange={(e) => setDetails({ ...details, year: e.target.value })} />
            </Field>
            {pkg.teacher_rate && (
              <>
                <Field label="Teacher monthly ($)">
                  <NumberInput value={details.teacher_month} onChange={(e) => setDetails({ ...details, teacher_month: e.target.value })} />
                </Field>
                <Field label="Teacher yearly ($)">
                  <NumberInput value={details.teacher_year} onChange={(e) => setDetails({ ...details, teacher_year: e.target.value })} />
                </Field>
              </>
            )}
          </div>
        </div>
      )}

      {editing.kind === "pass" && pass && (
        <Field label="Price ($)" hint={`Now ${money(pass.price_cents)}. Passes already added keep the price they were added at.`} className="mt-3 max-w-xs">
          <NumberInput value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
      )}

      <div aria-live="polite">{affectedNote()}</div>

      <Field label="Note for the activity log (optional)" className="mt-3">
        <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </Field>

      {problem && changed && <p className="mt-3 text-sm font-semibold text-danger">{problem}</p>}
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          className="inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold"
        >
          Keep as is
        </button>
        <button
          type="button"
          disabled={!changed || saving || checking || !!problem}
          onClick={save}
          className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground disabled:cursor-not-allowed disabled:border disabled:border-field-border disabled:bg-transparent disabled:text-disabled"
        >
          {saving ? "Saving…" : checking ? "Checking…" : "Save change"}
        </button>
      </div>

      {editing.kind === "details" && pkg && !CANT_RETIRE.includes(pkg.code) && <RetireSection pkg={pkg} note={note} onSaved={onSaved} />}
    </dialog>
  );
}

/** Retire a package, or bring it back: at the bottom of its name-and-prices window. */
function RetireSection({
  pkg,
  note,
  onSaved,
}: {
  pkg: Tier;
  note: string;
  onSaved: (message: string, undo?: () => Promise<{ ok: true } | { error: string }>) => void;
}) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const retired = !!pkg.retired_at;
  const toggle = () =>
    start(async () => {
      setError(null);
      const r = await setPackageRetired(pkg.code, !retired, note);
      if ("error" in r) return setError(r.error);
      onSaved(
        retired ? `${pkg.name} can be picked again.` : `${pkg.name} is retired. Accounts on it keep it.`,
        () => setPackageRetired(pkg.code, retired, "Undo"),
      );
    });
  return (
    <div className="mt-5 space-y-2 border-t border-border pt-4">
      <p className="font-semibold">{retired ? "Bring this package back" : "Retire this package"}</p>
      <p className="text-sm text-muted">
        {retired
          ? "It can be picked for new accounts and invitations again."
          : "The accounts on it keep it. It can't be picked for new accounts or invitations. You can bring it back any time."}
      </p>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={toggle}
        className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4 disabled:opacity-60"
      >
        {busy ? "Saving…" : retired ? `Bring back ${pkg.name}` : `Retire ${pkg.name}`}
      </button>
    </div>
  );
}

/** A new package: a name, and the package it copies. Prices start "Not set"; no account is moved onto it. */
function NewPackage({
  packages,
  onClose,
  onCreated,
}: {
  packages: Tier[];
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const [name, setName] = useState("");
  const [from, setFrom] = useState(packages.find((p) => p.code === "event")?.code ?? packages[0]?.code ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const fromName = packages.find((p) => p.code === from)?.name ?? "";
  const tooShort = name.trim().length < 2;
  const create = () =>
    startSave(async () => {
      setError(null);
      const r = await createPackage(name, from, note);
      if ("error" in r) return setError(r.error);
      onCreated(`${name.trim()} is created, copied from ${fromName}. Set its prices by selecting its name.`);
    });
  return (
    <dialog
      ref={dialog}
      aria-labelledby="new-package-title"
      onClose={onClose}
      className="m-auto w-[min(560px,calc(100vw-2rem))] rounded-lg border border-field-border bg-surface p-5 text-foreground shadow-elevated backdrop:bg-[#071a31]/55"
    >
      <h2 id="new-package-title" className="text-lg font-semibold">
        New package
      </h2>
      <div className="mt-3 space-y-3">
        <Field label="Name" hint="The name accounts and invitations will show. You can change it later.">
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Start from" hint="It starts with everything this package includes. Change any of it in the grid after.">
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="min-h-11 w-full rounded-sm border border-field-border bg-surface px-3 text-base"
          >
            {packages.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-sm text-muted">Prices start as &ldquo;Not set&rdquo;. No accounts are moved onto it: you still choose each account&apos;s package yourself.</p>
        <Field label="Note for the activity log (optional)">
          <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {tooShort && name.length > 0 && <p className="mt-3 text-sm font-semibold text-danger">Give the package a name of 2 or more characters.</p>}
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          className="inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={tooShort || !from || saving}
          onClick={create}
          className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground disabled:cursor-not-allowed disabled:border disabled:border-field-border disabled:bg-transparent disabled:text-disabled"
        >
          {saving ? "Creating…" : "Create package"}
        </button>
      </div>
    </dialog>
  );
}

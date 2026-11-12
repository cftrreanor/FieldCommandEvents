"use client";

import { useId, useState } from "react";
import { Button, Field, FieldError, Input } from "@/components/ui";
import { moveSponsorLevel, saveSponsorLevel } from "@/app/dashboard/sponsor-actions";
import { MAX_LEVELS, type Sponsor, type SponsorLevel } from "@/lib/sponsors";
import { ConfirmWindow } from "./window";
import { LEVEL_EXAMPLES, levelGets, listAnd, ordinal, plural } from "./words";

/** Runs one change, with "Saving…" and a failure said where it happened. Resolves true when it went through. */
export type Run = (what: string, fn: () => Promise<{ error?: string }>, where?: string) => Promise<boolean>;

/** An arrow button: always in its column (an unusable one keeps its place), named on the button (L20). */
export function ArrowButton({ dir, label, onClick, data, firstLast }: { dir: "up" | "down"; label: string | null; onClick?: () => void; data?: string; firstLast: string }) {
  return (
    <Button
      type="button"
      variant="secondary"
      className="w-11 px-0"
      disabled={!label}
      aria-label={label ?? firstLast}
      title={label ?? undefined}
      onClick={onClick}
      data-arrow={data}
    >
      <span aria-hidden>{dir === "up" ? "↑" : "↓"}</span>
    </Button>
  );
}

/** Adds the next level (up to 4), with an example that's never filled in. */
function AddLevel({ eventId, count, run, primary }: { eventId: string; count: number; run: Run; primary: boolean }) {
  const id = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (count >= MAX_LEVELS) return <p className="mt-3 text-sm text-muted">4 levels is the most. Remove one to add another.</p>;
  const add = async () => {
    if (!name.trim()) {
      setError("Fill this in");
      return;
    }
    setError(null);
    const ok = await run(`Adding the ${name.trim()} level`, () => saveSponsorLevel(eventId, null, name), "levels");
    if (ok) setName("");
  };
  return (
    <form
      className="mt-4 flex flex-wrap items-start gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <Field label={`${ordinal(count + 1)} level`} className="min-w-0 flex-1 basis-52" error={error ?? undefined} errorId={`${id}-err`}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={LEVEL_EXAMPLES[count]}
          maxLength={40}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className={error ? "border-danger! ring-2 ring-danger/20" : undefined}
        />
      </Field>
      <Button type="submit" variant={primary ? "primary" : "secondary"} className="sm:mt-7">
        Add level
      </Button>
    </form>
  );
}

/** One level's name, saved when the box is left (or Enter). */
function LevelName({ eventId, level, rank, run }: { eventId: string; level: SponsorLevel; rank: number; run: Run }) {
  const id = useId();
  const [value, setValue] = useState(level.name);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (value.trim() === level.name) return;
    if (!value.trim()) {
      setError("Give the level a name");
      return;
    }
    setError(null);
    await run(`Renaming ${level.name}`, () => saveSponsorLevel(eventId, level.id, value), "levels");
  };
  return (
    <div className="min-w-0">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
        }}
        maxLength={40}
        aria-label={`${ordinal(rank + 1)} level's name`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className={error ? "border-danger! ring-2 ring-danger/20" : undefined}
      />
      {error && <FieldError id={`${id}-err`}>{error}</FieldError>}
    </div>
  );
}

/**
 * The levels: name and order them, what each gets on the public page (for sponsor packets), remove one (choosing
 * where its sponsors go), and add up to 4. Each change saves as it's made.
 */
export function LevelsEditor({
  eventId,
  eventType,
  levels,
  sponsors,
  run,
  onRemove,
  primaryAdd = false,
}: {
  eventId: string;
  eventType: string;
  levels: SponsorLevel[];
  sponsors: Sponsor[];
  run: Run;
  onRemove: (l: SponsorLevel) => void;
  primaryAdd?: boolean;
}) {
  const names = levels.map((l) => l.name);
  return (
    <div>
      {levels.length > 0 && (
        <ol className="mt-3 divide-y divide-border border-y border-border">
          {levels.map((l, i) => {
            const here = sponsors.filter((s) => s.levelId === l.id);
            const hid = here.filter((s) => !s.showPublic).length;
            return (
              <li key={`${l.id}-${l.name}`} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 py-3">
                <div className="grid grid-cols-2 gap-1">
                  <ArrowButton
                    dir="up"
                    firstLast={`${l.name} is the highest level`}
                    label={i > 0 ? `Move ${l.name} up` : null}
                    onClick={() => run(`Moving ${l.name} up`, () => moveSponsorLevel(eventId, l.id, "up"), "levels")}
                  />
                  <ArrowButton
                    dir="down"
                    firstLast={`${l.name} is the lowest level`}
                    label={i < levels.length - 1 ? `Move ${l.name} down` : null}
                    onClick={() => run(`Moving ${l.name} down`, () => moveSponsorLevel(eventId, l.id, "down"), "levels")}
                  />
                </div>
                <LevelName eventId={eventId} level={l} rank={i} run={run} />
                <div className="col-start-2 flex flex-wrap items-start justify-between gap-x-3 text-sm">
                  <p className="min-w-0 flex-1 basis-56">
                    <span className="font-medium">
                      {ordinal(i + 1)} · {plural(here.length, "sponsor")}
                      {hid ? `, ${hid} hidden` : ""}
                    </span>
                    <span className="block text-muted">Gets {levelGets(i, eventType, names)}</span>
                  </p>
                  <Button type="button" variant="quiet-danger" className="px-2" onClick={() => onRemove(l)} aria-label={`Remove the ${l.name} level`}>
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <AddLevel eventId={eventId} count={levels.length} run={run} primary={primaryAdd} />
    </div>
  );
}

/** Removing a level with sponsors: choose where they go (nothing is picked for them: L22), in one step. */
export function RemoveLevelWindow({
  level,
  levels,
  sponsors,
  onKeep,
  onRemove,
}: {
  level: SponsorLevel;
  levels: SponsorLevel[];
  sponsors: Sponsor[];
  onKeep: () => void;
  onRemove: (to: string | null) => void;
}) {
  const [to, setTo] = useState<string | null>(null);
  const its = sponsors.filter((s) => s.levelId === level.id);
  const others = levels.filter((l) => l.id !== level.id);
  if (others.length === 0) {
    // The last level: its sponsors stay, all at the same size.
    return (
      <ConfirmWindow title={`Remove the ${level.name} level?`} keepLabel={`Keep ${level.name}`} actionLabel={`Remove ${level.name}`} onKeep={onKeep} onConfirm={() => onRemove(null)}>
        <p>
          It&apos;s your only level. Its {plural(its.length, "sponsor")} stay{its.length === 1 ? "s" : ""}, and every sponsor shows at the same size, with no levels.
        </p>
      </ConfirmWindow>
    );
  }
  return (
    <ConfirmWindow
      title={`Remove the ${level.name} level?`}
      keepLabel={`Keep ${level.name}`}
      actionLabel={`Remove ${level.name}`}
      onKeep={onKeep}
      onConfirm={() => to && onRemove(to)}
      disabled={!to}
      disabledReason="Pick a level first"
    >
      <p>
        Its {plural(its.length, "sponsor")} ({listAnd(its.map((s) => s.name))}) need{its.length === 1 ? "s" : ""} a new level. Hidden sponsors stay hidden. Pick one, then Remove{" "}
        {level.name}.
      </p>
      <fieldset>
        <legend className="font-semibold">Move them to</legend>
        <div className="mt-1">
          {others.map((l) => (
            <label key={l.id} className="flex min-h-11 cursor-pointer items-center gap-3">
              <input type="radio" name="remove-level-to" checked={to === l.id} onChange={() => setTo(l.id)} className="team-radio size-5" />
              <span>
                <span className="font-medium">{l.name}</span> <span className="text-muted">· now {sponsors.filter((s) => s.levelId === l.id).length}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </ConfirmWindow>
  );
}

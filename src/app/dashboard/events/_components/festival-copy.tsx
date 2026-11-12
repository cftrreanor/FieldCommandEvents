"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { DateField } from "@/components/date-field";
import { SubmitButton } from "@/components/submit-button";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { copyFestival } from "@/app/dashboard/festival-copy-actions";
import { useWindow, Window } from "@/app/dashboard/team/team-ui";

export type PastFestival = {
  id: string;
  name: string;
  /** "Sat, Mar 21, 2026" */
  date: string;
  /** The name with next year's number in it ("… 2027"), or the same name. */
  newName: string;
  /** Last year's, or an earlier one ("Last year" or "Last time"). */
  when: "Last year" | "Last time";
};

/**
 * "Ran this festival last year?" on a new festival's first step (boards 1 and 18, 2026-11-11): one card, and a
 * window that says what comes along and what doesn't, asks for a new name and the first day (never filled in), and
 * makes the copy. With more than one earlier festival, they pick which.
 */
export function FestivalCopy({ festivals, today }: { festivals: PastFestival[]; today: string }) {
  const win = useWindow();
  const [picked, setPicked] = useState(festivals[0].id);
  const source = festivals.find((f) => f.id === picked) ?? festivals[0];
  return (
    <>
      <Card className="mt-6">
        <h2 className="font-semibold">Ran this festival last year?</h2>
        <p className="mt-1 text-sm text-muted">
          Start from {festivals.length > 1 ? "an earlier festival" : festivals[0].name}: its rooms, registration questions, information for directors, and volunteer
          jobs come along. Registered groups, their times, and your team don&apos;t.
        </p>
        <Button type="button" variant="secondary" className="mt-3" onClick={win.open}>
          Copy last year&apos;s festival
        </Button>
      </Card>
      <Window dialogRef={win.ref} formKey={win.key} close={win.close} title={festivals.length > 1 ? "Copy an earlier festival" : `Copy ${source.name}`}>
        <ActionForm action={copyFestival} resetOnSuccess={false} className="mt-3 space-y-4 text-sm leading-6">
          {festivals.length > 1 && (
            <Field label="Festival to copy">
              <Select name="fromEventId" value={picked} onChange={(e) => setPicked(e.target.value)}>
                {festivals.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.date} · {f.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {festivals.length === 1 && <input type="hidden" name="fromEventId" value={source.id} />}
          <div>
            <p>A new draft, with the same:</p>
            <ul className="mt-1 list-disc pl-5">
              <li>rooms, minutes per group, walking time, and rooms outside the rotation</li>
              <li>registration questions, classifications, and information for directors</li>
              <li>volunteer jobs and shifts</li>
            </ul>
          </div>
          <p>
            Not copied: registered groups, their times, who arrived and which rooms were done, volunteers who signed up, and your team. You can invite last year&apos;s team
            after.
          </p>
          <div className="grid gap-4 sm:grid-cols-2" data-required-marks>
            {/* A new box for each festival picked, so its name is the one suggested. */}
            <Field key={source.id} label="New name">
              <Input name="name" required maxLength={120} defaultValue={source.newName} />
            </Field>
            <Field label="First day" hint={`${source.name} was on ${source.date}`}>
              <DateField name="startsOn" required min={today} />
            </Field>
          </div>
          <p className="text-muted">Once you pick a day, the last day, registration deadline, and volunteer shifts move by the same number of days.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={win.close}>
              Cancel
            </Button>
            <SubmitButton pendingText="Making the copy…">Make the copy</SubmitButton>
          </div>
        </ActionForm>
      </Window>
    </>
  );
}

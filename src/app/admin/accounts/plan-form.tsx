"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Field, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { DateField } from "@/components/date-field";

type Plan = { value: string; label: string; free: boolean };

/** Plan and, for a pilot or trial, its last free day. */
export function PlanForm({
  action,
  plans,
  status,
  freeUntil,
  defaultEnd,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  plans: readonly Plan[];
  status: string;
  freeUntil: string | null;
  defaultEnd: string;
}) {
  const [picked, setPicked] = useState(status);
  const free = plans.find((p) => p.value === picked)?.free ?? false;
  return (
    <ActionForm action={action} resetOnSuccess={false} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Plan">
          <Select name="status" value={picked} onChange={(e) => setPicked(e.target.value)}>
            {plans.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        {free && (
          <Field label="Free through" hint="The last day they can publish new events for free.">
            <DateField name="freeUntil" required defaultValue={freeUntil ?? defaultEnd} />
          </Field>
        )}
      </div>
      <Field label="Note (optional)" hint="Why it changed, for the admin activity log.">
        <Input name="note" maxLength={500} placeholder="e.g. Accepted into the pilot" />
      </Field>
      <SubmitButton>Save plan</SubmitButton>
    </ActionForm>
  );
}

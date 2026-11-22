"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { NumberInput } from "@/components/number-input";
import { SubmitButton } from "@/components/submit-button";
import { Field, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { dollars, isFreePackage, PACKAGES, PASSES, RATES } from "@/lib/plan";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** The account's package and rate. The rate changes no features. */
type Option = { value: string; label: string };

export function PackageForm({ action, pkg, rate, packages }: { action: Action; pkg: string; rate: string; packages: Option[] }) {
  const list = packages.length ? packages : PACKAGES.map((p) => ({ value: p.value, label: p.label }));
  return (
    <ActionForm action={action} resetOnSuccess={false} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Package">
          <Select name="package" defaultValue={pkg}>
            {list.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rate" hint="What they pay at. It changes no features.">
          <Select name="rate" defaultValue={rate}>
            {RATES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Note (optional)" hint="Why it changed, for the admin activity log.">
        <Input name="note" maxLength={500} placeholder="e.g. Moved to Volunteer Command for spring" />
      </Field>
      <SubmitButton>Save package</SubmitButton>
    </ActionForm>
  );
}

/** A one-time pass: one published event of a type the package doesn't include. List prices come from plan_tiers. */
export function PassForm({ action, prices }: { action: Action; prices: Record<string, number> }) {
  const [type, setType] = useState<string>(PASSES[0].type);
  const listPrice = prices[type];
  return (
    <ActionForm action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Event pass">
          <Select name="type" value={type} onChange={(e) => setType(e.target.value)}>
            {PASSES.map((p) => (
              <option key={p.type} value={p.type}>
                {p.label}
                {prices[p.type] != null ? ` (${dollars(prices[p.type])})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Price paid in dollars" hint="0 for a pass given free.">
          <NumberInput key={type} name="price" defaultValue={listPrice != null ? String(listPrice / 100) : ""} required />
        </Field>
      </div>
      <Field label="Note (optional)" hint="Why, for the admin activity log.">
        <Input name="note" maxLength={500} placeholder="e.g. Paid by check for the spring fair" />
      </Field>
      <SubmitButton variant="secondary" pendingText="Adding…">
        Add event pass
      </SubmitButton>
    </ActionForm>
  );
}

/** Move a free teacher account to a full account on a package they pick. */
export function TeacherUpgradeForm({ action, packages }: { action: Action; packages: Option[] }) {
  const list = packages.length ? packages : PACKAGES.map((p) => ({ value: p.value, label: p.label }));
  return (
    <ActionForm action={action} className="space-y-3" confirmMessage="Upgrade this teacher to a full account on the package you picked?">
      <Field label="Package">
        <Select name="package" defaultValue="schedule">
          {list.filter((p) => !isFreePackage(p.value)).map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Note (optional)" hint="Why, for the admin activity log.">
        <Input name="note" maxLength={500} placeholder="e.g. Joined the school-wide pilot" />
      </Field>
      <SubmitButton variant="secondary" pendingText="Upgrading…">
        Upgrade to full account
      </SubmitButton>
    </ActionForm>
  );
}

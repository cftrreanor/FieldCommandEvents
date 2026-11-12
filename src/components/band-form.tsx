"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { NumberInput } from "@/components/number-input";
import { SubmitButton } from "@/components/submit-button";
import { Card, Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { mealOptionsOrDefault, mealPrice, mealTotal, type MealOffer, type MealOrder } from "@/lib/meal-price";

export type BandFormValues = Partial<{
  school_name: string;
  band_name: string;
  classification: string;
  school_address: string;
  contact_email: string;
  head_director_name: string;
  head_director_email: string;
  head_director_phone: string;
  assistant_directors: string[];
  student_count: number;
  chaperone_count: number;
  bus_count: number;
  box_truck_count: number;
  truck_trailer_count: number;
  semi_truck_count: number;
  contest_day_conflicts: string | null;
  special_needs: string | null;
  meal_order: MealOrder | null;
}>;

export type { MealOffer } from "@/lib/meal-price";

/** The band (or group) registration form, used to register and to edit. Groups don't bring trucks. */
export function BandForm({
  action,
  classifications,
  chaperoneLimit,
  initial = {},
  submitLabel,
  disabled = false,
  kind = "band",
  emailHint,
  meals = null,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  classifications: string[];
  chaperoneLimit: number;
  initial?: BandFormValues;
  submitLabel: string;
  disabled?: boolean;
  kind?: "band" | "group";
  /** Under the head director's email, e.g. that the confirmation code goes there. */
  emailHint?: string;
  /** The host provides meals: say what they cost and what's offered, then ask how many. */
  meals?: MealOffer | null;
}) {
  const group = kind === "group";
  const num = (v: number | undefined) => (v === undefined ? "" : String(v));
  // Over the chaperone limit: say so as they type, not after they submit.
  const [chaperones, setChaperones] = useState(num(initial.chaperone_count));
  const overLimit = chaperones !== "" && Number(chaperones) > chaperoneLimit;
  return (
    <ActionForm action={action} className="space-y-6" resetOnSuccess={false}>
      <fieldset disabled={disabled} className="space-y-6">
        <Card className="space-y-4">
          <h2 className="font-semibold">School &amp; ensemble</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="School name">
              <Input name="schoolName" required defaultValue={initial.school_name} placeholder="For example, Cedar Ridge High School" />
            </Field>
            <Field label={group ? "Group name" : "Band name"}>
              <Input
                name="bandName"
                required
                defaultValue={initial.band_name}
                placeholder={group ? "For example, Varsity Treble Choir or Jazz Band" : "For example, Raider Regiment"}
              />
            </Field>
            <Field label="Classification">
              <Select name="classification" required defaultValue={initial.classification ?? ""}>
                <option value="" disabled>
                  Choose…
                </option>
                {classifications.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={group ? "Group contact email" : "Band contact email"} hint="Where the organizer should send updates.">
              <Input name="contactEmail" type="email" required defaultValue={initial.contact_email} />
            </Field>
            <Field label="School address (optional)" hint="If the organizer needs it, for example to mail a receipt." className="sm:col-span-2">
              <Input name="schoolAddress" defaultValue={initial.school_address} autoComplete="street-address" />
            </Field>
          </div>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-semibold">Directors</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Head director's name">
              <Input name="headDirectorName" required defaultValue={initial.head_director_name} autoComplete="name" />
            </Field>
            <Field label="Head director's mobile">
              <Input name="headDirectorPhone" type="tel" inputMode="tel" required defaultValue={initial.head_director_phone} />
            </Field>
            <Field label="Head director's email" hint={emailHint} className="sm:col-span-2">
              <Input name="headDirectorEmail" type="email" required defaultValue={initial.head_director_email} />
            </Field>
            <Field label="Assistant directors (optional)" hint="One per line." className="sm:col-span-2">
              <Textarea name="assistantDirectors" defaultValue={(initial.assistant_directors ?? []).join("\n")} />
            </Field>
          </div>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-semibold">Who&apos;s coming</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label={group ? "Performers" : "Student performers"}>
              <NumberInput name="studentCount" required defaultValue={num(initial.student_count)} />
            </Field>
            <Field
              label="Chaperones"
              hint={overLimit ? undefined : `Up to ${chaperoneLimit} for this event.`}
              error={overLimit ? `This event allows up to ${chaperoneLimit} chaperones per ${kind}.` : undefined}
              errorId="chaperone-limit"
            >
              <NumberInput
                name="chaperoneCount"
                required
                defaultValue={num(initial.chaperone_count)}
                onChange={(e) => setChaperones(e.target.value)}
                aria-invalid={overLimit || undefined}
                aria-describedby={overLimit ? "chaperone-limit" : undefined}
              />
            </Field>
          </div>
        </Card>

        <Card className="space-y-4">
          <div>
            <h2 className="font-semibold">Vehicles</h2>
            <p className="mt-1 text-sm text-muted">Leave at 0 for any you aren&apos;t bringing. Helps the parking crew plan space for you.</p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Buses">
              <NumberInput name="busCount" defaultValue={num(initial.bus_count ?? 0)} />
            </Field>
            {!group && (
              <>
                <Field label="Box trucks">
                  <NumberInput name="boxTruckCount" defaultValue={num(initial.box_truck_count ?? 0)} />
                </Field>
                <Field label="Truck + trailer">
                  <NumberInput name="truckTrailerCount" defaultValue={num(initial.truck_trailer_count ?? 0)} />
                </Field>
                <Field label="Semi trucks (18-wheelers)">
                  <NumberInput name="semiTruckCount" defaultValue={num(initial.semi_truck_count ?? 0)} />
                </Field>
              </>
            )}
          </div>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-semibold">{group ? "Event day" : "Contest day"}</h2>
          <Field
            label="Scheduling conflicts (optional)"
            hint={
              group
                ? "For example, can't arrive before 10 AM, or another performance that afternoon."
                : "For example, ACT testing until noon, a cross country meet, or homecoming that night."
            }
          >
            <Textarea name="contestDayConflicts" defaultValue={initial.contest_day_conflicts ?? ""} />
          </Field>
          <Field
            label="Accessibility or staging needs (optional)"
            hint={group ? "ADA needs, risers, piano, power, or anything else we should know. Please don't include students' names or health details." : "ADA needs, pit equipment, power, or anything else we should know. Please don't include students' names or health details."}
          >
            <Textarea name="specialNeeds" defaultValue={initial.special_needs ?? ""} />
          </Field>
        </Card>

        {meals && <MealsCard meals={meals} initial={initial.meal_order ?? null} group={group} />}
      </fieldset>

      {!disabled && (
        <SubmitButton pendingText="Saving…" disabled={overLimit}>
          {submitLabel}
        </SubmitButton>
      )}
    </ActionForm>
  );
}

/**
 * Meals the organizer provides: the price and what's served, then how many of each option the band
 * needs (blank is none), a note, and the running total when there's a price.
 */
function MealsCard({ meals, initial, group }: { meals: MealOffer; initial: MealOrder | null; group: boolean }) {
  const options = mealOptionsOrDefault(meals.options);
  const [counts, setCounts] = useState<Record<string, number>>(initial?.counts ?? {});
  const total = mealTotal(Object.fromEntries(options.map((o) => [o, counts[o] ?? 0])));
  return (
    <Card className="space-y-4">
      <input type="hidden" name="mealsShown" value="1" />
      <div>
        <h2 className="font-semibold">Meals</h2>
        <p className="mt-1 text-sm">
          {meals.priceCents != null ? (
            <>
              Meals are <span className="font-semibold">{mealPrice(meals.priceCents)} each</span>, from the organizer.
            </>
          ) : (
            "The organizer provides meals."
          )}{" "}
          Order what your {group ? "group" : "band"} needs, or leave it blank.
        </p>
        {meals.details && <p className="mt-1 whitespace-pre-line text-sm text-muted">{meals.details}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {options.map((o) => (
          <Field key={o} label={o}>
            <NumberInput
              name={`meal:${o}`}
              maxLength={4}
              defaultValue={initial?.counts[o] ? String(initial.counts[o]) : ""}
              placeholder="0"
              onChange={(e) => setCounts((c) => ({ ...c, [o]: Number(e.target.value) || 0 }))}
            />
          </Field>
        ))}
      </div>
      <p className="text-sm" aria-live="polite">
        {total > 0 ? (
          <>
            <span className="font-semibold">
              {total} meal{total === 1 ? "" : "s"}
            </span>
            {meals.priceCents != null && (
              <>
                {" "}
                × {mealPrice(meals.priceCents)} = <span className="font-semibold">{mealPrice(total * meals.priceCents)}</span>
              </>
            )}
          </>
        ) : (
          <span className="text-muted">No meals ordered</span>
        )}
      </p>
      <Field label="Anything else about meals (optional)" hint="Like an allergy to plan for, or when your band will eat.">
        <Input name="mealNote" defaultValue={initial?.note ?? ""} maxLength={300} />
      </Field>
    </Card>
  );
}

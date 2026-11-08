"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Field, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

/** The example message and what a "schedule change" means, in each kind of event's own words. */
const EXAMPLES: Record<string, { placeholder: string; schedule: string }> = {
  band_contest: { placeholder: "e.g. Band switch: Lakeview now performs at 2:15, Cedar Ridge at 2:30.", schedule: "A band switch, a delay" },
  group_event: { placeholder: "e.g. Main Stage is running 10 minutes behind.", schedule: "A room running behind, a room change" },
  fair: { placeholder: "e.g. The bake sale moved to the cafeteria.", schedule: "A booth moving, a delay" },
  school_visit: { placeholder: "e.g. Lunch is moving to the gym because of rain.", schedule: "A room change, a delay" },
  conference: { placeholder: "e.g. Conferences start 15 minutes late today.", schedule: "A delay, a room change" },
};
const DEFAULT_EXAMPLE = { placeholder: "e.g. Check-in has moved to the front office.", schedule: "A delay, a location change" };

const DURATIONS = [
  { value: "1", label: "1 minute" },
  { value: "5", label: "5 minutes" },
  { value: "10", label: "10 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
  { value: "240", label: "4 hours" },
  { value: "day", label: "Rest of today" },
  { value: "open", label: "Until I end it" },
];

/** Post a day-of banner: what it says, how urgent, who sees it, how long it stays up. */
export function PostForm({
  action,
  audiences,
  eventType,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  audiences: { value: string; label: string; where: string }[];
  eventType: string | null;
}) {
  const example = EXAMPLES[eventType ?? "band_contest"] ?? DEFAULT_EXAMPLE;
  const TYPES = [
    { value: "routine", label: "Announcement", hint: "General news" },
    { value: "schedule", label: "Schedule change", hint: example.schedule },
    { value: "emergency", label: "Emergency", hint: "Weather, safety; stays up until you end it" },
  ] as const;
  const [priority, setPriority] = useState("routine");
  const [duration, setDuration] = useState("120");
  return (
    <ActionForm action={action} className="space-y-4">
      <Field label="Announcement">
        <Textarea name="body" required maxLength={1000} rows={3} placeholder={example.placeholder} />
      </Field>
      <fieldset>
        <legend className="text-sm font-semibold">Type</legend>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
          {TYPES.map((t) => (
            <label
              key={t.value}
              className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-brand ${t.value === "emergency" ? "has-[:checked]:bg-danger/10" : "has-[:checked]:bg-brand-soft"} border-border`}
            >
              <input
                type="radio"
                name="priority"
                value={t.value}
                checked={priority === t.value}
                onChange={() => {
                  setPriority(t.value);
                  if (t.value === "emergency") setDuration("open");
                }}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">{t.label}</span>
                <span className="block text-xs text-muted">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-semibold">Who sees it</legend>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          {audiences.map((a) => (
            <label key={a.value} className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
              <input type="checkbox" name="audiences" value={a.value} defaultChecked className="mt-1" />
              <span>
                <span className="font-semibold">{a.label}</span>
                <span className="block text-xs text-muted">{a.where}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Stays up for" hint="Each person sees it for at least a minute, then it fades away on its own. Emergencies stay until you end them.">
        <select name="duration" value={duration} onChange={(e) => setDuration(e.target.value)} className="min-h-11 w-full rounded-sm border border-border bg-surface px-3 text-base sm:w-64">
          {DURATIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </Field>
      {priority === "emergency" && (
        <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md border border-danger bg-danger/5 px-3 py-2 text-sm">
          <input type="checkbox" name="email" defaultChecked className="mt-1" />
          <span>
            <span className="font-semibold">Email it too</span>
            <span className="block text-xs text-muted">
              Sent right away to everyone you picked who has an email address on file. The public sees the banner only.
            </span>
          </span>
        </label>
      )}
      <SubmitButton variant={priority === "emergency" ? "warn" : "primary"} pendingText="Sending…">
        {priority === "emergency" ? "Broadcast emergency" : "Broadcast message"}
      </SubmitButton>
    </ActionForm>
  );
}

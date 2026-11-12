"use client";

import { useEffect, useRef, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { NumberInput } from "@/components/number-input";
import { SubmitButton } from "@/components/submit-button";
import { TimeField } from "@/components/time-field";
import { Card, Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { ConfirmCode } from "../bands/confirm-code";
import { startFestivalGuest, type GuestState } from "../bands/guest-actions";

/**
 * Registering a group for a festival (board 16): the short form, with only what the organizer asks. One email: the
 * signed-in director's, or (not signed in) the one we send the code to. Required boxes are marked.
 */
export function FestivalForm({
  eventId,
  classifications,
  askChaperones,
  askBuses,
  askAvailability,
  chaperoneLimit,
  days,
  email,
  posted = false,
  initial = {},
  update,
  submitLabel = "Register group",
}: {
  eventId: string;
  classifications: string[];
  askChaperones: boolean;
  askBuses: boolean;
  askAvailability: boolean;
  chaperoneLimit: number;
  /** The festival's days: [{ value: "2027-03-20", label: "Saturday" }]. One day hides the days question. */
  days: { value: string; label: string }[];
  /** Signed in: their email (no email box). */
  email: string | null;
  /**
   * The schedule is posted already: a new group's times come once the organizer adds it (adding a group emails
   * its directors by default), not when the schedule is posted.
   */
  posted?: boolean;
  /** Changing a registration: its answers, and the save action (in place of registering). */
  initial?: Partial<{
    band_name: string;
    school_name: string;
    classification: string | null;
    student_count: number;
    chaperone_count: number | null;
    bus_count: number;
    available_day: string | null;
    earliest_start: string | null;
    latest_finish: string | null;
    contest_day_conflicts: string | null;
  }>;
  update?: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel?: string;
}) {
  const [pending, setPending] = useState<GuestState["pending"] | null>(null);
  const when = posted ? "adds your group to the schedule" : "posts the schedule";
  const [earliest, setEarliest] = useState(initial.earliest_start?.slice(0, 5) ?? "");
  const num = (v: number | null | undefined) => (v == null ? "" : String(v));
  const formWrap = useRef<HTMLDivElement>(null);
  const codeWrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pending) codeWrap.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [pending]);

  async function submit(prev: ActionState, formData: FormData): Promise<ActionState> {
    if (update) return update(prev, formData);
    const result = await startFestivalGuest(eventId, prev, formData);
    if (result.pending) setPending(result.pending);
    return result;
  }

  return (
    <>
      {pending && (
        <div ref={codeWrap} className="scroll-mt-4">
          <ConfirmCode
            pendingId={pending.id}
            email={pending.email}
            bandName={pending.bandName}
            onFixEmail={() => {
              setPending(null);
              requestAnimationFrame(() => {
                const box = formWrap.current?.querySelector<HTMLInputElement>('input[name="headDirectorEmail"]');
                box?.scrollIntoView({ block: "center" });
                box?.focus();
              });
            }}
          />
        </div>
      )}
      <div ref={formWrap} hidden={Boolean(pending)} data-required-marks>
        <p className="mb-3 text-sm">
          <span aria-hidden>* </span>Needed to register
        </p>
        <ActionForm action={submit} className="space-y-6" resetOnSuccess={false}>
          <Card className="space-y-5">
            <Field label="Group name" hint="As it should appear on the schedule">
              <Input name="bandName" required maxLength={150} defaultValue={initial.band_name} placeholder="For example, Varsity Treble Choir" />
            </Field>
            <Field label="School">
              <Input name="schoolName" required maxLength={150} autoComplete="organization" defaultValue={initial.school_name} />
            </Field>
            {classifications.length > 0 && (
              <Field label="Classification">
                <Select name="classification" required defaultValue={initial.classification && classifications.includes(initial.classification) ? initial.classification : ""}>
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
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Performers">
                <NumberInput name="studentCount" required defaultValue={num(initial.student_count)} />
              </Field>
              {askChaperones && (
                <Field label="Chaperones" hint={`Up to ${chaperoneLimit}`}>
                  <NumberInput name="chaperoneCount" required defaultValue={num(initial.chaperone_count)} />
                </Field>
              )}
              {askBuses && (
                <Field label="Buses (optional)">
                  <NumberInput name="busCount" defaultValue={initial.bus_count ? String(initial.bus_count) : ""} />
                </Field>
              )}
            </div>
            {askAvailability && days.length > 1 && (
              <fieldset>
                <legend className="text-sm font-semibold">Which days can your group come?</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {[{ value: "", label: "Either day" }, ...days.map((d) => ({ value: d.value, label: `${d.label} only` }))].map((o, i) => (
                    <label key={o.value} className="flex min-h-11 items-center gap-3 rounded-md border border-field-border px-3 has-[:checked]:border-brand">
                      <input type="radio" name="availableDay" value={o.value} defaultChecked={o.value === (initial.available_day ?? "") || (i === 0 && !days.some((d) => d.value === initial.available_day))} className="size-5 accent-brand" />
                      <span className="text-sm">{o.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {askAvailability && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Earliest your group can start (optional)">
                  <TimeField name="earliestStart" value={earliest} onChange={(e) => setEarliest(e.target.value)} />
                </Field>
                <Field label="Latest your group can finish (optional)">
                  <TimeField name="latestFinish" defaultValue={initial.latest_finish?.slice(0, 5) ?? ""} after={earliest || undefined} />
                </Field>
              </div>
            )}
            <Field label="Anything else the organizer should know (optional)" hint="Please don't include students' names or health details">
              <Textarea name="notes" maxLength={2000} defaultValue={initial.contest_day_conflicts ?? ""} placeholder="For example, our accompanist leaves at noon" />
            </Field>
            {update ? null : email ? (
              <p className="text-sm">
                {/* The address moves to its own line as a whole rather than breaking mid-word (only one longer than the line breaks). */}
                We&apos;ll email a copy to <span className="inline-block max-w-full font-semibold [overflow-wrap:anywhere]">{email}</span> now, and your group&apos;s times once the organizer {when}.
              </p>
            ) : (
              <Field label="Your email" hint={`We'll send a code here to confirm, then your group's times once the organizer ${when}. No account or password.`}>
                <Input name="headDirectorEmail" type="email" required autoComplete="email" />
              </Field>
            )}
          </Card>
          <SubmitButton pendingText={update ? "Saving…" : "Registering…"}>{submitLabel}</SubmitButton>
        </ActionForm>
      </div>
    </>
  );
}

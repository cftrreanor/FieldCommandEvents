"use client";

import { useRef, useState, type ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Button, Field, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { NotifyBox, Points, ROW_BUTTON, Window, WindowButtons, focusSection, useWindow } from "../../../team/team-ui";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export type WindowChoice = {
  /** Sent as "pick". */
  value: string;
  label: string;
  /** What happens, as bullets. The first is bold when `firstMatters`. */
  points: ReactNode[];
  firstMatters?: boolean;
  confirmLabel: string;
};

/**
 * A row button that opens a window: one or more choices (nothing picked to start when there's more than one, so
 * the bigger change is never the default), what happens as bullets, an optional "Let … know by email" box, a way
 * out that names what you keep, and the action. Used for Remove…, Change…, and Stop co-hosting… on team tabs.
 */
export function ChoiceWindowButton({
  children,
  label,
  title,
  legend,
  choices,
  action,
  keepLabel,
  notifyLabel,
  pendingText,
  danger = true,
}: {
  children: ReactNode;
  label?: string;
  title: string;
  legend?: string;
  choices: WindowChoice[];
  action: Action;
  keepLabel: string;
  notifyLabel?: string;
  pendingText: string;
  danger?: boolean;
}) {
  const { ref, key, open, close } = useWindow();
  const trigger = useRef<HTMLButtonElement>(null);
  const one = choices.length === 1;
  const [pick, setPick] = useState(one ? choices[0].value : "");
  const chosen = choices.find((c) => c.value === pick);
  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant="secondary"
        className={ROW_BUTTON}
        aria-label={label}
        onClick={() => {
          setPick(one ? choices[0].value : "");
          open();
        }}
      >
        {children}
      </Button>
      <Window dialogRef={ref} formKey={key} close={close} title={title}>
        <ActionForm
          action={action}
          onSuccess={() => {
            close();
            if (danger) focusSection(trigger.current);
          }}
          resetOnSuccess={false}
          className="mt-3 space-y-4"
        >
          <input type="hidden" name="pick" value={pick} />
          {!one && (
            <fieldset className="space-y-1">
              {legend && <legend className="mb-1 text-sm font-medium">{legend}</legend>}
              {choices.map((c) => (
                <label key={c.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-background">
                  <input type="radio" name="choice" value={c.value} checked={pick === c.value} onChange={() => setPick(c.value)} className="team-radio" />
                  {c.label}
                </label>
              ))}
            </fieldset>
          )}
          {chosen ? (
            <Points items={chosen.points.map((p, i) => (i === 0 && chosen.firstMatters ? <strong key="first">{p}</strong> : p))} />
          ) : (
            <p className="text-sm leading-6 text-muted">Pick one to see what changes.</p>
          )}
          {notifyLabel && <NotifyBox label={notifyLabel} />}
          <WindowButtons keep={keepLabel} close={close}>
            <SubmitButton variant={danger ? "warn" : "primary"} pendingText={pendingText} data-solid disabled={!chosen}>
              {chosen ? chosen.confirmLabel : choices[0].confirmLabel.split(" ")[0]}
            </SubmitButton>
          </WindowButtons>
        </ActionForm>
      </Window>
    </>
  );
}

export type TeamOption = {
  userId: string;
  name: string;
  /** What they do now ("Volunteer Lead of Spring Concert"). */
  now: string;
  /** Adding them takes a team spot (their event is over, so they no longer hold one). */
  takesSpot: boolean;
};

/**
 * "Add a …" on a team tab: people already on your team first (added right away, and emailed), then someone new by
 * email. On the Co-hosts tab, "Co-host of" (this event only, or every event) comes first and applies to both.
 */
export function AddToTeam({
  roleName,
  note,
  scope,
  options,
  addAction,
  inviteAction,
  spotsLine,
  full,
  fullMessage,
  stations,
  inviteRole,
  emptyText = "Nobody else on your team yet. Invite someone new below.",
}: {
  roleName: string;
  note?: ReactNode;
  /** The Co-hosts tab: "This event only" (picked to start) or "Every event". */
  scope?: { eventName: string; events: number };
  options: TeamOption[];
  /** Adds one person: the form sends userId, name, and role. */
  addAction: Action;
  inviteAction: Action;
  spotsLine?: string;
  /** All team spots in use: someone new can't be invited. */
  full?: boolean;
  fullMessage?: ReactNode;
  stations?: { id: string; name: string }[];
  /** The role sent with an invitation when there's no scope. */
  inviteRole?: string;
  /** Said when nobody else can be added from the team. */
  emptyText?: string;
}) {
  const [every, setEvery] = useState(false);
  const role = scope ? (every ? "host" : "co_host") : (inviteRole ?? "");
  const addRole = scope ? (every ? "co_host_every" : "co_host") : (inviteRole ?? "");
  return (
    <section className="space-y-5 border-t border-border pt-5">
      <div>
        <h2 className="text-sm font-semibold">Add a {roleName}</h2>
        {note && <p className="mt-1 text-sm leading-6 text-muted">{note}</p>}
      </div>
      {scope && (
        <fieldset>
          <legend className="text-sm font-semibold">Co-host of</legend>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-sm hover:bg-background">
            <input type="radio" name="scope" checked={!every} onChange={() => setEvery(false)} className="team-radio mt-0.5" />
            <span>
              <span className="font-medium">This event only</span>
              <span className="block text-muted">They see and run {scope.eventName}, and nothing else on the account.</span>
            </span>
          </label>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-sm hover:bg-background">
            <input type="radio" name="scope" checked={every} onChange={() => setEvery(true)} className="team-radio mt-0.5" />
            <span>
              <span className="font-medium">Every event</span>
              <span className="block text-muted">
                They join your team as a co-host of {scope.events === 1 ? "your event" : `all ${scope.events} events`}, and any you add later.
              </span>
            </span>
          </label>
        </fieldset>
      )}
      <div>
        <h3 className="text-sm font-semibold">From your team</h3>
        {options.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{emptyText}</p>
        ) : (
          <>
            <p className="text-sm text-muted">Added right away. We&apos;ll email them that you added them.</p>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {options.map((o) => {
                const blocked = o.takesSpot && full;
                return (
                  <li key={o.userId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium [overflow-wrap:anywhere]">{o.name}</p>
                      <p className="text-sm text-muted">
                        {o.now}
                        {o.takesSpot && " · Takes a team spot"}
                      </p>
                    </div>
                    <ActionForm
                      action={addAction}
                      resetOnSuccess={false}
                      confirmMessage={
                        addRole === "co_host_every"
                          ? `Make ${o.name} a co-host of every event? They'll see and run every event on the account, and any you add later.`
                          : undefined
                      }
                      confirmLabel={addRole === "co_host_every" ? "Make co-host of every event" : undefined}
                      className="shrink-0"
                    >
                      <input type="hidden" name="userId" value={o.userId} />
                      <input type="hidden" name="name" value={o.name} />
                      <input type="hidden" name="role" value={addRole} />
                      <SubmitButton
                        variant="secondary"
                        pendingText="Adding…"
                        className={ROW_BUTTON}
                        disabled={blocked}
                        aria-label={`Add ${o.name} as ${scope ? (every ? "co-host of every event" : "co-host of this event") : roleName}`}
                      >
                        Add
                      </SubmitButton>
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold">Someone new</h3>
        {full ? (
          <div className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-sm leading-6">{fullMessage}</div>
        ) : (
          <>
            <p className="text-sm text-muted">We&apos;ll email them a link that works for 30 days. One tap accepts it; no password needed.</p>
            <ActionForm action={inviteAction} className="mt-3 grid gap-3">
              <input type="hidden" name="role" value={role} />
              <Field label="Their email">
                <Input name="email" type="email" required autoComplete="off" inputMode="email" />
              </Field>
              {stations && stations.length > 0 && (
                <Field label="Sign-up they'll lead" hint="Optional. You can also choose later.">
                  <Select name="stationId" defaultValue="">
                    <option value="">Decide later</option>
                    {stations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {spotsLine && <p className="text-sm text-muted">{spotsLine}</p>}
              <div>
                <SubmitButton pendingText="Sending…">Send invitation</SubmitButton>
              </div>
            </ActionForm>
          </>
        )}
      </div>
    </section>
  );
}

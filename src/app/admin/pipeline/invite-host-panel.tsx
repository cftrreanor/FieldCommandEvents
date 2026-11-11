"use client";

import { useRef, type ReactNode } from "react";
import { ActionForm, useFieldErrors } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Field, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { INVITE_PACKAGES, INVITE_STATUSES } from "@/lib/invitation-plan";
import { DateField } from "@/components/date-field";

export type InviteDefaults = {
  email: string;
  name: string;
  organization: string;
  phone: string;
  package: string;
  status: string;
  freeUntil: string;
  /** The welcome email template's id ("" is the standard invitation). */
  template: string;
};

/**
 * "Invite a host": a panel from the right with who they are, the package and
 * free period they'll start on, and the welcome email. Sending saves it all
 * and emails them in one step, so nothing is sent before it's set up.
 */
export function InviteHostPanel({
  action,
  templates,
  defaults,
  waiting = false,
  label,
  buttonClassName,
  names,
  packages,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  templates: { id: string; name: string }[];
  defaults: InviteDefaults;
  /** An invitation is already waiting: offer "Save without sending" too. */
  waiting?: boolean;
  label: ReactNode;
  buttonClassName: string;
  /** Package names as stored (Packages page); the invite list's own names otherwise. */
  names?: Record<string, string>;
  /** The packages to offer (new ones included, retired ones left out); the fixed list otherwise. */
  packages?: { value: string; label: string }[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} className={buttonClassName}>
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="invite-host-title"
        className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-md border-l border-border bg-background p-0 text-foreground shadow-elevated transition-transform duration-200 ease-out backdrop:bg-[#0d1422]/50 starting:open:translate-x-full"
        onClick={(e) => {
          // A click on the backdrop closes it.
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 id="invite-host-title" className="text-lg font-semibold">
                {waiting ? "Host invitation" : "Invite a host"}
              </h2>
              <p className="mt-0.5 text-sm text-muted">They&apos;ll start on this package once they set up their account.</p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={close}
              className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-2xl text-muted hover:text-foreground"
            >
              ×
            </button>
          </div>
          <ActionForm action={action} resetOnSuccess={false} onSuccess={close} className="flex min-h-0 flex-1 flex-col">
            <InviteFields templates={templates} defaults={defaults} names={names} packages={packages} />
            <div className="space-y-2 border-t border-border px-5 py-4">
              <SubmitButton name="intent" value="send" className="w-full" pendingText="Sending…">
                {waiting ? "Send the invitation again" : "Send invitation"}
              </SubmitButton>
              {waiting ? (
                <SubmitButton name="intent" value="save" variant="secondary" className="w-full" pendingText="Saving…">
                  Save without sending
                </SubmitButton>
              ) : (
                <SubmitButton name="intent" value="later" variant="secondary" className="w-full" pendingText="Saving…">
                  Save and invite later
                </SubmitButton>
              )}
            </div>
          </ActionForm>
        </div>
      </dialog>
    </>
  );
}

function InviteFields({
  templates,
  defaults,
  names,
  packages,
}: {
  templates: { id: string; name: string }[];
  defaults: InviteDefaults;
  names?: Record<string, string>;
  packages?: { value: string; label: string }[];
}) {
  const errors = useFieldErrors();
  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
      <Field label="Host name" error={errors.name}>
        <Input name="name" required maxLength={200} defaultValue={defaults.name} autoComplete="off" />
      </Field>
      <Field label="Email" error={errors.email}>
        <Input name="email" type="email" required maxLength={254} defaultValue={defaults.email} autoComplete="off" />
      </Field>
      <Field label="Organization name (optional)" hint="Their school, PTA, or booster club. They can set it when they sign up." error={errors.organization}>
        <Input name="organization" maxLength={200} defaultValue={defaults.organization} autoComplete="off" />
      </Field>
      <Field label="Phone number (optional)" error={errors.phone}>
        <Input name="phone" type="tel" maxLength={30} defaultValue={defaults.phone} autoComplete="off" />
      </Field>
      <Field label="Package" error={errors.package}>
        <Select name="package" defaultValue={defaults.package}>
          {(packages ?? INVITE_PACKAGES).map((p) => (
            <option key={p.value} value={p.value}>
              {names?.[p.value] ?? p.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pilot status" error={errors.status}>
          <Select name="status" defaultValue={defaults.status}>
            {INVITE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Pilot through" error={errors.freeUntil}>
          <DateField name="freeUntil" required defaultValue={defaults.freeUntil} />
        </Field>
      </div>
      <Field label="Welcome email" hint="Make more on the Email templates page. Use {{login_url}} for their sign-in link.">
        <Select name="template" defaultValue={templates.some((t) => t.id === defaults.template) ? defaults.template : ""}>
          <option value="">Standard host invitation</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

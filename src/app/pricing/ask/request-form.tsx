"use client";
// The pricing request form: "Ask about [package]" and "Get a [kind] pass" (owner decision 2: request form first).
// Saved by requestPricing() (src/app/pricing-request-actions.ts), which checks it again.
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { ActionForm, useFieldErrors } from "@/components/action-form";
import { BotCheck } from "@/components/bot-check";
import { LineIcon } from "@/components/line-icon";
import { SignOutButton } from "@/components/sign-out-button";
import { SubmitButton } from "@/components/submit-button";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { fieldErrorState, type ActionState } from "@/lib/action-state";
import { checkPricingRequest, WEBSITE_KINDS } from "@/lib/pricing";
import { CHECK, CheckIcon, LINK, BTN_OUTLINE } from "../parts";

export type PlanChoice = {
  code: string;
  /** "Event Command: $1,000 a year", "Band contest pass: $150". */
  label: string;
  /** The package or pass name, for the confirmation. */
  name: string;
  group: "Packages" | "Passes";
  /** "$48 a year" for packages with a teacher rate. */
  teacher: string | null;
};

export type Identity = { name: string; email: string; organization: string | null; organizationId: string | null };

function validate(data: FormData) {
  const { fieldErrors } = checkPricingRequest(data);
  return Object.keys(fieldErrors).length ? fieldErrorState(fieldErrors) : null;
}

export function RequestForm({
  action,
  choices,
  plan: initialPlan,
  kinds,
  identity,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  choices: PlanChoice[];
  plan: string;
  kinds: string[];
  /** The signed-in person: their name, email, and (for an Account Host) group aren't asked again. */
  identity: Identity | null;
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [sent, setSent] = useState<{ email: string; plan: string; group: string } | null>(null);
  const [startedAt] = useState(() => Date.now());
  const touched = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLDivElement>(null);
  const chosen = choices.find((c) => c.code === plan) ?? null;
  // A real tap, click or key press in the form (scripts filling it in don't make one).
  const markTouched = (e: SyntheticEvent) => {
    if (e.nativeEvent.isTrusted && touched.current) touched.current.value = "1";
  };

  if (sent) return <Sent {...sent} signedIn={Boolean(identity)} />;
  return (
    <ActionForm
      action={action}
      validate={validate}
      resetOnSuccess={false}
      onSuccess={() => {
        const data = new FormData(form.current?.closest("form") ?? undefined);
        setSent({ email: String(data.get("email") ?? ""), plan: chosen?.name ?? "", group: String(data.get("organization") ?? "") });
      }}
      className="max-w-3xl"
      noValidate
    >
      <div ref={form} className="grid gap-5 sm:grid-cols-2" onPointerDownCapture={markTouched} onKeyDownCapture={markTouched} onFocusCapture={markTouched}>
        {/* Bot traps, as on the pilot form: a box people never see, a minimum time on the page, and a real touch. */}
        <input type="hidden" name="startedAt" value={startedAt} />
        <input type="hidden" name="touched" ref={touched} defaultValue="" />
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <Fields choices={choices} plan={plan} onPlan={setPlan} chosen={chosen} kinds={kinds} identity={identity} />
        <div className="sm:col-span-2">
          <BotCheck />
          <SubmitButton pendingText="Sending…">Send request</SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}

function Fields({
  choices,
  plan,
  onPlan,
  chosen,
  kinds,
  identity,
}: {
  choices: PlanChoice[];
  plan: string;
  onPlan: (p: string) => void;
  chosen: PlanChoice | null;
  kinds: string[];
  identity: Identity | null;
}) {
  const errors = useFieldErrors();
  const problem = (name: string) => ({ error: errors[name], errorId: `ask-${name}-error` });
  const describe = (name: string) => (errors[name] ? { "aria-invalid": true, "aria-describedby": `ask-${name}-error` } : {});
  const groups = (["Packages", "Passes"] as const).map((g) => ({ g, list: choices.filter((c) => c.group === g) })).filter((x) => x.list.length);

  return (
    <>
      {identity ? (
        <div className="rounded-md border border-border bg-surface px-4 py-3 leading-7 sm:col-span-2">
          <input type="hidden" name="name" value={identity.name} />
          <input type="hidden" name="email" value={identity.email} />
          {identity.organization && <input type="hidden" name="organization" value={identity.organization} />}
          {identity.organizationId && <input type="hidden" name="organizationId" value={identity.organizationId} />}
          <p>
            From <span className="font-semibold">{identity.name}</span>
            {identity.organization && (
              <>
                {" "}
                for <span className="font-semibold">{identity.organization}</span>
              </>
            )}
          </p>
          <p className="text-sm text-muted">
            We&apos;ll reply to <span className="font-semibold text-foreground [overflow-wrap:anywhere]">{identity.email}</span>. Not you?{" "}
            <SignOutButton className={`${LINK} inline-flex min-h-11 items-center`} />
          </p>
        </div>
      ) : (
        <>
          <Field label="Your name" {...problem("name")}>
            <Input name="name" required maxLength={200} autoComplete="name" {...describe("name")} />
          </Field>
          <Field label="Email" hint="A real person replies here within a day" {...problem("email")}>
            <Input name="email" type="email" required maxLength={254} autoComplete="email" {...describe("email")} />
          </Field>
        </>
      )}
      {!identity?.organization && (
        <Field label="School or group" className="sm:col-span-2" {...problem("organization")}>
          <Input name="organization" required maxLength={200} autoComplete="organization" placeholder="Like Oak Elementary PTA or Grace Church" {...describe("organization")} />
        </Field>
      )}

      <Field label="Package or pass" hint="Not sure? Pick the closest one, and ask below" className="sm:col-span-2" {...problem("plan")}>
        <Select name="plan" value={plan} onChange={(e) => onPlan(e.target.value)} {...describe("plan")}>
          <option value="">Not sure yet</option>
          {groups.map(({ g, list }) => (
            <optgroup key={g} label={g}>
              {list.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>

      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-semibold">What do you run?</legend>
        <p className="mt-1 text-sm text-muted">
          {kinds.length ? "Carried over from what you picked on the prices page. Change it if you like." : "Pick any that apply, so we can answer for your events."}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {WEBSITE_KINDS.map((k) => (
            <label
              key={k.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-field-border bg-surface px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft"
            >
              <input type="checkbox" name="eventTypes" value={k.value} defaultChecked={kinds.includes(k.value)} className={CHECK} />
              <LineIcon name={k.icon} className="size-5 shrink-0 text-brand dark:text-foreground" />
              <span className="min-w-0">{k.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2 sm:col-span-2">
        {chosen?.teacher && (
          <Tick name="teacherRate" title="I'm a classroom teacher">
            The teacher rate, {chosen.teacher}, is for an account in your own name for your own classes or conferences. A real person checks it.{" "}
            <Link href="/pricing#teacher-rate" className={LINK}>
              Who qualifies
            </Link>
          </Tick>
        )}
        <Tick name="payByInvoice" title="We'll pay by invoice or purchase order">
          For schools, districts, and groups that pay by purchase order. We can send a quote and our W-9 first.
        </Tick>
      </div>

      <Field label="Anything else? (optional)" className="sm:col-span-2" {...problem("message")}>
        <Textarea name="message" rows={4} maxLength={2000} {...describe("message")} />
      </Field>
    </>
  );
}

function Tick({ name, title, children }: { name: string; title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 gap-3 rounded-md border border-field-border bg-surface p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
      <input id={`ask-${name}`} type="checkbox" name={name} value="1" aria-describedby={`ask-${name}-hint`} className={`mt-0.5 ${CHECK}`} />
      <div className="min-w-0">
        <label htmlFor={`ask-${name}`} className="block cursor-pointer font-semibold">
          {title}
        </label>
        <p id={`ask-${name}-hint`} className="text-sm text-muted">
          {children}
        </p>
      </div>
    </div>
  );
}

/** Shown in place of the form once it's in; takes focus so screen readers announce it. */
function Sent({ email, plan, group, signedIn }: { email: string; plan: string; group: string; signedIn: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div ref={ref} tabIndex={-1} role="status" className="max-w-2xl space-y-4 leading-7 outline-none">
      <h2 className="text-2xl font-semibold">Thanks, we have your request</h2>
      <p className="flex items-start gap-2 rounded-md border border-success/40 bg-success-soft px-4 py-3">
        <CheckIcon className="mt-1 size-5 text-success" />
        <span>
          A real person will reply to <strong className="[overflow-wrap:anywhere]">{email}</strong> within a day
          {plan ? ` about ${plan}` : ""}
          {group ? ` for ${group}` : ""}.
        </span>
      </p>
      <p>Nothing is charged. We&apos;ll answer your questions and set it up with you.</p>
      {!signedIn && (
        <p>
          While you wait, see what each kind of event looks like.{" "}
          <Link href="/#organizing" className={LINK}>
            All kinds of events
          </Link>
        </p>
      )}
      <Link href="/pricing" className={BTN_OUTLINE}>
        Back to packages
      </Link>
    </div>
  );
}

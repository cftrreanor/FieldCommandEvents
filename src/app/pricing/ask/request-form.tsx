"use client";
// The pricing request form: "Ask about [package]" and "Get a [kind] pass" (owner decision 2: request form first).
// Saved by requestPricing() (src/app/pricing-request-actions.ts), which checks it again.
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { ActionForm, useFieldErrors } from "@/components/action-form";
import { BotCheck } from "@/components/bot-check";
import { SignOutButton } from "@/components/sign-out-button";
import { SubmitButton } from "@/components/submit-button";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { fieldErrorState, type ActionState } from "@/lib/action-state";
import { listWords } from "@/lib/plan";
import { checkPricingRequest, kindNoun, sortKinds, WEBSITE_KINDS } from "@/lib/pricing";
import { BTN_OUTLINE, CHECK, CheckIcon, ChevronIcon, LINK, TEACHER_WHO } from "../parts";
import { KindChoice } from "../pricing-client";

export type PlanChoice = {
  code: string;
  /** "Event Command: $1,000 a year", "Band contest pass: $150". */
  label: string;
  /** The package or pass name, for the confirmation. */
  name: string;
  group: "Packages" | "Passes";
  /** "$48 a year" for packages with a teacher rate. */
  teacher: string | null;
  /** "$240 a year", "$50"; null when a package has no price ("ask us"). */
  price: string | null;
  /** The kinds it includes (a pass: its one kind). */
  eventTypes: string[];
};

export type Identity = {
  name: string;
  email: string;
  organization: string | null;
  organizationId: string | null;
  /** The account's package now (an Account Host's): what a choice would leave out, and whether it's a teacher's own. */
  current: { name: string; eventTypes: string[]; teacher: boolean } | null;
};

function validate(data: FormData) {
  const { fieldErrors } = checkPricingRequest(data);
  return Object.keys(fieldErrors).length ? fieldErrorState(fieldErrors) : null;
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * The page's heading follows the choice (UX F5): "Get a band contest pass", "Ask about Event Command", and with more
 * passes, "Get these passes" or "Ask about Volunteer Command and a pass".
 */
function heading(chosen: PlanChoice | null, start: boolean, more: number) {
  if (!chosen) return start ? "Get started: ask about a package" : "Ask about a package";
  if (chosen.group === "Passes") return more ? "Get these passes" : `Get a ${lowerFirst(chosen.name)}`;
  return `Ask about ${chosen.name}${more === 0 ? "" : more === 1 ? " and a pass" : " and passes"}`;
}

/**
 * "You're asking about: a school fair or fundraiser pass ($100) and a band contest pass ($150), for one event each":
 * everything in a request with more than one pass, said in one fixed line (consultant r2 F5).
 */
function askingWords(items: PlanChoice[]) {
  const allPasses = items.every((c) => c.group === "Passes");
  const words = items.map((c) =>
    c.group === "Passes" ? `a ${lowerFirst(c.name)} (${c.price}${allPasses ? "" : " for one event"})` : `${c.name} (${c.price ?? "ask us for a price"})`,
  );
  return `${listWords(words)}${allPasses ? (items.length > 1 ? ", for one event each" : ", for one event") : ""}`;
}

export function RequestForm({
  action,
  choices,
  plan: initialPlan,
  kinds,
  identity,
  start = false,
  also: initialAlso = [],
  back,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  choices: PlanChoice[];
  plan: string;
  kinds: string[];
  /** The signed-in person: their name, email, and (for an Account Host) group aren't asked again. */
  identity: Identity | null;
  /** From the header's "Get started". */
  start?: boolean;
  /** More passes in the same request (a cheaper option's second pass), sent with it. */
  also?: string[];
  /** "Back to packages", with the picks kept. */
  back: string;
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [sent, setSent] = useState<{
    email: string;
    plan: string;
    group: string;
    note: string | null;
  } | null>(null);
  // The server's words on success ("We already had this request…"), shown on the sent screen instead of a toast.
  const note = useRef<string | null>(null);
  const send = async (prev: ActionState, data: FormData) => {
    const r = await action(prev, data);
    note.current = r.ok ? (r.message ?? null) : null;
    return r;
  };
  const [startedAt] = useState(() => Date.now());
  const touched = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLDivElement>(null);
  const chosen = choices.find((c) => c.code === plan) ?? null;
  // More passes ride along with a first choice only, never the one already chosen.
  const also = chosen
    ? initialAlso.map((c) => choices.find((x) => x.code === c)).filter((c): c is PlanChoice => c !== undefined && c.code !== chosen.code)
    : [];
  // A real tap, click or key press in the form (scripts filling it in don't make one).
  const markTouched = (e: SyntheticEvent) => {
    if (e.nativeEvent.isTrusted && touched.current) touched.current.value = "1";
  };

  if (sent) return <Sent {...sent} signedIn={Boolean(identity)} back={back} />;
  return (
    <>
      <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{heading(chosen, start, also.length)}</h1>
      <p className="mt-2 max-w-2xl leading-7 text-muted">
        You can&apos;t pay online yet. Tell us about your events, and a real person will reply within a day to set it up with you. Nothing is charged until you agree.
      </p>
      <ActionForm
        action={send}
        validate={validate}
        resetOnSuccess={false}
        noToast
        onSuccess={() => {
          const data = new FormData(form.current?.closest("form") ?? undefined);
          setSent({
            email: String(data.get("email") ?? ""),
            plan: chosen ? (also.length ? listWords([chosen, ...also].map((c) => (c.group === "Passes" ? `a ${lowerFirst(c.name)}` : c.name))) : chosen.name) : "",
            group: String(data.get("organization") ?? ""),
            note: note.current,
          });
        }}
        className="mt-6 max-w-3xl"
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
          {also.map((c) => (
            <input key={c.code} type="hidden" name="also" value={c.code} />
          ))}
          <Fields choices={choices} plan={plan} onPlan={setPlan} chosen={chosen} also={also} kinds={kinds} identity={identity} />
          <div className="sm:col-span-2">
            <BotCheck />
            <SubmitButton pendingText="Sending…">Send request</SubmitButton>
          </div>
        </div>
      </ActionForm>
    </>
  );
}

function Fields({
  choices,
  plan,
  onPlan,
  chosen,
  also,
  kinds,
  identity,
}: {
  choices: PlanChoice[];
  plan: string;
  onPlan: (p: string) => void;
  chosen: PlanChoice | null;
  also: PlanChoice[];
  kinds: string[];
  identity: Identity | null;
}) {
  const errors = useFieldErrors();
  const problem = (name: string) => ({
    error: errors[name],
    errorId: `ask-${name}-error`,
  });
  const describe = (name: string) => (errors[name] ? { "aria-invalid": true, "aria-describedby": `ask-${name}-error` } : {});
  // What the account has now that the package chosen leaves out, said before sending (UX r2 2).
  const current = identity?.current ?? null;
  const lost = chosen?.group === "Packages" && current ? sortKinds(current.eventTypes.filter((t) => !chosen.eventTypes.includes(t))) : [];
  // The teacher rate is for a teacher's own account: on a group's account, it's a separate account (UX r2 2).
  const groupAccount = Boolean(identity?.organization) && !current?.teacher;
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

      <Field label="Package or pass" hint="Not sure? Choose “Not sure yet” and tell us below" className="sm:col-span-2" {...problem("plan")}>
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
      {chosen && also.length > 0 && (
        <p className="-mt-2 leading-7 sm:col-span-2">
          <span className="font-semibold">You&apos;re asking about: </span>
          {askingWords([chosen, ...also])}.
        </p>
      )}
      {lost.length > 0 && chosen && current && (
        <p className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 leading-7 sm:col-span-2">
          {chosen.name} doesn&apos;t include {listWords(lost.map(kindNoun))}, which {current.name} has now. Published events stay live, but you
          couldn&apos;t publish new ones of {lost.length === 1 ? "that kind" : "those kinds"}.
        </p>
      )}

      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-semibold">What do you run?</legend>
        <p className="mt-1 text-sm text-muted">
          {kinds.length ? "Carried over from what you picked on Packages and prices. Change it if you like." : "Choose any that apply, so we can answer for your events."}
        </p>
        {/* The same shape as the choices on the pricing page (UI 9). */}
        <div className="mt-3 flex flex-wrap gap-2">
          {WEBSITE_KINDS.map((k) => (
            <KindChoice key={k.value} k={k} name="eventTypes" checked={kinds.includes(k.value)} />
          ))}
        </div>
      </fieldset>

      <div className="space-y-2 sm:col-span-2">
        {chosen?.teacher && groupAccount && (
          <p className="rounded-md border border-border bg-surface p-3 text-sm leading-6">
            The teacher rate, {chosen.teacher}, is for a separate account in your own name. Ask us in the note.
          </p>
        )}
        {chosen?.teacher && !groupAccount && (
          <CheckBox
            name="teacherRate"
            title="I'm a classroom teacher"
            more={
              // In place, so nothing typed is lost (consultant 6).
              <details className="group">
                <summary className={`${LINK} inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm [&::-webkit-details-marker]:hidden`}>
                  Who qualifies
                  <ChevronIcon className="size-4 transition-transform group-open:rotate-180" />
                </summary>
                <p className="pb-1 text-sm text-muted">{TEACHER_WHO}</p>
              </details>
            }
          >
            The teacher rate, {chosen.teacher}, is for an account in your own name for your own classes. A real person checks it.
          </CheckBox>
        )}
        <CheckBox name="payByInvoice" title="We'll pay by invoice or purchase order">
          For schools, districts, and groups that pay by purchase order. We can send a quote and our W-9 first.
        </CheckBox>
      </div>

      <Field label="Anything else? (optional)" className="sm:col-span-2" {...problem("message")}>
        <Textarea name="message" rows={4} maxLength={2000} {...describe("message")} />
      </Field>
    </>
  );
}

function CheckBox({ name, title, children, more }: { name: string; title: string; children: ReactNode; more?: ReactNode }) {
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
        {more}
      </div>
    </div>
  );
}

/** Shown in place of the form once it's in: its own heading, which takes focus so screen readers announce it (UI 2). */
function Sent({ email, plan, group, note, signedIn, back }: { email: string; plan: string; group: string; note: string | null; signedIn: boolean; back: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="max-w-2xl space-y-4 leading-7">
      <h1 ref={ref} tabIndex={-1} className="text-3xl font-medium tracking-tight outline-none sm:text-4xl">
        Request sent
      </h1>
      <p role="status" className="flex items-start gap-2 rounded-md border border-success/40 bg-success-soft px-4 py-3">
        <CheckIcon className="mt-1 size-5 text-success" />
        <span>
          {note ? `${note} ` : ""}A real person will reply to <strong className="[overflow-wrap:anywhere]">{email}</strong> within a day
          {plan ? ` about ${plan}` : ""}
          {group ? ` for ${group}` : ""}.
        </span>
      </p>
      <p>Nothing is charged until you agree. We&apos;ll answer your questions and set it up with you.</p>
      {!signedIn && (
        <p>
          While you wait, see what each kind of event looks like.{" "}
          <Link href="/#organizing" className={`${LINK} inline-flex min-h-11 items-center`}>
            All kinds of events
          </Link>
        </p>
      )}
      <Link href={back} className={BTN_OUTLINE}>
        Back to packages
      </Link>
    </div>
  );
}

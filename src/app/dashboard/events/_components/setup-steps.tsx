import Link from "next/link";
import type { ReactNode } from "react";
import { LeaveStepLink } from "./setup-leave";

export type SetupStep = { id: string; label: string; optional?: boolean };

/** A new event's guided setup, in order. The same sections as Event settings. */
export const SETUP_STEPS: SetupStep[] = [
  { id: "details", label: "Event details" },
  { id: "team", label: "Team setup" },
  { id: "emails", label: "Email settings" },
  { id: "files", label: "Maps & documents", optional: true },
  { id: "more", label: "Publishing & more", optional: true },
];

/** The setup page for a step (the first one is the new-event form, then Event settings with ?setup=1). */
export function setupHref(eventId: string, step: string) {
  return `/dashboard/events/${eventId}/edit?setup=1&section=${step}`;
}

/** "Set up your event", with how far along the steps it is. */
export function SetupHeader({
  current,
  back,
  children,
  steps = SETUP_STEPS,
}: {
  current: string;
  /** The steps to show (most events' guided setup). */
  steps?: SetupStep[];
  /** `guard`: ask before leaving with unsaved changes ("Save and finish later"). */
  back: { href: string; label: string; guard?: boolean };
  children?: ReactNode;
}) {
  const at = steps.findIndex((s) => s.id === current);
  const step = steps[at];
  return (
    <>
      {back.guard ? (
        <LeaveStepLink href={back.href} way="leave" className="text-sm text-muted hover:text-foreground">
          ← {back.label}
        </LeaveStepLink>
      ) : (
        <Link href={back.href} className="text-sm text-muted hover:text-foreground">
          ← {back.label}
        </Link>
      )}
      <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Set up your event</h1>
      <p className="mt-2 text-sm text-muted">
        Step {at + 1} of {steps.length}.{" "}
        Skip anything for now: it&apos;s all in Event settings later.{" "}
        Boxes marked * are required. {children}
      </p>
      <ol className={`mt-5 grid gap-2 ${steps.length === 3 ? "grid-cols-3" : steps.length === 4 ? "grid-cols-4" : "grid-cols-5"}`} aria-label="Setup steps">
        {steps.map((s, i) => {
          const done = i < at;
          const on = i === at;
          return (
            <li key={s.id} aria-current={on ? "step" : undefined}>
              <div className={`h-1.5 rounded-full ${done ? "bg-success" : on ? "bg-brand" : "bg-border"}`} />
              <p className={`mt-1.5 hidden text-xs sm:block ${on ? "font-semibold text-foreground" : "text-muted"}`}>
                {done && <span aria-hidden>✓ </span>}
                {s.label}
                {s.optional && <span className="font-normal"> (optional)</span>}
                {done && <span className="sr-only"> (done)</span>}
              </p>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-sm sm:hidden">
        <span className="font-semibold">
          Step {at + 1} of {steps.length}:
        </span>{" "}
        {step.label}
        {step.optional && " (optional)"}
      </p>
    </>
  );
}

const linkButton = "inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-sm font-semibold sm:px-4";

/**
 * The footer pinned to the bottom of the screen on each setup step: Back,
 * Skip for now, and the main button (Continue, or a form's submit).
 * `inCard` sits it flush along the bottom of the card it's in.
 */
export function SetupFooter({
  back,
  skip,
  next,
  submit,
  inCard = false,
}: {
  back?: string;
  skip?: string;
  /** The main button: a link on, or the form's own submit button. */
  next?: { href: string; label: string };
  submit?: ReactNode;
  inCard?: boolean;
}) {
  return (
    <div
      className={`sticky bottom-[var(--day-bar,0px)] z-10 flex items-center gap-2 border-border bg-surface px-3 py-3 shadow-[0_-6px_16px_rgb(0_0_0/0.10)] sm:px-4 ${
        inCard ? "-mx-4 -mb-4 rounded-b-lg border-t-2 sm:-mx-6 sm:-mb-6 sm:px-6" : "mt-6 rounded-lg border-2"
      }`}
    >
      {back && (
        <LeaveStepLink href={back} way="back" className={`${linkButton} text-muted hover:text-foreground`}>
          ← Back
        </LeaveStepLink>
      )}
      <span className="flex-1" />
      {skip && (
        <LeaveStepLink href={skip} way="skip" className={`${linkButton} border border-border bg-surface hover:border-brand/40 hover:bg-background`}>
          Skip for now
        </LeaveStepLink>
      )}
      {next ? (
        <Link href={next.href} className={`${linkButton} bg-brand text-brand-foreground hover:bg-brand-hover`}>
          {next.label}
        </Link>
      ) : (
        submit
      )}
    </div>
  );
}

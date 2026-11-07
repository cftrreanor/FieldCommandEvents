import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { formatDate } from "@/lib/time";
import { OfferButtons } from "./offer-forms";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** What an Account Host offer link shows, in each state. */
export type OfferState =
  | { kind: "open"; organization: string; from: string; /** "2026-11-21" */ lastDay: string; accept: Action; decline: Action }
  | { kind: "sign-in"; next: string; from: string | null; organization: string | null; emailHint: string | null }
  | { kind: "not-yours"; email: string; next: string }
  | {
      kind: "closed";
      organization: string;
      from: string;
      /** Who's the Account Host now. */
      host: string | null;
      reason: "withdrawn" | "declined" | "replaced" | "left" | "expired";
      teamUrl: string;
    }
  | { kind: "accepted"; organization: string; teamUrl: string; stillHost: boolean }
  | { kind: "missing" };

/** The one next step on every state: full width, like the Accept button. */
const PRIMARY =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand-hover";

export function OfferCard({ state }: { state: OfferState }) {
  const body = (title: string, children: ReactNode, mark?: ReactNode) => (
    <>
      {mark}
      <h1 className="text-2xl font-medium">{title}</h1>
      <div className="mt-3 space-y-4 leading-7 text-muted">{children}</div>
    </>
  );
  const myTeam = (url: string) => (
    <Link href={url} className={PRIMARY}>
      Open My team
    </Link>
  );
  return (
    <Card>
      {state.kind === "open" ? (
        <>
          <p className="text-sm font-medium text-muted">{state.from} offered you</p>
          <h1 className="mt-1 text-2xl font-medium">Become the Account Host for {state.organization}</h1>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm leading-6">
            <li>You&apos;d invite and remove co-hosts, get and renew the plan, and could hand the role on later</li>
            <li>Your access to events stays the same</li>
            <li>
              {state.from} would become a co-host and couldn&apos;t take the role back. Only you could offer it to them again
            </li>
            <li>Nothing changes until you accept. The offer is open through {formatDate(state.lastDay)}</li>
          </ul>
          <div className="mt-6">
            <OfferButtons accept={state.accept} decline={state.decline} from={state.from} />
          </div>
        </>
      ) : state.kind === "sign-in" ? (
        body(
          state.from && state.organization ? `${state.from} offered you the Account Host role for ${state.organization}` : "Sign in to see this offer",
          <>
            <p>
              Sign in to accept or decline
              {state.emailHint ? (
                <>
                  , using the email it was sent to (<strong className="font-medium text-foreground">{state.emailHint}</strong>)
                </>
              ) : null}
              .
            </p>
            <Link href={`/login?next=${encodeURIComponent(state.next)}`} className={PRIMARY}>
              Sign in
            </Link>
          </>,
        )
      ) : state.kind === "not-yours" ? (
        body(
          "This offer is for someone else",
          <>
            <p>
              You&apos;re signed in as <strong className="text-foreground">{state.email}</strong>. Sign in as the co-host it was sent to.
            </p>
            <form action="/auth/signout" method="post">
              <input type="hidden" name="next" value={state.next} />
              <button className={PRIMARY}>Sign out and use another email</button>
            </form>
          </>,
        )
      ) : state.kind === "closed" ? (
        body(
          state.reason === "declined" ? "You declined this offer" : "This offer is no longer open",
          <>
            <p>{closedWhy(state)}</p>
            {myTeam(state.teamUrl)}
          </>,
        )
      ) : state.kind === "accepted" ? (
        body(
          state.stillHost ? `You're the Account Host for ${state.organization}` : "You accepted this offer",
          <>
            <p>
              {state.stillHost
                ? "You invite and remove co-hosts, and get and renew the plan. My team shows your team."
                : "The role has been handed on again since then. My team shows who has it now."}
            </p>
            {myTeam(state.teamUrl)}
          </>,
          state.stillHost ? <SuccessMark /> : undefined,
        )
      ) : (
        body(
          "Offer not found",
          <>
            <p>This link isn&apos;t valid. Ask the Account Host to offer the role again.</p>
            <Link href="/dashboard" className={PRIMARY}>
              Go to your dashboard
            </Link>
          </>,
        )
      )}
    </Card>
  );
}

/** The real reason an offer closed (design review 2026-11-07), and who has the role now. */
function closedWhy(s: Extract<OfferState, { kind: "closed" }>) {
  const host = s.host ?? s.from;
  const still = `${host} is still the Account Host for ${s.organization}.`;
  switch (s.reason) {
    case "declined":
      return `${still} You're still a co-host. If you change your mind, ask ${host} to offer it again.`;
    case "replaced":
      return `${s.from} offered the role to someone else instead. ${still}`;
    case "left":
      return `It ended when you stopped being a co-host. ${still}`;
    case "expired":
      return `It expired after 14 days. ${still} If you'd like the role, ask ${host} to offer it again.`;
    default:
      return `${s.from} withdrew it. ${still} If you were expecting it, ask ${host} about it.`;
  }
}

function SuccessMark() {
  return (
    <span className="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

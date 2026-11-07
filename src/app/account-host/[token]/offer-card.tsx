import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { formatDate } from "@/lib/time";
import { OfferButtons } from "./offer-forms";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** What an Account Host offer link shows, in each state. */
export type OfferState =
  | { kind: "open"; organization: string; from: string; expiresAt: string; accept: Action; decline: Action }
  | { kind: "sign-in"; next: string }
  | { kind: "not-yours"; email: string; next: string }
  | { kind: "closed"; organization: string; from: string }
  | { kind: "accepted"; organization: string; teamUrl: string }
  | { kind: "missing" };

const LINK = "font-medium text-brand underline-offset-4 hover:underline";

export function OfferCard({ state }: { state: OfferState }) {
  const body = (title: string, children: ReactNode) => (
    <>
      <h1 className="text-2xl font-medium">{title}</h1>
      <div className="mt-3 space-y-4 leading-7 text-muted">{children}</div>
    </>
  );
  return (
    <Card>
      {state.kind === "open" ? (
        <>
          <p className="text-sm font-medium text-muted">{state.from} offered you</p>
          <h1 className="mt-1 text-2xl font-medium">Become the Account Host for {state.organization}</h1>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm leading-6">
            <li>You&apos;d invite and remove co-hosts, and could hand the role on later</li>
            <li>Your access to events stays the same</li>
            <li>{state.from} would become a co-host</li>
            <li>Nothing changes until you accept. The offer is open until {formatDate(state.expiresAt.slice(0, 10))}</li>
          </ul>
          <div className="mt-6">
            <OfferButtons accept={state.accept} decline={state.decline} />
          </div>
        </>
      ) : state.kind === "sign-in" ? (
        body(
          "Sign in to see this offer",
          <Link
            href={`/login?next=${encodeURIComponent(state.next)}`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand-hover"
          >
            Sign in
          </Link>,
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
              <button className={LINK}>Sign out and use another email</button>
            </form>
          </>,
        )
      ) : state.kind === "closed" ? (
        body(
          "This offer is no longer open",
          <p>
            It was withdrawn, declined, or it expired, so {state.from} is still the Account Host for {state.organization}. If you were expecting
            it, ask {state.from} to offer it again.
          </p>,
        )
      ) : state.kind === "accepted" ? (
        body(
          `You're the Account Host for ${state.organization}`,
          <Link href={state.teamUrl} className={LINK}>
            Open My team
          </Link>,
        )
      ) : (
        body("Offer not found", <p>This link isn&apos;t valid. Ask the Account Host to offer the role again.</p>)
      )}
    </Card>
  );
}

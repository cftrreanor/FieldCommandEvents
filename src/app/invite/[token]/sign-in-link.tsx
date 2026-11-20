"use client";

import { useActionState } from "react";
import { sendLoginLink, type LoginState } from "@/app/login/actions";
import { SubmitButton } from "@/components/submit-button";

/**
 * After the email's first week (its button no longer signs anyone in): one button that emails a sign-in link to the
 * invited address, and brings them back here to accept. No password.
 */
export function EmailSignInLink({ email, next }: { email: string; next: string }) {
  const [state, action] = useActionState<LoginState, FormData>(sendLoginLink, {});
  if (state.sentTo) {
    return (
      <p role="status" className="text-sm leading-6">
        <span className="font-semibold">Sent to {state.sentTo}.</span> Open the email on this device and use its link. It brings you back here to accept.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next} />
      <SubmitButton pendingText="Sending…" className="w-full">
        Email me a sign-in link
      </SubmitButton>
      {state.error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}

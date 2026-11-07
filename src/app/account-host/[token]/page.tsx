import type { Metadata } from "next";
import { acceptAccountHost, declineAccountHost } from "@/app/dashboard/team-actions";
import { HeaderBar } from "@/components/logo";
import { getUser } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { utcToZonedDate } from "@/lib/time";
import { OfferCard, type OfferState } from "./offer-card";

export const metadata: Metadata = { title: "Account Host offer" };

/** "p•••@gmail.com": enough to know which email to sign in with, not enough to read it off a shared screen. */
const hint = (email: string) => email.replace(/^(.)[^@]*/, "$1•••");

/** The link in an Account Host offer email: accept or decline (get_account_host_offer()). */
export default async function AccountHostOfferPage({ params }: PageProps<"/account-host/[token]">) {
  const { token } = await params;
  const next = `/account-host/${token}`;
  const user = await getUser();
  let state: OfferState;
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    state = { kind: "missing" };
  } else if (!user) {
    // Before signing in: who it's from, and which email it was sent to (hinted), read on the server.
    const { data } = await createAdminClient()
      .from("account_host_handoffs")
      .select("organizations(name), from:profiles!account_host_handoffs_offered_by_fkey(full_name, email), to:profiles!account_host_handoffs_to_user_fkey(email)")
      .eq("token", token)
      .maybeSingle();
    const row = data as unknown as {
      organizations: { name: string } | null;
      from: { full_name: string | null; email: string } | null;
      to: { email: string } | null;
    } | null;
    state = {
      kind: "sign-in",
      next,
      from: row?.from ? row.from.full_name || row.from.email : null,
      organization: row?.organizations?.name ?? null,
      emailHint: row?.to?.email ? hint(row.to.email) : null,
    };
  } else {
    const supabase = await createClient();
    const { data } = await supabase.rpc("get_account_host_offer", { p_token: token }).maybeSingle();
    const offer = data as {
      organization_id: string | null;
      organization: string | null;
      offered_by: string | null;
      open: boolean;
      accepted: boolean;
      for_you: boolean;
      expires_at: string | null;
      closed_reason: "withdrawn" | "declined" | "replaced" | "left" | "expired" | null;
      current_host: string | null;
      host_now: boolean | null;
      timezone: string | null;
    } | null;
    if (!offer) state = { kind: "missing" };
    else if (!offer.for_you) state = { kind: "not-yours", email: user.email, next };
    else {
      const organization = offer.organization ?? "this account";
      const teamUrl = `/dashboard/team?account=${offer.organization_id ?? ""}`;
      if (offer.accepted) state = { kind: "accepted", organization, teamUrl, stillHost: !!offer.host_now };
      else if (!offer.open)
        state = {
          kind: "closed",
          organization,
          from: offer.offered_by ?? "The Account Host",
          host: offer.current_host,
          reason: offer.closed_reason ?? "withdrawn",
          teamUrl,
        };
      else
        state = {
          kind: "open",
          organization,
          from: offer.offered_by ?? "The Account Host",
          // The last day it's open, in the account's time zone.
          lastDay: utcToZonedDate(new Date(new Date(offer.expires_at!).getTime() - 1000).toISOString(), offer.timezone || "America/Chicago"),
          accept: acceptAccountHost.bind(null, token),
          decline: declineAccountHost.bind(null, token),
        };
    }
  }
  return (
    <>
      <HeaderBar maxWidth="max-w-md" />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          <OfferCard state={state} />
        </div>
      </main>
    </>
  );
}

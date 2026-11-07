import type { Metadata } from "next";
import { acceptAccountHost, withdrawAccountHostOffer } from "@/app/dashboard/team-actions";
import { HeaderBar } from "@/components/logo";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { OfferCard, type OfferState } from "./offer-card";

export const metadata: Metadata = { title: "Account Host offer" };

/** The link in an Account Host offer email: accept or decline (get_account_host_offer()). */
export default async function AccountHostOfferPage({ params }: PageProps<"/account-host/[token]">) {
  const { token } = await params;
  const next = `/account-host/${token}`;
  const user = await getUser();
  let state: OfferState;
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    state = { kind: "missing" };
  } else if (!user) {
    state = { kind: "sign-in", next };
  } else {
    const supabase = await createClient();
    const { data } = await supabase.rpc("get_account_host_offer", { p_token: token }).maybeSingle();
    const offer = data as { organization: string; offered_by: string; open: boolean; accepted: boolean; for_you: boolean } | null;
    const { data: row } = await supabase.from("account_host_handoffs").select("organization_id").eq("token", token).maybeSingle();
    if (!offer) state = { kind: "missing" };
    else if (!offer.for_you) state = { kind: "not-yours", email: user.email, next };
    else if (offer.accepted) state = { kind: "accepted", organization: offer.organization, teamUrl: `/dashboard/team?account=${row?.organization_id ?? ""}` };
    else if (!offer.open || !row) state = { kind: "closed", organization: offer.organization, from: offer.offered_by };
    else {
      const { data: when } = await supabase.from("account_host_handoffs").select("expires_at").eq("token", token).maybeSingle();
      state = {
        kind: "open",
        organization: offer.organization,
        from: offer.offered_by,
        expiresAt: when?.expires_at ?? new Date().toISOString(),
        accept: acceptAccountHost.bind(null, token),
        decline: withdrawAccountHostOffer.bind(null, row.organization_id, true),
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

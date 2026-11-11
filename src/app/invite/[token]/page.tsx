import type { Metadata } from "next";
import { emailLinkCutoff } from "@/lib/email-link-age";
import { HeaderBar } from "@/components/logo";
import Link from "next/link";
import { CO_HOST_INVITE } from "@/lib/team-words";
import { acceptInvitation, joinFromEmail } from "@/app/dashboard/team-actions";
import { Card } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { formatDateRange } from "@/lib/time";
import { AcceptForm, JoinForm } from "./accept-form";

export const metadata: Metadata = { title: "You're invited" };

const ROLE = {
  volunteer_director: {
    label: "Volunteer Lead",
    blurb: "You'll set up shifts, see every volunteer's contact details, and check people in on the day.",
  },
  section_lead: {
    label: "Coordinator",
    blurb: "You'll see who's assigned to your sign-up. Their phone numbers unlock on event day.",
  },
  co_host: {
    label: "a co-host",
    blurb:
      "You'll help run this event: setup, publishing, sign-ups, volunteers, and the event day. You won't see the account's other events, and your access ends 10 days after the event.",
  },
} as const;

export default async function InvitePage({ params, searchParams }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const { k } = await searchParams;
  const valid = /^[0-9a-f-]{36}$/i.test(token);
  const supabase = await createClient();
  const { data } = valid ? await supabase.rpc("get_invitation", { p_token: token }).maybeSingle() : { data: null };
  const invite = data as {
    email: string;
    role: keyof typeof ROLE | null;
    as_host: boolean | null;
    /** Empty for a co-host invitation to the whole account. */
    event_name: string | null;
    starts_on: string | null;
    ends_on: string | null;
    organization: string;
    station_name: string | null;
    expired: boolean;
    accepted: boolean;
  } | null;
  const user = await getUser();
  // From the invitation email: the secret key proves they own the invited
  // email, so they can join with one tap (no separate sign-in email).
  const key = typeof k === "string" && /^[0-9a-f-]{36}$/i.test(k) ? k : null;
  const fromEmail =
    key && invite && !invite.accepted && !invite.expired
      ? await (async () => {
          const admin = createAdminClient();
          // The email's one-tap join works for a week after it was sent; after that, sign in normally.
          const { data: match } = await admin
            .from("invitations")
            .select("id")
            .eq("token", token)
            .eq("email_token", key)
            .gte("sent_at", emailLinkCutoff())
            .maybeSingle();
          if (!match) return null;
          const { data: profile } = await admin.from("profiles").select("full_name").eq("email", invite.email).maybeSingle();
          return { needsName: !profile?.full_name };
        })()
      : null;
  const signedInAsInvitee = user && invite && user.email.toLowerCase() === invite.email.toLowerCase();
  const role =
    invite && (invite.as_host || !invite.role)
      ? {
          label: "a co-host",
          blurb: CO_HOST_INVITE,
        }
      : invite && ROLE[invite.role!];

  return (
    <>
    <HeaderBar maxWidth="max-w-md" />
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <Card>
          {!invite ? (
            <>
              <h1 className="text-2xl font-medium">Invitation not found</h1>
              <p className="mt-2 leading-7 text-muted">
                This link isn&apos;t valid or was canceled. Ask the person who invited you for a new one.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-muted">{invite.organization} invited you</p>
              <h1 className="mt-1 text-2xl font-medium">
                Join {invite.event_name ?? invite.organization} as {role?.label}
              </h1>
              {invite.starts_on && invite.ends_on && (
                <p className="mt-1 text-sm text-muted">
                  {formatDateRange(invite.starts_on, invite.ends_on)}
                  {invite.station_name && ` · ${invite.station_name}`}
                </p>
              )}
              <p className="mt-4 leading-7 text-muted">{role?.blurb}</p>

              <div className="mt-6">
                {invite.accepted ? (
                  <p className="text-sm text-muted">
                    This invitation has already been accepted.{" "}
                    <Link href="/dashboard" className="font-medium text-brand underline-offset-4 hover:underline">
                      Go to your dashboard
                    </Link>
                  </p>
                ) : invite.expired ? (
                  <p className="text-sm text-muted">This invitation has expired. Ask for a new one.</p>
                ) : fromEmail && !signedInAsInvitee ? (
                  <JoinForm action={joinFromEmail.bind(null, token, key!)} email={invite.email} needsName={fromEmail.needsName} />
                ) : !user ? (
                  <>
                    <p className="mb-4 text-sm text-muted">
                      Sign in with <strong className="text-foreground">{invite.email}</strong> to accept. No
                      password needed.
                    </p>
                    <Link
                      href={`/login?next=${encodeURIComponent(`/invite/${token}`)}&email=${encodeURIComponent(invite.email)}`}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand-hover"
                    >
                      Sign in to accept
                    </Link>
                  </>
                ) : user.email.toLowerCase() !== invite.email.toLowerCase() ? (
                  <div className="space-y-4 text-sm leading-6 text-muted">
                    <p>
                      This invitation is for <strong className="text-foreground">{invite.email}</strong>, but
                      you&apos;re signed in as <strong className="text-foreground">{user.email}</strong>.
                    </p>
                    <form action="/auth/signout" method="post">
                      <input type="hidden" name="next" value={`/invite/${token}`} />
                      <button className="font-medium text-brand underline-offset-4 hover:underline">
                        Sign out and use the invited email
                      </button>
                    </form>
                  </div>
                ) : (
                  <AcceptForm action={acceptInvitation.bind(null, token)} />
                )}
              </div>
            </>
          )}
        </Card>
      </div>
    </main>
    </>
  );
}

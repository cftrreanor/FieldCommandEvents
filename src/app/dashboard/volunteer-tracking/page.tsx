import type { Metadata } from "next";
import { loadTiers } from "@/lib/package-names";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isSchemaError, missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { trackingAccounts } from "@/lib/volunteer-tracking";
import { brand } from "@/lib/brand";
import { loadAccountPlan } from "@/lib/plan";
import { removeFromVolunteerHistory } from "./actions";
import { HistoryTable, type HistoryRow } from "./history-table";
import { LineIcon } from "@/components/line-icon";

export const metadata: Metadata = { title: "Volunteer tracking" };

/** Made-up volunteers for the blurred preview. */
const SAMPLE_ROWS: HistoryRow[] = [
  { email: "a@example.com", full_name: "Maria Lopez", events: 6, signed_up: 9, checked_in: 9, last_event_name: "Fall Festival", last_event_on: "2026-10-03" },
  { email: "b@example.com", full_name: "James Carter", events: 4, signed_up: 6, checked_in: 5, last_event_name: "Book Fair", last_event_on: "2026-09-19" },
  { email: "c@example.com", full_name: "Priya Shah", events: 3, signed_up: 4, checked_in: 4, last_event_name: "Fall Festival", last_event_on: "2026-10-03" },
  { email: "d@example.com", full_name: "Tom Nguyen", events: 3, signed_up: 5, checked_in: 3, last_event_name: "Spring Carnival", last_event_on: "2026-04-25" },
  { email: "e@example.com", full_name: "Alicia Brown", events: 2, signed_up: 3, checked_in: 2, last_event_name: "Book Fair", last_event_on: "2026-09-19" },
  { email: "f@example.com", full_name: "Sam Patel", events: 2, signed_up: 2, checked_in: 1, last_event_name: "Field Day", last_event_on: "2026-05-15" },
  { email: "g@example.com", full_name: "Grace Kim", events: 1, signed_up: 2, checked_in: 2, last_event_name: "Fall Festival", last_event_on: "2026-10-03" },
  { email: "h@example.com", full_name: "David Ortiz", events: 1, signed_up: 1, checked_in: 0, last_event_name: "Field Day", last_event_on: "2026-05-15" },
];

/**
 * Every adult who has volunteered at the account's events: shifts signed up,
 * shifts checked in, and the share they showed up for. For hosts and
 * Volunteer Leads (supabase/migrations/20261221000000_volunteer_history.sql).
 */
export default async function VolunteerTrackingPage({ searchParams }: PageProps<"/dashboard/volunteer-tracking">) {
  const { account: picked } = await searchParams;
  const user = await requireUser();
  const accounts = await trackingAccounts(user.id);
  if (!accounts.length) redirect("/dashboard");
  const account = accounts.find((a) => a.id === picked) ?? accounts[0];

  const supabase = await createClient();
  const [{ data, error }, plan] = await Promise.all([
    supabase.rpc("volunteer_report", { p_org: account.id }),
    loadAccountPlan(supabase, account.id),
  ]);
  if (error && isSchemaError(error)) missing();
  // Tracking shows on packages that include it, or after a downgrade with history from before. Everyone
  // else sees a blurred preview with how to upgrade (history keeps recording for when they do).
  const preview = plan?.volunteer_tracking === false || (error?.code === "42501" && error.message.startsWith("Your "));
  if (error && !preview) console.error("volunteer_report failed", error);
  const rows = ((data ?? []) as HistoryRow[]).map((r) => ({ ...r, email: r.email.toLowerCase() }));
  // The smallest package that includes tracking, by its name on the Packages page.
  const withTracking = preview ? (await loadTiers()).find((t) => t.kind === "package" && t.volunteer_history && !t.retired_at)?.name ?? "a bigger plan" : "";

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Volunteer tracking</h1>
      <p className="mt-2 max-w-3xl leading-7 text-muted">
        Everyone who has volunteered at your account&apos;s events, with the shifts they signed up for and checked in to.
        Use it to put your most dependable volunteers first, like for chaperone spots. Shifts count once they&apos;re over.
      </p>
      {accounts.length > 1 && (
        <nav aria-label="Account" className="mt-4 flex flex-wrap gap-2">
          {accounts.map((a) => (
            <Link
              key={a.id}
              href={{ pathname: "/dashboard/volunteer-tracking", query: { account: a.id } }}
              aria-current={a.id === account.id ? "page" : undefined}
              className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium ${
                a.id === account.id ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface hover:bg-background"
              }`}
            >
              {a.name}
            </Link>
          ))}
        </nav>
      )}
      {preview ? (
        <div className="relative mt-6">
          {/* Made-up rows, blurred, to show what the page looks like. */}
          <div inert aria-hidden className="pointer-events-none select-none blur-[3px]">
            <HistoryTable rows={SAMPLE_ROWS} />
          </div>
          <div className="absolute inset-0 flex items-start justify-center px-4 pt-10 sm:pt-16">
            <section
              aria-labelledby="upgrade-title"
              className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-elevated"
            >
              <h2 id="upgrade-title" className="text-xl font-semibold">
                Volunteer tracking comes with {withTracking}
              </h2>
              <p className="mt-2 leading-7 text-muted">
                See everyone who has volunteered at your events, how often they show up for their shifts, and who to ask first.
                {plan ? ` You're on ${plan.package_name} now.` : ""}
              </p>
              <p className="mt-2 leading-7 text-muted">
                We keep a record of your volunteers either way, so it&apos;s all here when you upgrade.
              </p>
              <a
                href={`mailto:${brand.supportEmail}?subject=${encodeURIComponent(`Upgrade to ${withTracking}`)}`}
                className="mt-5 inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
              >
                Write to us to upgrade
              </a>
            </section>
          </div>
        </div>
      ) : error ? (
        <p className="mt-6 text-danger">We couldn&apos;t load your volunteer tracking. Please try again.</p>
      ) : (
        <div className="mt-6">
          <HistoryTable
            key={account.id}
            rows={rows}
            remove={account.isHost ? removeFromVolunteerHistory.bind(null, account.id) : undefined}
          />
        </div>
      )}
      <p className="mt-8 max-w-3xl text-sm text-muted">
        <LineIcon name="lock" inline />Only your Hosts, Co-hosts, and Volunteer Leads see this. Names, emails, and shift counts are kept for 2 years after
        someone&apos;s last event; phone numbers are deleted 10 days after each event, and volunteers under 18 aren&apos;t included.
        {account.isHost ? " If someone asks to be forgotten, use Remove next to their name." : ""}
      </p>
    </div>
  );
}

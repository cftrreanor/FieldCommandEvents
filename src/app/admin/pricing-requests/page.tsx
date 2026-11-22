import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { requirePlatformAdmin } from "@/lib/admin";
import { stamp } from "@/lib/admin-crm";
import { loadTiers, type Tier } from "@/lib/package-names";
import { kindLabel, passLabel, sortKinds } from "@/lib/pricing";
import { isSchemaError, missing } from "@/lib/schema-check";
import { createAdminClient } from "@/lib/supabase/server";
import { PageHeader, Tag } from "../kit";
import { setRequestHandled } from "./actions";

export const metadata: Metadata = { title: "Pricing requests" };

type Row = {
  id: string;
  name: string;
  email: string;
  organization: string;
  event_types: string[];
  plan_code: string | null;
  teacher_rate: boolean;
  pay_by_invoice: boolean;
  message: string | null;
  user_id: string | null;
  organization_id: string | null;
  created_at: string;
  handled_at: string | null;
  account: { id: string; name: string } | null;
};

/** What they asked about, in the words the pricing page uses. */
function planWords(code: string | null, tiers: Tier[]) {
  if (!code) return null;
  const t = tiers.find((x) => x.code === code);
  if (!t) return code;
  return t.kind === "pass" ? passLabel(t.event_types[0] ?? "") : t.name;
}

/** The next step, named plainly (owner decisions 2 and 4: apply by hand, invoice net 30, starts when sent). */
function nextStep(r: Row, tiers: Tier[]) {
  const t = tiers.find((x) => x.code === r.plan_code);
  const where = r.account ? "from the account's page" : "from their account's page (find it, or set one up first)";
  if (!t) return "Reply by email: they asked without picking a package or pass";
  if (t.kind === "pass") return `Add the pass ${where}, then send the invoice: net 30`;
  return `Apply the package ${where}, then send the invoice: net 30, starts when sent`;
}

/** Requests from the pricing page's "Ask about [package]" and "Get a [kind] pass" buttons, to answer by hand. */
export default async function PricingRequestsPage() {
  await requirePlatformAdmin();
  const [tiers, { data, error }] = await Promise.all([
    loadTiers(),
    createAdminClient()
      .from("pricing_requests")
      .select(
        "id, name, email, organization, event_types, plan_code, teacher_rate, pay_by_invoice, message, user_id, organization_id, created_at, handled_at, account:organizations!pricing_requests_organization_id_fkey(id, name)",
      )
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (error) {
    if (isSchemaError(error)) missing();
    throw new Error(error.message);
  }
  const rows = (data ?? []) as unknown as Row[];
  const open = rows.filter((r) => !r.handled_at);
  const handled = rows.filter((r) => r.handled_at);

  return (
    <div>
      <PageHeader
        title="Pricing requests"
        sub="Sent from the pricing page's Ask about and Get a pass buttons, newest first. Each one is also emailed to you. Requests are kept for a year."
      />
      <section aria-labelledby="to-handle" className="max-w-3xl">
        <h2 id="to-handle" className="mb-2 text-sm font-semibold">
          To handle ({open.length})
        </h2>
        {open.length ? (
          <ul className="space-y-3">
            {open.map((r) => (
              <Request key={r.id} r={r} tiers={tiers} />
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-border bg-surface px-3 py-4 text-sm">
            {rows.length ? "All caught up. New requests from the pricing page show up here." : "Nothing yet. Requests from the pricing page show up here."}
          </p>
        )}
      </section>
      {handled.length > 0 && (
        <details className="mt-6 max-w-3xl">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Handled ({handled.length})</summary>
          <ul className="mt-2 space-y-3">
            {handled.map((r) => (
              <Request key={r.id} r={r} tiers={tiers} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Request({ r, tiers }: { r: Row; tiers: Tier[] }) {
  const plan = planWords(r.plan_code, tiers);
  const kinds = sortKinds(r.event_types);
  return (
    <li id={r.id} className="scroll-mt-16 rounded-md border border-border bg-surface p-3 target:ring-2 target:ring-brand">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-semibold">
          {r.name}
          <span className="font-normal text-muted">, {r.organization}</span>
        </h3>
        <p className="text-sm text-muted">{stamp(r.created_at)}</p>
      </div>
      <p className="mt-0.5 text-sm break-words">
        <a href={`mailto:${r.email}`} className="font-medium text-brand underline underline-offset-4">
          {r.email}
        </a>
        {r.account ? (
          <>
            {" · Signed in, for "}
            <Link href={`/admin/accounts/${r.account.id}`} className="font-medium text-brand underline underline-offset-4">
              {r.account.name}
            </Link>
          </>
        ) : r.user_id ? (
          <>
            {" · Signed in: "}
            <Link href={`/admin/people/${r.user_id}`} className="font-medium text-brand underline underline-offset-4">
              their person page
            </Link>
          </>
        ) : (
          " · Not signed in"
        )}
      </p>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Asked about</dt>
        <dd>{plan ?? "No package or pass picked"}</dd>
        <dt className="text-muted">Kinds of event</dt>
        <dd>{kinds.length ? kinds.map(kindLabel).join(", ") : "None picked"}</dd>
        {(r.teacher_rate || r.pay_by_invoice) && (
          <>
            <dt className="text-muted">Also</dt>
            <dd className="flex flex-wrap gap-1.5">
              {r.teacher_rate && <Tag tone="brand">Says they&apos;re a classroom teacher</Tag>}
              {r.pay_by_invoice && <Tag>Pays by invoice or purchase order</Tag>}
            </dd>
          </>
        )}
      </dl>
      {r.message && <p className="mt-2 rounded-sm bg-background px-3 py-2 text-sm whitespace-pre-wrap">{r.message}</p>}
      {!r.handled_at && (
        <div className="mt-3 border-t border-border pt-2 text-sm">
          <p>
            <span className="font-semibold">Next: </span>
            {nextStep(r, tiers)}
          </p>
          {r.teacher_rate && (
            <p className="mt-1">
              Before the teacher rate, check that it&apos;s a classroom teacher&apos;s own account for their own classes or conferences. Then set the
              account&apos;s rate to Teacher rate
            </p>
          )}
        </div>
      )}
      <ActionForm action={setRequestHandled} resetOnSuccess={false} className="mt-2 flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={r.id} />
        <input type="hidden" name="handled" value={r.handled_at ? "0" : "1"} />
        {r.handled_at && <span className="text-sm text-muted">Handled {stamp(r.handled_at)}</span>}
        <SubmitButton variant="secondary" pendingText="Saving…">
          {r.handled_at ? "Move back to To handle" : "Mark handled"}
        </SubmitButton>
      </ActionForm>
    </li>
  );
}

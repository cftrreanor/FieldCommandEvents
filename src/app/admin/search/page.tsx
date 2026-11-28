import { requestWord } from "@/lib/pilot";
import { pilotOver } from "@/lib/site-pricing";
import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/admin";
import { ago, stageLabel, stamp } from "@/lib/admin-crm";
import { createAdminClient } from "@/lib/supabase/server";
import { loadAccounts, type EmailRow } from "../data";
import { EmptyRow, HealthPill, PageHeader, Panel, RecordLink, Table, Tag, Td, Th, Tr } from "../kit";

export const metadata: Metadata = { title: "Search" };

/** A quoted PostgREST "ilike" pattern for the user's text (characters that steer the filter are dropped). */
const like = (q: string) => `"%${q.replace(/[%*\\"(),]/g, "")}%"`;

/** One search box across accounts, people, pilot requests and emails sent. */
export default async function SearchPage({ searchParams }: PageProps<"/admin/search">) {
  await requirePlatformAdmin();
  const { q: raw } = await searchParams;
  const q = typeof raw === "string" ? raw.trim().slice(0, 200) : "";
  const lower = q.toLowerCase();
  if (!q) return <PageHeader title="Search" sub="Type a name, school, or email in the box above." />;

  const admin = createAdminClient();
  const pattern = like(q);
  const [accounts, { data: peopleData }, { data: requestData }, { data: emailData }] = await Promise.all([
    loadAccounts(),
    admin.from("profiles").select("id, full_name, email").or(`full_name.ilike.${pattern},email.ilike.${pattern}`).limit(50),
    admin.from("pilot_requests").select("id, name, email, organization, status").or(`organization.ilike.${pattern},name.ilike.${pattern},email.ilike.${pattern}`).limit(50),
    q.includes("@") ? admin.from("email_log").select("*").eq("to_email", lower).order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
  ]);
  const accountHits = accounts.filter(
    (a) => a.name.toLowerCase().includes(lower) || a.organization_members.some((m) => m.profiles?.email.toLowerCase().includes(lower)),
  );
  const people = (peopleData ?? []) as { id: string; full_name: string; email: string }[];
  const requests = (requestData ?? []) as { id: string; name: string; email: string; organization: string; status: string }[];
  const emails = (emailData ?? []) as unknown as EmailRow[];
  const total = accountHits.length + people.length + requests.length;

  return (
    <div className="space-y-4">
      <PageHeader title={`Results for “${q}”`} sub={`${total} match${total === 1 ? "" : "es"}`} />
      <Panel title={`Accounts (${accountHits.length})`} flush>
        <ul className="divide-y divide-border">
          {accountHits.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <RecordLink href={`/admin/accounts/${a.id}`}>{a.name}</RecordLink>
                <span className="text-muted"> · {a.owner?.email ?? "No owner"}</span>
              </span>
              <HealthPill level={a.health.level} />
            </li>
          ))}
          {accountHits.length === 0 && <li className="px-3 py-3 text-sm text-muted">No accounts</li>}
        </ul>
      </Panel>
      <Panel title={`People (${people.length})`} flush>
        <ul className="divide-y divide-border">
          {people.map((p) => (
            <li key={p.id} className="px-3 py-2 text-sm">
              <RecordLink href={`/admin/people/${p.id}`}>{p.full_name || p.email}</RecordLink>
              <span className="text-muted"> · {p.email}</span>
            </li>
          ))}
          {people.length === 0 && <li className="px-3 py-3 text-sm text-muted">No one with an account</li>}
        </ul>
      </Panel>
      <Panel title={`${requestWord(pilotOver())}s (${requests.length})`} flush>
        <ul className="divide-y divide-border">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <RecordLink href={`/admin/pipeline/${r.id}`}>{r.organization}</RecordLink>
                <span className="text-muted">
                  {" "}
                  · {r.name} · {r.email}
                </span>
              </span>
              <Tag>{stageLabel(r.status)}</Tag>
            </li>
          ))}
          {requests.length === 0 && <li className="px-3 py-3 text-sm text-muted">No {requestWord(pilotOver()).toLowerCase()}s</li>}
        </ul>
      </Panel>
      {q.includes("@") && (
        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Emails sent to {lower}</h2>
          <p className="mb-2 text-sm text-muted">Includes volunteers and parents, who don&apos;t have accounts. Kept 14 days for them, 180 days for account holders.</p>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Subject</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {emails.map((e) => (
                <Tr key={e.id}>
                  <Td className="whitespace-nowrap" title={stamp(e.created_at)}>
                    {ago(e.created_at)}
                  </Td>
                  <Td>{e.subject}</Td>
                  <Td>
                    <Tag tone={e.status === "sent" ? "success" : "danger"}>{e.status === "sent" ? "Sent" : e.status === "failed" ? "Failed" : "Not sent"}</Tag>
                    {e.error && <p className="text-xs text-muted">{e.error}</p>}
                  </Td>
                </Tr>
              ))}
              {emails.length === 0 && <EmptyRow cols={3}>No emails to this address in the log.</EmptyRow>}
            </tbody>
          </Table>
        </section>
      )}
    </div>
  );
}

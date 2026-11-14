import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HeaderBar } from "@/components/logo";
import { isQa } from "@/lib/qa";
import { missing } from "@/lib/schema-check";
import { createAdminClient } from "@/lib/supabase/server";
import { EmailFrame } from "./email-frame";

export const metadata: Metadata = { title: "QA outbox" };

/** One email from the QA outbox, as the person would see it. */
export default async function QaEmailPage({ params }: PageProps<"/qa/outbox/[id]">) {
  if (!isQa()) redirect("/");
  const { id } = await params;
  const { data: email } = await createAdminClient().from("qa_outbox").select("*").eq("id", id).maybeSingle();
  if (!email) missing();

  const rows: [string, string][] = [
    ["From", email.sender],
    ...(email.reply_to ? ([["Replies go to", email.reply_to]] as [string, string][]) : []),
    ["To", email.recipients.join(", ")],
    ["Sent", new Date(email.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }) + " Central"],
    ...(email.invite ? ([["Calendar", email.invite === "CANCEL" ? "Cancels the calendar event" : "Adds or updates a calendar event"]] as [string, string][]) : []),
  ];

  return (
    <>
      <HeaderBar maxWidth="max-w-4xl" />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:py-12">
        <Link href="/qa/outbox" className="text-sm font-medium text-brand underline underline-offset-4">
          ← Outbox
        </Link>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">{email.subject}</h1>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {rows.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="font-semibold text-muted">{term}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {/* The email as sent, walled off from this page (no scripts, no forms), as tall as the email. */}
        <EmailFrame title={`Email: ${email.subject}`} html={email.html} />
        {email.text_body && (
          <details className="mt-6">
            <summary className="cursor-pointer font-semibold">Plain-text version</summary>
            <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-border bg-surface p-4 font-sans text-sm leading-6">{email.text_body}</pre>
          </details>
        )}
      </main>
    </>
  );
}

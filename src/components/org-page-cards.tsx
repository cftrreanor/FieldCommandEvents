import Link from "next/link";
import { orgPageCardWords, orgPageHref, type OrgPageAccount } from "@/lib/org-page-summary";
import { toReview } from "@/lib/org-page-words";
import { utcToZonedDate } from "@/lib/time";

/**
 * My events' Organization page cards: one per account this person runs the page for. With more than one, each names
 * its group ("Cedar Ridge Boosters page"). New events to review come first, with a Review link, so they aren't
 * buried after the counts (built-page review, 2026-11-21).
 */
export function OrgPageCards({ accounts }: { accounts: OrgPageAccount[] }) {
  if (!accounts.length) return null;
  const many = accounts.length > 1;
  return (
    <div className="space-y-2">
      {accounts.map((a) => {
        const href = orgPageHref(a.id);
        const today = utcToZonedDate(new Date().toISOString(), a.default_timezone || "America/Chicago");
        const review = a.summary.page_on && !a.summary.blocked ? a.summary.new_to_review : 0;
        return (
          <div key={a.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm">
            <Link href={href} className="font-semibold underline-offset-4 hover:underline [overflow-wrap:anywhere]">
              {many ? `${a.summary.name} page` : "Organization page"}
            </Link>
            {review > 0 && (
              <Link href={`${href}#org-review`} className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
                {toReview(review)} · Review
              </Link>
            )}
            <Link href={href} className="ml-auto text-muted underline-offset-4 hover:underline">
              {orgPageCardWords(a.summary, today)}
              {" →"}
            </Link>
          </div>
        );
      })}
    </div>
  );
}

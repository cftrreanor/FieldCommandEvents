import { OrgPageEventControl, type OrgPageNeed } from "@/components/org-page-switch";
import { Badge, Card } from "@/components/ui";
import { dayRange, NEW_EVENTS_RULE, orgPageKindLabel, shortDay, toReview, type EventOrgPageStatus } from "@/lib/org-page-words";

export type OrgEventRow = {
  id: string;
  name: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  draft: boolean;
  status: EventOrgPageStatus;
  need: OrgPageNeed;
};

/** The page is on: every upcoming volunteer event and fair with its switch, saving as you go (board 3b). */
export function EventsList({
  orgName,
  rows,
  toReview: reviewCount,
  ended,
  others,
  neverLine,
}: {
  orgName: string;
  rows: OrgEventRow[];
  toReview: number;
  ended: { id: string; name: string; startsOn: string }[];
  /** Other kinds coming up (never listed), named once. */
  others: string[];
  neverLine: string;
}) {
  const review = rows.filter((r) => r.status.needs_review);
  const rest = rows.filter((r) => !r.status.needs_review);
  const row = (r: OrgEventRow) => (
    <li key={r.id}>
      <OrgPageEventControl
        eventId={r.id}
        eventName={r.name}
        orgName={orgName}
        status={r.status}
        need={r.need}
        head={
          <>
            <p className="font-semibold [overflow-wrap:anywhere]">
              {r.name}
              {r.status.needs_review && (
                <span className="ml-2 align-middle">
                  <Badge tone="info">New</Badge>
                </span>
              )}
              {r.draft && (
                <span className="ml-2 align-middle">
                  <Badge tone="neutral">Draft</Badge>
                </span>
              )}
            </p>
            <p className="text-sm">
              {orgPageKindLabel(r.kind)} · {dayRange(r.startsOn, r.endsOn)}
            </p>
          </>
        }
      />
    </li>
  );
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="text-lg font-semibold">Events</h2>
        <p className="text-sm text-muted">Saves as you go</p>
      </div>
      <p className="mt-1 text-sm leading-6 text-muted">
        Your volunteer events and fairs. Full, closed, and past ones leave the page on their own, and come back if spots open up.
      </p>
      <p className="mt-3 rounded-md bg-brand-soft px-3 py-2 text-sm leading-6">{NEW_EVENTS_RULE}</p>
      {reviewCount > 0 && review.length > 0 && (
        <section aria-labelledby="org-review" className="mt-4">
          <h3 id="org-review" className="font-semibold">
            {toReview(review.length)}
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted">
            {review.length === 1 ? "A Co-host of this event made it, so it starts off your page." : "Co-hosts of these events made them, so they start off your page."} Switch
            on to show {review.length === 1 ? "it" : "one"}, or select Leave it off.
          </p>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">{review.map(row)}</ul>
        </section>
      )}
      {rest.length ? (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">{rest.map(row)}</ul>
      ) : (
        !review.length && <p className="mt-4 text-sm leading-6">No volunteer events or fairs coming up. New ones start on your page.</p>
      )}
      {ended.length > 0 && (
        <details className="group mt-3 rounded-md border border-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 text-sm font-semibold text-brand">
            <span aria-hidden className="inline-block group-open:rotate-90">
              ›
            </span>
            Ended ({ended.length})
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {ended.map((e) => (
              <li key={e.id} className="px-3 py-2 text-sm [overflow-wrap:anywhere]">
                {e.name} · {shortDay(e.startsOn)} · Ended, not shown
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-3 text-sm leading-6">
        {others.length > 0 && (
          <>
            {others.length <= 3 ? `${others.join(others.length === 2 ? " and " : ", ").replace(/, ([^,]*)$/, ", and $1")} ${others.length === 1 ? "isn't" : "aren't"} here.` : `${others.length} other events aren't here.`}{" "}
          </>
        )}
        {neverLine}
      </p>
    </Card>
  );
}

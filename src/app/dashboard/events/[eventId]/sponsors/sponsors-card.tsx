import Link from "next/link";
import { Card } from "@/components/ui";
import { brand } from "@/lib/brand";
import type { EventSponsors } from "@/lib/sponsors-data";
import { plural, showLine } from "./words";

const BTN_OUTLINE = "inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";

/** Whether the event page has a Sponsors card (and quick link): the add-on on, or off with sponsors kept. */
export const hasSponsorsCard = (s: EventSponsors | null): s is EventSponsors => Boolean(s?.kindAllowed && (s.enabled || s.sponsors.length > 0));

/** The add-on is off and sponsors are kept: one line, with the address as text (L10). */
export function SponsorsOffLine({ count }: { count: number }) {
  return (
    <p className="text-sm leading-6">
      <span className="font-semibold">Sponsors are off for your account, so none show on your public page.</span>{" "}
      <span className="text-muted">
        Your {plural(count, "sponsor")} {count === 1 ? "is" : "are"} kept and come back if it&apos;s turned on again. To ask about it, email {brand.supportEmail}
      </span>
    </p>
  );
}

/**
 * The event page's Sponsors card (band contests, festivals, and fairs, board 2 with the light check's fixes): one
 * summary line and one line of levels, no stat tiles, and an outline button (the page's main button is elsewhere).
 */
export function SponsorsCardBody({ eventId, s, published }: { eventId: string; s: EventSponsors; published: boolean }) {
  const href = `/dashboard/events/${eventId}/sponsors`;
  if (!s.enabled) return <SponsorsOffLine count={s.sponsors.length} />;
  if (s.sponsors.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:shrink-0">
        <p className="text-sm leading-6">
          <span className="font-semibold">No sponsors yet.</span> <span className="text-muted">Nothing shows on your public page until you add one.</span>
        </p>
        <Link href={href} className={BTN_OUTLINE}>
          Add a sponsor
        </Link>
      </div>
    );
  }
  const presents = s.presentedBy;
  const byLevel = s.levels.map((l) => `${l.name} ${s.sponsors.filter((x) => x.levelId === l.id).length}`);
  return (
    <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:shrink-0">
      <div className="min-w-0 space-y-1 text-sm leading-6">
        <p>
          <span className="font-medium">
            {published ? `${showLine(s.showing, s.hidden)} on the public page` : `${plural(s.showing, "sponsor")} set to show when you publish${s.hidden ? `, ${s.hidden} hidden` : ""}`}
          </span>
          {presents && (
            <span className="text-muted">
              {" "}
              · Presented by {presents.name}
              {presents.showPublic ? "" : " (hidden, so the line doesn't show)"}
            </span>
          )}
        </p>
        {byLevel.length > 0 && <p className="text-muted">{byLevel.join(" · ")}</p>}
      </div>
      <Link href={href} className={BTN_OUTLINE}>
        Manage sponsors
      </Link>
    </div>
  );
}

/** The card with its heading, for the band contest and fair pages (a section anyone can jump to). */
export function SponsorsSection({ eventId, s, published, card = true }: { eventId: string; s: EventSponsors; published: boolean; card?: boolean }) {
  const body = <SponsorsCardBody eventId={eventId} s={s} published={published} />;
  return (
    <section id="sponsors" className="mt-10 scroll-mt-6" aria-labelledby="sponsors-heading">
      <h2 id="sponsors-heading" className="text-xl font-semibold">
        Sponsors
      </h2>
      <div className="mt-4">{card ? <Card>{body}</Card> : body}</div>
    </section>
  );
}

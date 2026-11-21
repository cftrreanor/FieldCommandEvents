"use client";

import Link from "next/link";
import { createContext, use } from "react";
import { brand } from "@/lib/brand";
import { dayWords, kindWords, needWords, pickMoreWays, shiftWhen, shortDay, signupHref, siteOf, spotWords, type OrgHelp, type OrgListingEvent } from "@/lib/org-page";

/** Full: every shift here is taken. Closed: sign-up here is closed. Open: anything else (the block sits below). */
export type MoreMode = "open" | "full" | "closed";

/**
 * What the sign-up form tells the block below it: once someone has signed up, the heading becomes "More from [Org]",
 * suggestions at the same time as the shifts just booked drop out, and the carry-over line shows only for an adult.
 */
export const SignedUpContext = createContext<{ confirmed: boolean; booked: { startsAt: string; endsAt: string }[]; carries: boolean }>({
  confirmed: false,
  booked: [],
  carries: false,
});

const BTN_OUTLINE =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";
const LINK = "font-semibold text-brand underline underline-offset-4";

export function MoreWaysBlock({
  mode,
  org,
  events,
  help,
  spots,
  carries,
}: {
  mode: MoreMode;
  org: { name: string; slug: string };
  events: OrgListingEvent[];
  help: OrgHelp[];
  /** Open spots on each suggested shift. */
  spots: Record<string, number>;
  /** This device remembers an adult's details, so they carry over to another sign-up. */
  carries: boolean;
}) {
  const signedUp = use(SignedUpContext);
  const after = mode === "open" && signedUp.confirmed;
  const ways = pickMoreWays(events, help, { hereIsFull: mode !== "open", booked: signedUp.booked });
  if (!ways.length) return null;
  const top = mode !== "open";
  const kicker = mode === "full" ? "This one's full" : mode === "closed" ? "Sign-up is closed" : after ? null : "Can't make this one?";
  const anyEvent = ways.some((w) => w.type === "event");
  const carryLine = after ? (signedUp.carries ? " Your details carry over from this sign-up." : "") : carries ? " Your details carry over from this device." : "";
  return (
    <section id="more" aria-labelledby="more-title" className={`scroll-mt-6 ${top ? "mt-8" : "mt-12 border-t border-border pt-8"}`}>
      {kicker && <p className="text-sm font-medium text-muted">{kicker}</p>}
      <h2 id="more-title" className="text-xl font-semibold [overflow-wrap:anywhere]">
        {after ? `More from ${org.name}` : `More ways to help from ${org.name}`}
      </h2>
      {anyEvent && (
        <p className="mt-1 text-sm text-muted">
          {after ? "The soonest open spots." : "The soonest open spots at their other events."}
          {carryLine}
        </p>
      )}
      <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
        {ways.map((w) =>
          w.type === "event" ? (
            <EventWay key={w.event.slug} e={w.event} spots={spots} />
          ) : (
            <HelpWay key={w.help.id} h={w.help} />
          ),
        )}
      </ul>
      {ways.some((w) => w.type === "help" && w.help.link) && (
        <p className="mt-2 text-sm text-muted">Links open other websites. {brand.name} never handles money or donations.</p>
      )}
      <p className="mt-3">
        <Link href={`/o/${org.slug}`} className={`${LINK} inline-flex min-h-11 items-center [overflow-wrap:anywhere]`}>
          See everything from {org.name}
        </Link>
      </p>
    </section>
  );
}

function EventWay({ e, spots }: { e: OrgListingEvent; spots: Record<string, number> }) {
  const k = kindWords(e);
  const s = e.soonest_shift;
  const left = s ? spots[s.id] : undefined;
  const day = s ? s.starts_at : null;
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-semibold [overflow-wrap:anywhere]">
          {e.name}
          <span className="font-normal">: {s ? s.job : "Things to bring"}</span>
        </p>
        <p className="text-sm text-muted">{s ? shiftWhen(s, e.timezone) : dayWords(e.starts_on)}</p>
        <p className="text-sm font-medium">{s ? spotWords(left ?? e.open_spots) : needWords(e)}</p>
      </div>
      <Link href={`${signupHref(e.slug, "more", s?.id)}${s ? "" : "#pick"}`} className={`${BTN_OUTLINE} self-start sm:self-center`}>
        {k.button}
        <span className="sr-only">
          {" "}
          for {e.name}, {s ? `${s.job}, ` : ""}
          {day ? shiftWhen(s!, e.timezone) : shortDay(e.starts_on)}
        </span>
      </Link>
    </li>
  );
}

function HelpWay({ h }: { h: OrgHelp }) {
  const site = h.link ? siteOf(h.link) : null;
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-semibold [overflow-wrap:anywhere]">
          {h.title}
          <span className="font-normal">: Help anytime</span>
        </p>
        {h.note && <p className="text-sm [overflow-wrap:anywhere]">{h.note}</p>}
        <p className="text-sm text-muted">Until {dayWords(h.ends_on)}</p>
      </div>
      {h.link && site && (
        <a href={h.link} target="_blank" rel="noopener noreferrer" className={`${BTN_OUTLINE} self-start sm:self-center`}>
          Open on {site}
          <span className="sr-only"> for {h.title}, in a new tab</span>
        </a>
      )}
    </li>
  );
}

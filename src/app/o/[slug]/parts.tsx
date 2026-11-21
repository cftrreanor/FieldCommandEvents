import Link from "next/link";
import { IconTile, LineIcon } from "@/components/line-icon";
import { Badge, Card } from "@/components/ui";
import { PublicFooter } from "@/components/public-footer";
import { brand } from "@/lib/brand";
import {
  OPEN_MONTHS,
  byMonth,
  dayNum,
  dayWords,
  isItemsOnly,
  isToday,
  kindWords,
  monthShort,
  needWords,
  plural,
  shortDay,
  shownOn,
  signupHref,
  siteOf,
  whenWords,
  type OrgHelp,
  type OrgListingEvent,
} from "@/lib/org-page";

export const BTN_OUTLINE =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";
export const LINK = "font-semibold text-brand underline underline-offset-4";
const CHIP = "inline-flex min-h-11 items-center rounded-full border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";

/**
 * What the page knows about each event's shifts beyond the listing: when they run, the one open shift if only one is
 * left (never one already under way), and whether this device holds one of its shifts.
 */
export type ShiftFacts = { range: { start: string; end: string } | null; onlyOpenShift: string | null; held?: boolean };

/**
 * A button on the page, or, in the organizer's preview, the same button that goes nowhere (inert: it looks the same
 * and reads the same, but isn't a link).
 */
function PageLink({ href, inert, className, external, children }: { href: string; inert?: boolean; className: string; external?: boolean; children: React.ReactNode }) {
  if (inert) return <span className={`${className} cursor-default`}>{children}</span>;
  if (external)
    return (
      <a href={href} target="_blank" rel="nofollow noopener noreferrer" className={className}>
        {children}
      </a>
    );
  return (
    <Link href={href} rel="nofollow" className={className}>
      {children}
    </Link>
  );
}

/** The group's logo on its white tile (readable in dark mode), never stretched. */
export function LogoTile({ src, name }: { src: string; name: string }) {
  return (
    <span className="inline-flex h-16 max-w-full shrink-0 items-center self-start rounded-md bg-white px-2 py-1 sm:h-20 sm:self-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`${name} logo`} className="max-h-full w-auto max-w-[14rem] object-contain" />
    </span>
  );
}

export function OrgHeading({ name, logo, band }: { name: string; logo: string | null; band: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
      {logo && <LogoTile src={logo} name={name} />}
      <div className="min-w-0">
        <h1 className="text-4xl font-medium tracking-tight [overflow-wrap:anywhere] sm:text-5xl">{name}</h1>
        <p className={`mt-2 ${band ? "" : "text-muted"}`}>Events and ways to help from {name}</p>
      </div>
    </div>
  );
}

function DateTile({ iso }: { iso: string }) {
  return (
    <span aria-hidden className="flex w-14 shrink-0 flex-col items-center self-start rounded-md border border-border bg-background py-1.5 leading-none">
      <span className="text-xs font-semibold uppercase">{monthShort(iso)}</span>
      <span className="mt-1 text-2xl font-medium tabular-nums">{dayNum(iso)}</span>
    </span>
  );
}

function EventRow({ e, facts, level, inert }: { e: OrgListingEvent; facts?: ShiftFacts; level: 3 | 4; inert?: boolean }) {
  const k = kindWords(e);
  const today = isToday(e);
  const Heading = level === 3 ? "h3" : "h4";
  // Under way, with nothing still to start: said in words, with no sign-up button (built-page review).
  const nowOnly = Boolean(e.happening_now) && !e.soonest_shift && !e.opens_on && e.items_needed === 0;
  const on = shownOn(e);
  const when = whenWords(e, facts?.range ?? null);
  const href = e.opens_on
    ? signupHref(e.slug, "org")
    : `${signupHref(e.slug, "org", facts?.onlyOpenShift)}${isItemsOnly(e) ? "#pick" : ""}`;
  return (
    <li className="flex gap-3 px-4 py-4 sm:gap-4">
      <DateTile iso={on} />
      <div className="min-w-0 flex-1">
        {(today || e.happening_now) && (
          <p className="mb-1">
            <Badge tone="info">{e.happening_now && !nowOnly ? "Happening now" : "Today"}</Badge>
          </p>
        )}
        <Heading className="text-lg leading-6 font-semibold [overflow-wrap:anywhere]">{e.name}</Heading>
        <p className="mt-1 flex items-center gap-1.5 text-sm">
          <LineIcon name={k.icon} className="size-4" />
          {k.word}
        </p>
        {when && <p className="mt-1 text-sm">{when}</p>}
        {e.venue_name && <p className="text-sm text-muted [overflow-wrap:anywhere]">{e.venue_name}</p>}
        {nowOnly ? (
          // In place of the sign-up button: its shifts are under way, and none is left to start.
          <p className="mt-2 text-sm font-semibold">Happening now</p>
        ) : (
          <p className="mt-2 text-sm font-semibold">{e.opens_on ? `Volunteer sign-up opens ${dayWords(e.opens_on)}` : needWords(e)}</p>
        )}
        {facts?.held && (
          <p className="mt-2 text-sm">
            <span aria-hidden className="text-success">
              ✓{" "}
            </span>
            <span className="font-semibold">You&apos;re signed up</span> ·{" "}
            <PageLink href="/my" inert={inert} className={`${LINK} inline-flex min-h-11 items-center`}>
              See your shift<span className="sr-only"> at {e.name}</span>
            </PageLink>
          </p>
        )}
        {!nowOnly && (
          <PageLink href={href} inert={inert} className={`${BTN_OUTLINE} ${facts?.held ? "mt-1" : "mt-3"}`}>
            {e.opens_on ? "See the event" : k.button}
            <span className="sr-only">
              {" "}
              for {e.name}, {shortDay(on)}
            </span>
          </PageLink>
        )}
      </div>
    </li>
  );
}

function HelpRow({ h, inert }: { h: OrgHelp; inert?: boolean }) {
  const site = h.link ? siteOf(h.link) : null;
  return (
    <li className="flex gap-3 px-4 py-4 sm:gap-4">
      <IconTile name="sparkle" size="sm" />
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold [overflow-wrap:anywhere]">{h.title}</h3>
        {h.note && <p className="mt-1 text-sm leading-6 [overflow-wrap:anywhere]">{h.note}</p>}
        <p className="mt-1 text-sm text-muted">Until {dayWords(h.ends_on)}</p>
        {h.link && site && (
          <p className="mt-2">
            <PageLink href={h.link} inert={inert} external className={BTN_OUTLINE}>
              Open on {site}
              <span className="sr-only"> for {h.title}, in a new tab</span>
            </PageLink>
          </p>
        )}
      </div>
    </li>
  );
}

const Chevron = () => (
  <svg aria-hidden viewBox="0 0 20 20" className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Contact({ email, inert }: { email: string | null; inert?: boolean }) {
  if (!email) return null;
  return (
    <>
      Questions? Email{" "}
      {inert ? (
        <span className={`${LINK} [overflow-wrap:anywhere]`}>{email}</span>
      ) : (
        <a href={`mailto:${email}`} className={`${LINK} [overflow-wrap:anywhere]`}>
          {email}
        </a>
      )}
    </>
  );
}

/**
 * The page's body: Coming up by month first, then Help anytime, then the contact. Two chips at the top jump to each.
 * Only months with events show; the first two are open and later ones are folded rows that open when tapped
 * (owner, 2026-11-21). `allFull`: the page has events, but every spot is full right now. `inert`: the organizer's
 * preview, built from these same parts, with buttons that go nowhere.
 */
export function OrgBody({
  name,
  contact,
  events,
  help,
  facts,
  allFull,
  inert = false,
}: {
  name: string;
  contact: string | null;
  events: OrgListingEvent[];
  help: OrgHelp[];
  facts: Map<string, ShiftFacts>;
  allFull: boolean;
  inert?: boolean;
}) {
  if (!events.length && !help.length && !allFull) {
    return (
      <Card className="mt-8">
        <h2 className="text-xl font-semibold">Nothing&apos;s coming up right now</h2>
        <p className="mt-2 leading-7">When {name} adds an event or a way to help, it shows here.</p>
        {contact && (
          <p className="mt-2 leading-7">
            <Contact email={contact} inert={inert} />
          </p>
        )}
      </Card>
    );
  }
  const months = byMonth(events);
  const open = months.slice(0, OPEN_MONTHS);
  const folded = months.slice(OPEN_MONTHS);
  return (
    <div className="mt-8 space-y-10">
      {events.length > 0 && help.length > 0 && (
        <nav aria-label="On this page" className="flex flex-wrap gap-2">
          {inert ? (
            <>
              <span className={CHIP}>Coming up · {events.length}</span>
              <span className={CHIP}>Help anytime · {help.length}</span>
            </>
          ) : (
            <>
              <a href="#coming" className={CHIP}>
                Coming up · {events.length}
              </a>
              <a href="#help" className={CHIP}>
                Help anytime · {help.length}
              </a>
            </>
          )}
        </nav>
      )}
      {allFull && (
        <Card>
          <h2 className="text-xl font-semibold">Every spot is full right now</h2>
          <p className="mt-2 leading-7">When a spot opens or {name} adds an event, it shows here.</p>
        </Card>
      )}
      {events.length > 0 && (
        <section id="coming" aria-labelledby="coming-title" className="scroll-mt-6">
          <h2 id="coming-title" className="text-2xl font-semibold">
            Coming up
          </h2>
          {events.length === 1 ? (
            <ul className="mt-4 rounded-lg border border-border bg-surface">
              {/* No month heading over a single event, so its name is the next level down from Coming up. */}
              <EventRow e={events[0]} facts={facts.get(events[0].slug)} level={3} inert={inert} />
            </ul>
          ) : (
            <>
              {open.map((m) => (
                <div key={m.key} className="mt-5">
                  <h3 className="text-lg font-semibold">{m.label}</h3>
                  <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
                    {m.events.map((e) => (
                      <EventRow key={e.slug} e={e} facts={facts.get(e.slug)} level={4} inert={inert} />
                    ))}
                  </ul>
                </div>
              ))}
              {folded.length > 0 && (
                <ul className="mt-5 divide-y divide-border rounded-lg border border-border bg-surface">
                  {folded.map((m) => (
                    <li key={m.key}>
                      <details className="group">
                        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                          {/* The month is a heading here too, so the events under it never skip a level. */}
                          <h3 className="min-w-0 flex-1 text-base">
                            <span className="font-semibold">{m.label}</span>
                            <span className="font-normal text-muted"> · {plural(m.events.length, "event", "events")}</span>
                          </h3>
                          <Chevron />
                        </summary>
                        <ul className="divide-y divide-border border-t border-border">
                          {m.events.map((e) => (
                            <EventRow key={e.slug} e={e} facts={facts.get(e.slug)} level={4} inert={inert} />
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
      {help.length > 0 && (
        <section id="help" aria-labelledby="help-title" className="scroll-mt-6">
          <h2 id="help-title" className="text-2xl font-semibold">
            Help anytime
          </h2>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {help.map((h) => (
              <HelpRow key={h.id} h={h} inert={inert} />
            ))}
          </ul>
          {help.some((h) => h.link) && <p className="mt-2 text-sm text-muted">Links open other websites. {brand.name} never handles money or donations.</p>}
        </section>
      )}
      {contact && (
        <p className="text-sm leading-6 text-muted">
          <Contact email={contact} inert={inert} />
        </p>
      )}
    </div>
  );
}

/** The organization page's footer: the same one line as every public event page. */
export function OrgFooter() {
  return <PublicFooter />;
}

import "server-only";
import { emailLayout } from "@/lib/email";
import { formatDate, formatDateRange } from "@/lib/time";

// Emails about the team changing: someone left an event (to its Account Host and Volunteer
// Leads), and someone was removed (to that person, when the remover ticks "Let them know").
// Design review 2026-11-05, finding 3.

const ROLE = { volunteer_director: "Volunteer Lead", section_lead: "Coordinator", co_host: "co-host" } as const;
type Role = keyof typeof ROLE;

/** "Tasha Brooks left Lone Star Marching Invitational": what's now without anyone, and where to fix it. */
export function leftEventEmail(o: {
  who: string;
  role: Exclude<Role, "co_host">;
  event: { name: string; starts_on: string; ends_on: string };
  /** The jobs they led there. */
  jobs: string[];
  /** The event was left with no Volunteer Lead. */
  noLead: boolean;
  setupUrl: string;
  /** Who removed them, when they didn't leave on their own. */
  removedBy?: string | null;
}) {
  const when = formatDateRange(o.event.starts_on, o.event.ends_on);
  const gaps = [
    ...o.jobs.map((job) => `${job} needs a new Coordinator.`),
    ...(o.noLead ? [`${o.event.name} has no Volunteer Lead now, so the Account Host and co-hosts run its volunteers.`] : []),
  ];
  return {
    subject: o.removedBy ? `${o.removedBy} removed ${o.who} from ${o.event.name}` : `${o.who} left ${o.event.name}`,
    ...emailLayout({
      heading: o.removedBy ? `${o.removedBy} removed ${o.who} from ${o.event.name}` : `${o.who} left ${o.event.name}`,
      paragraphs: [
        `${o.who} is no longer the ${ROLE[o.role]}${o.jobs.length ? ` for ${o.jobs.join(", ")}` : ""} at ${o.event.name} (${when}).`,
        ...gaps,
        "You can invite someone from the event's team setup.",
      ],
      button: { label: "Open team setup", url: o.setupUrl },
      footer: "You're getting this because you're the Account Host or a Volunteer Lead for this event.",
    }),
  };
}

/**
 * To someone who was removed, when the person removing them chose to let them know. Says what
 * they're no longer, and what they still are, so a partial removal never reads as "off the team".
 */
export function removedEmail(o: {
  remover: string;
  /** The account's name, if known. */
  organization: string | null;
  /** "Coordinator of Lone Star Marching Invitational", or "co-host". */
  roles: string[];
  /** Roles they still have on the account's events. */
  keeps: string[];
  /** Who to ask about it. */
  contact: string;
}) {
  const coHost = o.roles.length === 1 && o.roles[0] === "co-host";
  const what = coHost ? `a co-host${o.organization ? ` for ${o.organization}` : ""}` : o.roles.join(" and ");
  const title = `You're no longer ${what}`;
  return {
    subject: title,
    ...emailLayout({
      heading: title,
      paragraphs: [
        `${o.remover} removed you as ${what}.`,
        ...(o.keeps.length ? [`You're still ${o.keeps.join(" and ")}.`] : []),
        `Questions? Contact ${o.remover} at ${o.contact}.`,
      ],
      footer: "Your own account and any volunteer sign-ups you made stay as they are.",
    }),
  };
}

/**
 * To a co-host offered the Account Host role: what changes, that it's one-way, and the link to
 * accept or decline. Design review 2026-11-07, finding 1.
 */
export function hostOfferEmail(o: { from: string; organization: string; url: string; /** "2026-11-21", the account's time zone. */ lastDay: string }) {
  return {
    subject: `${o.from} offered you the Account Host role for ${o.organization}`,
    ...emailLayout({
      heading: `${o.from} offered you the Account Host role for ${o.organization}`,
      paragraphs: [
        `${o.from} would like you to take over as the Account Host for ${o.organization}.`,
        "As the Account Host, you invite and remove co-hosts, you get and renew the plan, and you can hand the role on later. Your access to events stays the same.",
        "The plan stays as it is until it ends. After that, renewing it is up to you.",
        `${o.from} becomes a co-host, with the same access to every event as now. Once you accept, they can't take the role back: only you could offer it to them again.`,
        "Nothing changes until you accept.",
      ],
      button: { label: "Accept or decline", url: o.url },
      footer: `This offer is open through ${formatDate(o.lastDay)}. It's only for you, so please don't forward it. If you weren't expecting it, you can ignore this email.`,
    }),
  };
}

/** To a co-host whose offer was withdrawn, or replaced by an offer to someone else. */
export function hostOfferEndedEmail(o: { from: string; organization: string; reason: "withdrawn" | "replaced" }) {
  const title = `${o.from} withdrew the Account Host offer`;
  return {
    subject: title,
    ...emailLayout({
      heading: title,
      paragraphs: [
        o.reason === "replaced"
          ? `${o.from} offered the Account Host role for ${o.organization} to someone else, so the link we sent you no longer works.`
          : `${o.from} withdrew their offer of the Account Host role for ${o.organization}, so the link we sent you no longer works.`,
        "You're still a co-host, with the same access as before.",
      ],
    }),
  };
}

/** To the Account Host, when the co-host answers their offer. */
export function hostOfferAnsweredEmail(o: { who: string; organization: string; accepted: boolean; url: string }) {
  return o.accepted
    ? {
        subject: `${o.who} is now the Account Host for ${o.organization}`,
        ...emailLayout({
          heading: `${o.who} is now the Account Host`,
          paragraphs: [
            `${o.who} accepted your offer. They're the Account Host for ${o.organization} now, and you're a co-host, with the same access to every event as before.`,
            `Only ${o.who} can invite or remove co-hosts, or get and renew the plan, from now on.`,
          ],
          button: { label: "Open My team", url: o.url },
        }),
      }
    : {
        subject: `${o.who} declined the Account Host role`,
        ...emailLayout({
          heading: `${o.who} declined the Account Host role`,
          paragraphs: [`You're still the Account Host for ${o.organization}. You can offer the role to a co-host again any time.`],
          button: { label: "Open My team", url: o.url },
        }),
      };
}

/** Undoing a removal: to the person (if they were told they were removed) or to those told about the gap. */
export function undoneEmail(o: { who: string; remover: string; roles: string[]; toPerson: boolean }) {
  const what = o.roles.length < 3 ? o.roles.join(" and ") : `${o.roles.slice(0, -1).join(", ")}, and ${o.roles[o.roles.length - 1]}`;
  return o.toPerson
    ? {
        subject: `You're still ${what}`,
        ...emailLayout({
          heading: `You're still ${what}`,
          paragraphs: [`${o.remover} put you back a few minutes after removing you, so you can ignore the earlier email. You're still ${what}, with your jobs.`],
        }),
      }
    : {
        subject: `${o.who} is back as ${what}`,
        ...emailLayout({
          heading: `${o.who} is back as ${what}`,
          paragraphs: [`${o.remover} put ${o.who} back a few minutes after removing them, so you can ignore the earlier email. Their jobs are as they were.`],
        }),
      };
}

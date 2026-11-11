import "server-only";
import { EMAIL_LINK_DAYS } from "@/lib/email-link-age";
import { brand } from "@/lib/brand";
import { emailLayout } from "@/lib/email";
import { CO_HOST_INVITE } from "@/lib/team-words";
import { customWords } from "@/lib/system-email-overrides";
import type { SystemEmailText } from "@/lib/system-emails";
import { formatDate, formatDateRange } from "@/lib/time";

/** What prepare_invitation_email() returns. */
export type InvitationDetails = {
  email: string;
  role: "volunteer_director" | "section_lead" | "co_host" | null;
  as_host: boolean;
  token: string;
  expires_at: string;
  /** Empty for a co-host invitation to the whole account. */
  event_name: string | null;
  starts_on: string | null;
  ends_on: string | null;
  venue_name: string | null;
  organization: string;
  station_name: string | null;
  inviter_name: string | null;
};

/** A different email for co-hosts, Volunteer Leads and Coordinators, with a one-tap accept link. */
/** `bands`: the event is a band contest (a volunteer event has no bands). */
/** `leadTitle`: what the person leading a sign-up is called. */
/** `saved`: an admin's wording for this kind of invitation (invitationEmailKey), if any. */
export function invitationEmail(inv: InvitationDetails, acceptUrl: string, bands = true, leadTitle = "Coordinator", saved: SystemEmailText | null = null) {
  const who = inv.inviter_name ? `${inv.inviter_name} from ${inv.organization}` : inv.organization;
  const when =
    inv.starts_on && inv.ends_on ? `${formatDateRange(inv.starts_on, inv.ends_on)}${inv.venue_name ? ` at ${inv.venue_name}` : ""}` : "";
  // A co-host invitation from My team is for the whole account, not one event.
  const eventName = inv.event_name ?? `${inv.organization}'s events`;
  const station = inv.station_name ?? "a sign-up";

  const { subject, heading, paragraphs } = inv.role === "co_host"
    ? {
        subject: `You're invited to co-host ${inv.event_name} on ${brand.name}`,
        heading: `Co-host ${inv.event_name}`,
        paragraphs: [
          `${who} invited you to co-host ${inv.event_name} (${when}) on ${brand.name}.`,
          `As a co-host, you'll help run this event: setup, publishing, sign-ups, volunteers, and the event day. You can do everything ${inv.inviter_name ?? "the organizer"} can on it, except invite or remove co-hosts, or delete it. You won't see other events from ${inv.organization}, and your access ends 10 days after the event.`,
        ],
      }
    : inv.as_host
    ? {
        subject: `You're invited to co-host ${inv.organization} on ${brand.name}`,
        heading: `Co-host events for ${inv.organization}`,
        paragraphs: [
          inv.event_name
            ? `${who} invited you to co-host their events on ${brand.name}, starting with ${inv.event_name} (${when}).`
            : `${who} invited you to co-host their events on ${brand.name}.`,
          CO_HOST_INVITE,
        ],
      }
    : inv.role === "volunteer_director"
      ? {
          subject: `Help run volunteers for ${inv.event_name}`,
          heading: "You're invited to be a Volunteer Lead",
          paragraphs: [
            `${who} invited you to help run volunteers for ${inv.event_name} (${when}).`,
            `As a Volunteer Lead you'll set up sign-ups and shifts, see who's signed up, check people in, and help run ${bands ? "contest day" : "the event day"}.`,
          ],
        }
      : {
          subject: `Lead ${station} at ${inv.event_name}`,
          heading: `You're invited to be a ${leadTitle}`,
          paragraphs: [
            `${who} asked you to lead ${station} at ${inv.event_name} (${when}).`,
            bands
              ? "You'll see who's on your sign-up's shifts and check bands in on contest day. Volunteers' phone numbers unlock on the day."
              : "You'll see who's on your sign-up's shifts, and their phone numbers unlock on the day of the event.",
          ],
        };
  // An account co-host invitation has no event: saved wording that names one would read
  // "starting with … ()", so it falls back to the built-in email.
  const usable = inv.event_name || !saved || !/\{\{\s*event_(name|when)\s*\}\}/.test(`${saved.subject} ${saved.heading} ${saved.body}`);
  const custom = customWords(invitationEmailKey(inv), usable ? saved : null, {
    inviter: who,
    organization: inv.organization,
    event_name: eventName,
    event_when: when,
    event_day: bands ? "contest day" : "the event day",
    access: !inv.event_name
      ? "setting up and publishing events, sign-ups, volunteers, and the event day"
      : bands
        ? "bands, the schedule, volunteers, the team, and contest day"
        : "sign-ups, shifts, volunteers, the team, and the event day",
    station,
    lead_title: leadTitle,
  });

  return {
    subject: custom?.subject || subject,
    ...emailLayout({
      heading: custom?.heading || heading,
      paragraphs: [
        ...(custom?.paragraphs ?? paragraphs),
        `Tap the button to accept. There's no password: it signs you in as ${inv.email}, and sets up your account if you don't have one yet.`,
      ],
      button: { label: custom?.button || "Accept invitation", url: acceptUrl },
      footer: `This invitation is for ${inv.email} and works until ${formatDate(inv.expires_at.slice(0, 10))}. The button signs you in for the first ${EMAIL_LINK_DAYS} days; after that, sign in with this email to accept. Please don't forward it. If you weren't expecting it, you can ignore this email.`,
    }),
  };
}

/** Which system email (src/lib/system-emails.ts) an invitation is. */
export const invitationEmailKey = (inv: Pick<InvitationDetails, "as_host" | "role">) =>
  inv.as_host
    ? "team_invite_cohost"
    : inv.role === "co_host"
      ? "team_invite_event_cohost"
      : inv.role === "volunteer_director"
        ? "team_invite_volunteer_lead"
        : "team_invite_section_lead";

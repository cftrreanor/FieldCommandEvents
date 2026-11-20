import { brand } from "./brand";

/** What every form Server Action returns, for <ActionForm> to display. */
export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Per-field problems, keyed by the input's name, shown under each field. */
  fieldErrors?: Record<string, string>;
  /** Open this page next, keeping the scroll position (e.g. a new tab right where the form was). */
  goTo?: string;
  /** Something just went public: show its link to share (in place of the toast). */
  share?: Share;
  /** A way to fix an error, shown as a link after it ("Go to Team setup"). */
  link?: { href: string; label: string };
};

/** A link a host can share right away (shareLink in src/lib/share.ts adds the QR code). */
export type Share = {
  /** What just happened ("Volunteer sign-up is open"). */
  title: string;
  /** Who it's for and what to do with it. */
  note?: string;
  url: string;
  /** A QR code for the link, as a PNG data URL. */
  qr?: string;
  /** The QR code's file name when it's downloaded. */
  qrName?: string;
};

/** An error state for one or more fields: the summary names the problem, or how many there are. */
export function fieldErrorState(fieldErrors: Record<string, string>): ActionState {
  const messages = Object.values(fieldErrors);
  return {
    error: messages.length === 1 ? messages[0] : `Please fix the ${messages.length} answers marked below.`,
    fieldErrors,
  };
}

/** Turn a database error into something a booster president can act on. */
export function friendlyDbError(error: { code?: string; message: string }): string {
  switch (error.code) {
    // The code is newer than the database (see lib/schema-check).
    case "42703":
    case "42883":
    case "42P01":
    case "PGRST202":
    case "PGRST204":
    case "PGRST205":
      return "A database update needs to be run before this can be saved. See \u201cApplying database updates\u201d in the setup guide.";
    case "42501":
      // Plan limits (20261223000000_packages.sql) say what's included and how to get more.
      return error.message.startsWith("Your ") ? withContact(error.message) : "You don't have permission to do that.";
    case "23505":
      return "That already exists. Try a different name.";
    case "23514":
    case "P0001":
    case "P0002":
    case "P0003":
    case "P0005":
      // Our own check messages are written for people; pass them through.
      if (error.message.includes("violates check constraint")) return "Some of the values aren't valid. Please check the form.";
      return error.message.startsWith("Your ") ? withContact(error.message) : error.message;
    default:
      console.error("Database error", error);
      return "Something went wrong saving that. Please try again.";
  }
}

/** A plan limit's message, with how to reach us to upgrade or add a pass. */
function withContact(message: string) {
  return message.includes("Write to us") ? message : `${message} Write to us at ${brand.supportEmail} to upgrade or add a pass.`;
}

// Merge fields for emails written in the admin dashboard: {{first_name}} and
// friends are filled in for each recipient. Shared by the composer (preview)
// and the server (sending).

export const MERGE_FIELDS = [
  { key: "first_name", label: "First name" },
  { key: "name", label: "Full name" },
  { key: "organization", label: "Organization" },
  { key: "plan", label: "Plan" },
  { key: "free_until", label: "Free through" },
  { key: "next_event", label: "Next event" },
  { key: "next_event_url", label: "Next event link" },
  { key: "my_name", label: "Your name" },
  { key: "login_url", label: "Sign-in link" },
  { key: "dashboard_url", label: "Dashboard link" },
  { key: "new_event_url", label: "New event link" },
  { key: "account_url", label: "Account link" },
  { key: "site_url", label: "Website link" },
] as const;

/** Where "Book a call with us" goes: a Meetings booking page on our own account. */
export const BOOK_CALL_URL = "https://www.fieldcommandevents.com/e/meet-with-field-command-events-69co";

/**
 * Ready-made buttons (the toolbar's "Quick button" menu), in groups. Pages
 * that need a sign-in use a link field, so they land there after signing in;
 * public pages are the website link plus the page (paths from lib/audiences.ts).
 */
export const QUICK_BUTTONS = [
  { group: "Their account", label: "Sign-in button", markup: "[[Sign in|{{login_url}}]]" },
  { group: "Their account", label: "Dashboard button", markup: "[[Open my dashboard|{{dashboard_url}}]]" },
  { group: "Their account", label: "Create your first event", markup: "[[Create your first event|{{new_event_url}}]]" },
  { group: "Their account", label: "Your account and plan", markup: "[[See your plan|{{account_url}}]]" },
  { group: "Their account", label: "Their next event", markup: "[[Open your event|{{next_event_url}}]]" },
  { group: "Our site", label: "Website button", markup: "[[Visit our website|{{site_url}}]]" },
  { group: "Our site", label: "Student data privacy", markup: "[[How we protect student data|{{site_url}}/student-data-privacy]]" },
  { group: "Our site", label: "Book a call with us", markup: `[[Book a call with us|${BOOK_CALL_URL}]]` },
  { group: "Event pages", label: "Band contests", markup: "[[See how it works for band contests|{{site_url}}/band-contests]]" },
  { group: "Event pages", label: "Choir and group festivals", markup: "[[See how it works for group festivals|{{site_url}}/choir-festivals]]" },
  { group: "Event pages", label: "School fairs and fundraisers", markup: "[[See how it works for school fairs|{{site_url}}/school-fairs]]" },
  { group: "Event pages", label: "Volunteers and sign-ups", markup: "[[See how it works for volunteers and sign-ups|{{site_url}}/volunteer-events]]" },
  { group: "Event pages", label: "Parent and visitor check-in", markup: "[[See how it works for visitor check-in|{{site_url}}/parent-check-in]]" },
  { group: "Event pages", label: "Parent-teacher conferences", markup: "[[See how it works for conferences|{{site_url}}/parent-teacher-conferences]]" },
  { group: "Event pages", label: "Meetings", markup: "[[See how it works for meetings|{{site_url}}/meetings]]" },
  { group: "Event pages", label: "For school administrators", markup: "[[See what administrators get|{{site_url}}/school-administrators]]" },
] as const;

/**
 * The link fields for one person on this site: sign-in links with their email
 * filled in (landing on their dashboard, a new event, or their Account page),
 * the dashboard, the home page.
 */
export function siteLinks(origin: string, email?: string): MergeVars {
  const signIn = (next: string) => `${origin}/login?${new URLSearchParams({ next, ...(email ? { email } : {}) })}`;
  return {
    login_url: signIn("/dashboard"),
    new_event_url: signIn("/dashboard/events/new"),
    account_url: signIn("/dashboard/account"),
    dashboard_url: `${origin}/dashboard`,
    site_url: origin,
  };
}

export type MergeVars = Partial<Record<(typeof MERGE_FIELDS)[number]["key"], string>>;

const FIELD = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Fill in {{fields}}. Unknown fields stay as typed; known but empty ones are listed in `blank`. */
export function fillTemplate(text: string, vars: MergeVars) {
  const blank = new Set<string>();
  const out = text.replace(FIELD, (whole, key: string) => {
    if (!MERGE_FIELDS.some((f) => f.key === key)) return whole;
    const v = vars[key as keyof MergeVars];
    if (!v) {
      blank.add(key);
      return "";
    }
    return v;
  });
  return { text: out, blank: [...blank] };
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

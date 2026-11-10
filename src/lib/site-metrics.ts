// Counting visits to the marketing pages (Admin → Site visits). Shared by the
// browser (which page, where the visitor came from) and the server (which
// saves daily counts: supabase/migrations/20261217000000_site_metrics.sql).
// Only these pages are counted, never event, student, or family pages.

export const MARKETING_PAGES = [
  { path: "/", label: "Homepage" },
  { path: "/band-contests", label: "Band contests" },
  { path: "/choir-festivals", label: "Choir festivals" },
  { path: "/school-fairs", label: "School fairs" },
  { path: "/volunteer-events", label: "Volunteers and sign-ups" },
  { path: "/parent-check-in", label: "Parent check-in" },
  { path: "/parent-teacher-conferences", label: "Parent-teacher conferences" },
  { path: "/meetings", label: "Meetings" },
  { path: "/school-administrators", label: "For administrators" },
  { path: "/student-data-privacy", label: "Student data privacy" },
] as const;

export type SiteEvent = "view" | "section" | "click" | "pilot_open" | "pilot_sent";

/** What the browser may report (the server counts pilot_sent itself, when a request is saved). */
export const BROWSER_EVENTS: readonly SiteEvent[] = ["view", "section", "click", "pilot_open"];

export const isMarketingPath = (path: string) => MARKETING_PAGES.some((p) => p.path === path);

export const pageLabel = (path: string) => MARKETING_PAGES.find((p) => p.path === path)?.label ?? path;

/** A source label, safe to store: letters, numbers, spaces and a few marks, 60 characters at most. */
export const cleanSource = (s: string) =>
  s
    .replace(/[^\w .:-]/g, "")
    .trim()
    .slice(0, 60) || "Unknown";

/** A section heading or button text, safe to store: one line, 100 characters at most. */
export const cleanLabel = (s: string) =>
  s
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

const SOCIAL: [RegExp, string][] = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, "Facebook"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/, "LinkedIn"],
  [/(^|\.)t\.co$|(^|\.)x\.com$|(^|\.)twitter\.com$/, "X (Twitter)"],
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/(^|\.)youtube\.com$/, "YouTube"],
];

/**
 * Where a visitor came from, as a short label: a campaign tag (?utm_source=),
 * a search engine, a social site, another website's name, or direct.
 */
export function sourceOf(referrer: string, search: string, ownHost: string): string {
  const utm = new URLSearchParams(search).get("utm_source");
  if (utm) return cleanSource(`Campaign: ${utm}`);
  let host: string;
  try {
    host = new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "Direct or bookmark";
  }
  if (host === ownHost.replace(/^www\./, "").toLowerCase()) return "Within the site";
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return "Google";
  if (/(^|\.)bing\.com$/.test(host)) return "Bing";
  if (/duckduckgo\.com$|(^|\.)yahoo\.com$|(^|\.)ecosia\.org$|search\.brave\.com$/.test(host)) return "Other search engine";
  for (const [pattern, label] of SOCIAL) if (pattern.test(host)) return label;
  return cleanSource(host);
}

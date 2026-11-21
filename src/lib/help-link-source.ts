/**
 * Where a volunteer sign-up came from, for the names-free daily count (help_link_signups,
 * supabase/migrations/20270210000000_org_page.sql): a "More ways to help" link on another sign-up page, the
 * organization page, or anywhere else. Read from the link's `via` value (?via=more_ways or ?via=org_page, sent on
 * with the form); anything else counts as direct. Nothing about the person is kept.
 */
export const HELP_LINK_SOURCES = ["more_ways", "org_page", "direct", "more_ways_confirm", "org_page_confirm"] as const;
export type HelpLinkSource = (typeof HELP_LINK_SOURCES)[number];
// The counts are an estimate wherever they're shown: the source is read from the link, which anyone can edit.

const ALIASES: Record<string, "more_ways" | "org_page"> = { more: "more_ways", more_ways: "more_ways", org: "org_page", org_page: "org_page" };

export function helpLinkSource(via: unknown): "more_ways" | "org_page" | "direct" {
  if (typeof via !== "string") return "direct";
  return Object.hasOwn(ALIASES, via) ? ALIASES[via] : "direct";
}

/**
 * The confirm step's own source (a shift tapped from "More ways to help" or the organization page, booked in one
 * tap), counted apart from the full form's so the numbers can be read separately.
 */
export function confirmSource(via: unknown): HelpLinkSource {
  const s = helpLinkSource(via);
  return s === "more_ways" ? "more_ways_confirm" : s === "org_page" ? "org_page_confirm" : "direct";
}

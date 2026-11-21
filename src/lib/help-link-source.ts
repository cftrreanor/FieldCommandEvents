/**
 * Where a volunteer sign-up came from, for the names-free daily count (help_link_signups,
 * supabase/migrations/20270210000000_org_page.sql): a "More ways to help" link on another sign-up page, the
 * organization page, or anywhere else. Read from the link's `via` value (?via=more_ways or ?via=org_page, sent on
 * with the form); anything else counts as direct. Nothing about the person is kept.
 */
export const HELP_LINK_SOURCES = ["more_ways", "org_page", "direct"] as const;
export type HelpLinkSource = (typeof HELP_LINK_SOURCES)[number];

const ALIASES: Record<string, HelpLinkSource> = { more: "more_ways", more_ways: "more_ways", org: "org_page", org_page: "org_page" };

export function helpLinkSource(via: unknown): HelpLinkSource {
  if (typeof via !== "string") return "direct";
  return Object.hasOwn(ALIASES, via) ? ALIASES[via] : "direct";
}

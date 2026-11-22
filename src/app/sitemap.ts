import type { MetadataRoute } from "next";
import { ADMINISTRATORS_PAGE, AUDIENCES, CONFERENCES_PAGE, MEETINGS_PAGE, STUDENT_PRIVACY_PAGE } from "@/lib/audiences";
import { pricingPageLive } from "@/lib/site-pricing";
import { SITE_URL } from "@/lib/site-url";

// The pricing page joins once the owner switches it on.
export const revalidate = 60;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const live = await pricingPageLive();
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    ...(live ? [{ url: `${SITE_URL}/pricing`, changeFrequency: "weekly" as const, priority: 0.9 }] : []),
    ...[...AUDIENCES, CONFERENCES_PAGE, MEETINGS_PAGE, ADMINISTRATORS_PAGE, STUDENT_PRIVACY_PAGE].map((a) => ({ url: `${SITE_URL}${a.path}`, changeFrequency: "monthly" as const, priority: 0.8 })),
  ];
}

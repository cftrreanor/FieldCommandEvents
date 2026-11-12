import type { MetadataRoute } from "next";
import { isQa } from "@/lib/qa";
import { SITE_URL } from "@/lib/site-url";

// Search engines read the homepage, the event-type pages and public event pages; everything behind
// a sign-in, plus private links (passes, files, invitations), stays out.
export default function robots(): MetadataRoute.Robots {
  // The QA site (src/lib/qa.ts) stays out of search engines entirely.
  if (isQa()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/admin", "/my", "/api", "/auth", "/login", "/invite", "/welcome", "/pass", "/files", "/cal", "/door", "/update-needed"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

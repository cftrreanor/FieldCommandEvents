import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

// Security headers on every page:
// - Never shown inside another site's frame (stops "clickjacking": a page that
//   overlays our buttons to trick a signed-in host into clicking them).
// - Other sites only learn our domain, not full page addresses, from links.
// - Browsers don't guess file types; no camera, microphone or location.
// The QA site (src/lib/qa.ts) may show its own pages in a frame, for its
// phone-size view; other sites still can't.
const qa = process.env.QA_MODE === "1";
const securityHeaders = [
  { key: "Content-Security-Policy", value: qa ? "frame-ancestors 'self'" : "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: qa ? "SAMEORIGIN" : "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Not experimental.inlineCss: tested 2026-11-09, it sends the CSS twice and added about 85 ms of frozen
  // time on phones, for no gain in when the page shows.
  // AVIF where the browser takes it (about 20% smaller than WebP), WebP otherwise.
  images: {
    formats: ["image/avif", "image/webp"],
    // 448 and 512 fit the 228–248 px phone screenshots on phones and retina screens, between 384 and 640.
    imageSizes: [32, 48, 64, 96, 128, 256, 384, 448, 512],
  },
  // Sign-up sheets are volunteer events (one kind, one page): the search-friendly address leads there.
  async redirects() {
    return [{ source: "/sign-up-sheets", destination: "/volunteer-events", permanent: true }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Error alerts (src/lib/sentry-options.ts). With SENTRY_AUTH_TOKEN, SENTRY_ORG and
// SENTRY_PROJECT set in Vercel, each build uploads its source maps so alerts point
// at the real line of code; without them the build carries on as normal.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  telemetry: false,
  // The app only sends error alerts (no performance tracing or session recordings: lib/sentry-options.ts),
  // so the browser bundle leaves that code out: less JavaScript on every page (page speed, 2026-11-09).
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeTracing: true,
    excludeReplayShadowDom: true,
    excludeReplayIframe: true,
    excludeReplayWorker: true,
  },
});

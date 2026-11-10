import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { brand } from "@/lib/brand";
import { SITE_URL } from "@/lib/site-url";
import "./globals.css";
import { DialogHost } from "@/components/confirm-dialog";
import { Toaster } from "@/components/toaster";
import { RequiredFields } from "@/components/required-fields";
import { QaBar } from "@/components/qa-bar";
import { SiteMetrics } from "@/components/site-metrics";
import { FeedbackButton } from "@/components/feedback-button";

// The design system's faces: Inter (variable, so the in-between 460/540 weights
// render) for everything, JetBrains Mono for codes.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
// Not preloaded: only dashboard and admin pages show codes, so public pages don't spend a phone's
// first second downloading it (it loads when a page uses it).
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], preload: false });

const DESCRIPTION =
  "Every detail organized. Every organizer supported. Sign-up sheets, volunteer shifts, registration, bookings, and check-in on any phone, for schools, PTOs, clubs, congregations, and community groups. Organizers sign in to run their events. Volunteers, families, and guests join from the organizer's link and are never asked to make an account or shown ads.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${brand.name}: Event Sign-ups, Registration & Check-in for Schools, Clubs & Community Groups`,
    template: `%s · ${brand.name}`,
  },
  description: DESCRIPTION,
  applicationName: brand.name,
  openGraph: { type: "website", siteName: brand.name, description: DESCRIPTION },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <QaBar />
        <SiteMetrics />
        {children}
        <Toaster />
        <DialogHost />
        <RequiredFields />
        <FeedbackButton />
      </body>
    </html>
  );
}

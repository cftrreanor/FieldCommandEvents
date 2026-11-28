import { AudiencePage, audienceMetadata } from "@/components/audience-page";
import { audiences } from "@/lib/audiences";

// The header, menu, and footer link to Prices once the owner switches that page on (src/lib/site-pricing.ts).
export const revalidate = 60;

export const metadata = audienceMetadata(audiences.volunteers);

export default function Page() {
  return <AudiencePage audience={audiences.volunteers} />;
}

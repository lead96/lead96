import type { Metadata } from "next";
import { Plug } from "lucide-react";
import { ComingSoon } from "../coming-soon";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return (
    <ComingSoon
      title="Integrations"
      description="Connect your Google Ads, Meta and Google Calendar accounts."
      icon={Plug}
      preview="Link your Google Ads and Facebook accounts to bring leads and ad spend in automatically, and your calendar for bookings."
    />
  );
}

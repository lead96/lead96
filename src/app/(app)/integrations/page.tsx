import type { Metadata } from "next";
import { ComingSoon } from "../coming-soon";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return <ComingSoon title="Integrations" description="Connect your Google Ads, Meta and Google Calendar accounts." milestone="Milestone 2" />;
}

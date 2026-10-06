import type { Metadata } from "next";
import { ComingSoon } from "../coming-soon";

export const metadata: Metadata = { title: "Leads" };

export default function Page() {
  return <ComingSoon title="Leads" description="Every lead and call with source, recording, status, cost and revenue." milestone="Milestone 2" />;
}

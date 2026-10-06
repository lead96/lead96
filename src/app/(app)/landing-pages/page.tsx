import type { Metadata } from "next";
import { ComingSoon } from "../coming-soon";

export const metadata: Metadata = { title: "Landing pages" };

export default function Page() {
  return <ComingSoon title="Landing pages" description="Mobile-first pages that send leads and calls straight into your inbox." milestone="Milestone 2" />;
}

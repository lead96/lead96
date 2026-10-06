import type { Metadata } from "next";
import { ComingSoon } from "../coming-soon";

export const metadata: Metadata = { title: "Calendar" };

export default function Page() {
  return <ComingSoon title="Calendar" description="Booked appointments, capacity and booking hours." milestone="Milestone 4" />;
}

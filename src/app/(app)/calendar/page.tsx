import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { ComingSoon } from "../coming-soon";

export const metadata: Metadata = { title: "Calendar" };

export default function Page() {
  return (
    <ComingSoon
      title="Calendar"
      description="Booked appointments, capacity and booking hours."
      icon={CalendarDays}
      preview="Appointments the AI books will show up here, synced with your Google Calendar and your booking hours."
    />
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { ComingSoon } from "../coming-soon";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const profile = await getProfile();
  if (!profile?.is_platform_admin) redirect("/dashboard");

  return (
    <ComingSoon
      title="Admin"
      description="All businesses, integration health, errors and audit log."
      milestone="Milestone 5"
    />
  );
}

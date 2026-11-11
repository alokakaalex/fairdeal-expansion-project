import type { Metadata } from "next";
import Dashboard from "@/components/portal/Dashboard";
import { requireRole } from "@/lib/server/session";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminDashboard(props: PageProps<"/admin">) {
  const user = await requireRole("admin");
  return (
    <Dashboard
      user={user}
      basePath="/admin"
      title="Expansion dashboard"
      subtitle="Every property, document, decision and payment."
      params={await props.searchParams}
    />
  );
}

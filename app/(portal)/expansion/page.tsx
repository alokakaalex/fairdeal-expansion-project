import type { Metadata } from "next";
import Dashboard from "@/components/portal/Dashboard";
import { requireRole } from "@/lib/server/session";

export const metadata: Metadata = { title: "Expansion dashboard" };

export default async function ExpansionHome(props: PageProps<"/expansion">) {
  const user = await requireRole("expansion_manager");
  return (
    <Dashboard
      user={user}
      basePath="/expansion"
      title="Expansion dashboard"
      subtitle="Every property with its full details, media, documents, and every team's approvals and payments."
      params={await props.searchParams}
    />
  );
}

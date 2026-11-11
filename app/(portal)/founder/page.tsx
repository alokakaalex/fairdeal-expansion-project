import type { Metadata } from "next";
import Dashboard from "@/components/portal/Dashboard";
import { requireRole } from "@/lib/server/session";

export const metadata: Metadata = { title: "Founder" };

export default async function FounderHome(props: PageProps<"/founder">) {
  const user = await requireRole("founder");
  return (
    <Dashboard
      user={user}
      basePath="/founder"
      title="Founder dashboard"
      subtitle="Properties waiting for your approval, and the status of every property and payment."
      params={await props.searchParams}
    />
  );
}

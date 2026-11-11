import type { Metadata } from "next";
import TeamHome from "@/components/portal/TeamHome";
import { requireRole } from "@/lib/server/session";

export const metadata: Metadata = { title: "Business Leaders" };

export default async function Page() {
  const user = await requireRole("business");
  return <TeamHome user={user} title="Business Leaders" waitingLabel="Awaiting your approval" />;
}

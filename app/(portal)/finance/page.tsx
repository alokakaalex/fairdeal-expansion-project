import type { Metadata } from "next";
import TeamHome from "@/components/portal/TeamHome";
import { requireRole } from "@/lib/server/session";

export const metadata: Metadata = { title: "Finance" };

export default async function Page() {
  const user = await requireRole("finance");
  return <TeamHome user={user} title="Finance" waitingLabel="Payments to release" />;
}

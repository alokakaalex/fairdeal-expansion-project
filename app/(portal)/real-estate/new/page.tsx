import type { Metadata } from "next";
import PropertyForm from "@/components/portal/PropertyForm";
import { Card, PageHeader } from "@/components/portal/ui";
import { requireRole } from "@/lib/server/session";

export const metadata: Metadata = { title: "Upload property" };

export default async function NewPropertyPage() {
  await requireRole("real_estate");
  return (
    <>
      <PageHeader
        eyebrow="Scout a property" title="New property"
        subtitle="Step 1 of 2: property details. You'll add photos and videos next, then submit to the Expansion Manager."
      />
      <Card>
        <PropertyForm />
      </Card>
    </>
  );
}

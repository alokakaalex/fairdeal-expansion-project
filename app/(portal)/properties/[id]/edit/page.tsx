import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PropertyForm from "@/components/portal/PropertyForm";
import { buttonClass, Card, PageHeader } from "@/components/portal/ui";
import { isEditable } from "@/lib/expansion/workflow";
import { getProperty } from "@/lib/server/properties";
import { requireRole } from "@/lib/server/session";

export const metadata: Metadata = { title: "Edit property" };

export default async function EditProperty(props: PageProps<"/properties/[id]/edit">) {
  const user = await requireRole("real_estate");
  const { id } = await props.params;
  const property = await getProperty(user, Number(id));
  if (!property) notFound();
  if (!isEditable(property.state)) redirect(`/properties/${property.id}`);
  return (
    <>
      <PageHeader
        title={`Edit ${property.storeName}`}
        subtitle={property.code}
        actions={
          <Link href={`/properties/${property.id}`} className={buttonClass.secondary}>
            Cancel
          </Link>
        }
      />
      <Card>
        <PropertyForm property={property} />
      </Card>
    </>
  );
}

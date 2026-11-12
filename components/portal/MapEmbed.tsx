import { mapEmbedUrl, mapOpenUrl, placeFromMapUrl } from "@/lib/expansion/maps";
import type { PropertyView } from "@/lib/expansion/types";

export default function MapEmbed({ property }: { property: PropertyView }) {
  const coords =
    property.latitude != null && property.longitude != null
      ? { latitude: property.latitude, longitude: property.longitude }
      : null;
  const embed = mapEmbedUrl(property.address ?? "", coords, placeFromMapUrl(property.mapUrl));
  const open = mapOpenUrl(property.mapUrl, property.address ?? "", coords);
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-700">{property.address}</p>
      {embed ? (
        <iframe
          title={`Map of ${property.storeName}`}
          src={embed}
          className="h-72 w-full rounded-md border border-slate-200"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : null}
      {open ? (
        <a href={open} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-sky-700 hover:underline">
          Open in Google Maps ↗
        </a>
      ) : null}
      {!coords && property.mapUrl ? (
        <p className="text-xs text-slate-500">
          The exact pin couldn&apos;t be read from this link, so the map shows the named place or address. &ldquo;Open in Google Maps&rdquo; has the
          exact spot; for a precise map, paste the full Google Maps link or the coordinates (e.g. 28.5375, 77.2905).
        </p>
      ) : null}
    </div>
  );
}

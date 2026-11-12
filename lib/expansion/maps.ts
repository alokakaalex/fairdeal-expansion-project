// Google Maps helpers. A real estate manager pastes whatever they have — a
// full maps URL, a short share link, or raw "lat, lng" — and we pull out
// coordinates where possible so the map can be embedded without an API key.

export interface Coordinates {
  latitude: number;
  longitude: number;
}

function valid(lat: number, lng: number): Coordinates | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}

// "28.56, 77.29" — Google also writes "28.56,+77.29".
const PAIR = String.raw`\+?(-?\d{1,3}(?:\.\d+)?)\s*,\s*\+?(-?\d{1,3}(?:\.\d+)?)`;

export function parseCoordinates(input: string): Coordinates | null {
  const text = input.trim();
  if (!text) return null;
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // Keep the raw text if it isn't valid percent-encoding.
  }

  // "28.61, 77.20"
  const bare = decoded.match(new RegExp(`^${PAIR}$`));
  if (bare) return valid(Number(bare[1]), Number(bare[2]));

  // Place pin in data params: !3d<lat>!4d<lng> (more precise than the @ viewport).
  const pin = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (pin) return valid(Number(pin[1]), Number(pin[2]));

  // q=lat,lng / ll=lat,lng / query=lat,lng / destination=lat,lng
  const param = decoded.match(new RegExp(`[?&](?:q|ll|query|destination|center)=${PAIR}`));
  if (param) return valid(Number(param[1]), Number(param[2]));

  // .../maps/search/lat,lng  .../maps/place/lat,lng  .../maps/dir//lat,lng
  const path = decoded.match(new RegExp(`/maps/(?:search|place|dir/[^/]*)/${PAIR}`));
  if (path) return valid(Number(path[1]), Number(path[2]));

  // .../@lat,lng,15z (the map's centre — close to the pin, used last)
  const at = decoded.match(new RegExp(`@${PAIR}`));
  if (at) return valid(Number(at[1]), Number(at[2]));

  return null;
}

/** Share links from the Google Maps app (maps.app.goo.gl/…, goo.gl/maps/…) carry no coordinates until followed. */
export function isShortMapLink(input: string | null | undefined): boolean {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i.test((input ?? "").trim());
}

/**
 * The place a Google Maps link points at, when it names one but has no
 * coordinates: "/maps/place/<name>/…" or "?q=<text>". Better for the
 * embedded map than the typed address, which may only name the area.
 */
export function placeFromMapUrl(input: string | null | undefined): string | null {
  const url = safeHttpUrl(input ?? "");
  if (!url) return null;
  const u = new URL(url);
  if (!/(^|\.)google\.[a-z.]+$/i.test(u.hostname)) return null;
  const place = u.pathname.match(/\/maps\/place\/([^/]+)/);
  const text = place ? place[1] : (u.searchParams.get("q") ?? u.searchParams.get("query"));
  if (!text) return null;
  try {
    return decodeURIComponent(text.replace(/\+/g, " ")).trim() || null;
  } catch {
    return text.replace(/\+/g, " ").trim() || null;
  }
}

/** Accept only http(s) links so a pasted value can never become a javascript: URL. */
export function safeHttpUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function query(address: string, coords: Coordinates | null, place?: string | null): string {
  return coords ? `${coords.latitude},${coords.longitude}` : place || address;
}

/** Embedded map: the exact pin when known, else the place the link names, else the typed address. */
export function mapEmbedUrl(address: string, coords: Coordinates | null, place?: string | null): string | null {
  const q = query(address, coords, place);
  if (!q.trim()) return null;
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=${coords ? 17 : 16}&output=embed`;
}

export function mapOpenUrl(mapUrl: string | null, address: string, coords: Coordinates | null): string | null {
  if (mapUrl) {
    const safe = safeHttpUrl(mapUrl);
    if (safe) return safe;
  }
  const q = query(address, coords);
  if (!q.trim()) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

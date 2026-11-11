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

const PAIR = String.raw`(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)`;

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

  // .../@lat,lng,15z
  const at = decoded.match(new RegExp(`@${PAIR}`));
  if (at) return valid(Number(at[1]), Number(at[2]));

  return null;
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

function query(address: string, coords: Coordinates | null): string {
  return coords ? `${coords.latitude},${coords.longitude}` : address;
}

export function mapEmbedUrl(address: string, coords: Coordinates | null): string | null {
  const q = query(address, coords);
  if (!q.trim()) return null;
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=16&output=embed`;
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

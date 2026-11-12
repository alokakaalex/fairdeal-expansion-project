import "server-only";
import { isShortMapLink, parseCoordinates, safeHttpUrl, type Coordinates } from "@/lib/expansion/maps";

// Short Google Maps share links (maps.app.goo.gl/…) only reveal the pin
// once followed: they redirect to the full maps URL, which holds the
// coordinates. Only Google's own hosts are followed, a few hops at most.

const GOOGLE_HOST = /(^|\.)(google\.[a-z]{2,3}(\.[a-z]{2})?|goo\.gl|app\.goo\.gl|g\.co)$/i;

export interface ResolvedMapLink {
  /** The exact pin, if the link leads to one. */
  coordinates: Coordinates | null;
  /** The full Google Maps address a short link leads to (names the place even without coordinates). */
  fullUrl: string | null;
}

/** The exact pin behind a Google Maps link, following short-link redirects. Null if none is found. */
export async function coordinatesFromMapLink(input: string | null | undefined): Promise<Coordinates | null> {
  return (await resolveMapLink(input)).coordinates;
}

/** Follows a share link to the full Google Maps address and reads the pin from it. */
export async function resolveMapLink(input: string | null | undefined): Promise<ResolvedMapLink> {
  const direct = parseCoordinates(input ?? "");
  if (direct || !isShortMapLink(input)) return { coordinates: direct, fullUrl: null };
  let url = safeHttpUrl(input!);
  let fullUrl: string | null = null;
  for (let hop = 0; url && hop < 5; hop++) {
    const host = new URL(url).hostname;
    if (!GOOGLE_HOST.test(host)) return { coordinates: null, fullUrl };
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(6000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; fairdeal-expansion-portal)", "Accept-Language": "en" },
      });
    } catch {
      return { coordinates: null, fullUrl };
    }
    const location = res.headers.get("location");
    if (location) {
      const next = new URL(location, url);
      // Google's consent page wraps the real address in ?continue=…
      const target = next.hostname.startsWith("consent.") ? (next.searchParams.get("continue") ?? next.toString()) : next.toString();
      const found = parseCoordinates(target);
      url = safeHttpUrl(target);
      if (url && /(^|\.)google\.[a-z.]+$/i.test(new URL(url).hostname) && new URL(url).pathname.startsWith("/maps")) fullUrl = url;
      if (found) return { coordinates: found, fullUrl };
      continue;
    }
    // No redirect: look for a maps URL with coordinates in the page itself.
    if (res.ok) {
      const html = (await res.text()).slice(0, 200_000);
      for (const m of html.matchAll(/https?:\\?\/\\?\/(?:www\.)?google\.[a-z.]+\\?\/maps[^"'\s<>]+/gi)) {
        const found = parseCoordinates(m[0].replace(/\\\//g, "/").replace(/\\u0026/g, "&"));
        if (found) return { coordinates: found, fullUrl };
      }
    }
    return { coordinates: null, fullUrl };
  }
  return { coordinates: null, fullUrl };
}

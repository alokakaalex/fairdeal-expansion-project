import { afterEach, describe, expect, it, vi } from "vitest";

const { coordinatesFromMapLink } = await import("./mapLinks");

afterEach(() => vi.unstubAllGlobals());

function redirects(chain: Record<string, string>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const to = chain[url];
    return to ? new Response(null, { status: 302, headers: { location: to } }) : new Response("<html></html>", { status: 200 });
  });
  return calls;
}

describe("following Google Maps share links", () => {
  it("finds the exact pin behind a maps.app.goo.gl link", async () => {
    redirects({
      "https://maps.app.goo.gl/JasolaPin": "https://www.google.com/maps/place/Some+Building/@28.538,77.291,17z/data=!3d28.537512!4d77.290512?g_st=aw",
    });
    expect(await coordinatesFromMapLink("https://maps.app.goo.gl/JasolaPin")).toEqual({ latitude: 28.537512, longitude: 77.290512 });
  });

  it("looks through Google's consent page", async () => {
    redirects({
      "https://maps.app.goo.gl/X": `https://consent.google.com/ml?continue=${encodeURIComponent("https://www.google.com/maps/search/28.5375,+77.2905")}`,
    });
    expect(await coordinatesFromMapLink("https://maps.app.goo.gl/X")).toEqual({ latitude: 28.5375, longitude: 77.2905 });
  });

  it("never follows a redirect off Google, and gives up quietly", async () => {
    const calls = redirects({ "https://maps.app.goo.gl/Evil": "https://attacker.example/internal", "https://attacker.example/internal": "https://www.google.com/maps/@1,2,3z" });
    expect(await coordinatesFromMapLink("https://maps.app.goo.gl/Evil")).toBeNull();
    expect(calls).toEqual(["https://maps.app.goo.gl/Evil"]);
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect(await coordinatesFromMapLink("https://maps.app.goo.gl/Offline")).toBeNull();
  });

  it("reads full links without any network call", async () => {
    const calls = redirects({});
    expect(await coordinatesFromMapLink("https://www.google.com/maps/@28.5,77.2,17z")).toEqual({ latitude: 28.5, longitude: 77.2 });
    expect(await coordinatesFromMapLink("https://example.com/somewhere")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("place links without coordinates", () => {
  it("returns the full link so the map can show the named place", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 302, headers: { location: "https://maps.google.com/maps?q=Jasola+Apollo+Metro+Station&ftid=0x1:0x2" } }));
    const { resolveMapLink } = await import("./mapLinks");
    const r = await resolveMapLink("https://maps.app.goo.gl/Place");
    expect(r.coordinates).toBeNull();
    expect(r.fullUrl).toBe("https://maps.google.com/maps?q=Jasola+Apollo+Metro+Station&ftid=0x1:0x2");
  });
});

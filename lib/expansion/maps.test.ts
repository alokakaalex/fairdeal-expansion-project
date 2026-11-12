import { describe, expect, it } from "vitest";
import { matchesSignature } from "@/lib/server/files";
import { isShortMapLink, mapEmbedUrl, mapOpenUrl, parseCoordinates, placeFromMapUrl, safeHttpUrl } from "./maps";

describe("parseCoordinates", () => {
  it.each([
    ["28.7041, 77.1025", [28.7041, 77.1025]],
    ["https://www.google.com/maps/@28.7041,77.1025,17z", [28.7041, 77.1025]],
    ["https://www.google.com/maps/place/X/@28.70,77.10,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d28.7045!4d77.1031", [28.7045, 77.1031]],
    ["https://maps.google.com/?q=19.0760,72.8777", [19.076, 72.8777]],
    ["https://www.google.com/maps/search/?api=1&query=12.97%2C77.59", [12.97, 77.59]],
  ])("reads %s", (input, [lat, lng]) => {
    expect(parseCoordinates(input)).toEqual({ latitude: lat, longitude: lng });
  });

  it("returns null for short links and out-of-range values", () => {
    expect(parseCoordinates("https://maps.app.goo.gl/abc123")).toBeNull();
    expect(parseCoordinates("123, 456")).toBeNull();
  });
});

describe("safe links", () => {
  it("rejects non-http URLs", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(mapOpenUrl("javascript:alert(1)", "Rohini", null)).toMatch(/^https:\/\/www\.google\.com\/maps\/search/);
  });
});

describe("upload signatures", () => {
  const bytes = (...b: (number | string)[]) =>
    new Uint8Array(b.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));

  it("accepts real headers and rejects mismatches", () => {
    expect(matchesSignature("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(matchesSignature("image/png", bytes(0x89, "PNG"))).toBe(true);
    expect(matchesSignature("video/mp4", bytes(0, 0, 0, 0x18, "ftypmp42"))).toBe(true);
    expect(matchesSignature("image/png", bytes("<html><script>"))).toBe(false);
    expect(matchesSignature("image/svg+xml", bytes("<svg"))).toBe(false);
    expect(matchesSignature("application/pdf", bytes("%PDF-1.4"))).toBe(true);
    expect(matchesSignature("application/pdf", bytes("<html>"))).toBe(false);
  });
});

describe("Google Maps links from the app", () => {
  it.each([
    ["https://www.google.com/maps/search/28.537512,+77.290512?entry=tts", [28.537512, 77.290512]],
    ["https://www.google.com/maps/place/28%C2%B032'15.0%22N+77%C2%B017'25.8%22E/@28.5375,77.2905,17z/data=!4m4!3m3!8m2!3d28.537512!4d77.290512", [28.537512, 77.290512]],
    ["https://www.google.com/maps/dir//28.5375,77.2905", [28.5375, 77.2905]],
  ])("reads the pin from %s", (input, [lat, lng]) => {
    expect(parseCoordinates(input)).toEqual({ latitude: lat, longitude: lng });
  });

  it("recognises share links that must be followed", () => {
    expect(isShortMapLink("https://maps.app.goo.gl/AbC123xyz")).toBe(true);
    expect(isShortMapLink("https://goo.gl/maps/AbC123")).toBe(true);
    expect(isShortMapLink("https://www.google.com/maps/@28.5,77.2,17z")).toBe(false);
  });

  it("uses the place a link names before the typed area", () => {
    const place = placeFromMapUrl("https://www.google.com/maps/place/Jasola+Apollo+Metro+Station,+New+Delhi/data=!4m2");
    expect(place).toBe("Jasola Apollo Metro Station, New Delhi");
    expect(mapEmbedUrl("Jasola", null, place)).toContain(encodeURIComponent("Jasola Apollo Metro Station"));
    expect(mapEmbedUrl("Jasola", { latitude: 28.5375, longitude: 77.2905 }, place)).toContain("q=28.5375%2C77.2905");
  });
});

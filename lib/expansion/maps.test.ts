import { describe, expect, it } from "vitest";
import { matchesSignature } from "@/lib/server/files";
import { mapOpenUrl, parseCoordinates, safeHttpUrl } from "./maps";

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

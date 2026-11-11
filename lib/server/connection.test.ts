import { describe, expect, it } from "vitest";

const { connectionOptions, describeDbError } = await import("./db");

describe("database connection options", () => {
  it("encrypts without requiring a public CA for sslmode=require (Supabase's pooler)", () => {
    const o = connectionOptions("postgresql://postgres.ref:p%40ss@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require");
    expect(o.ssl).toEqual({ rejectUnauthorized: false });
    expect(o.connectionString).toBe("postgresql://postgres.ref:p%40ss@aws-0-ap-south-1.pooler.supabase.com:6543/postgres");
  });

  it("verifies the certificate when asked to, and skips TLS locally or when disabled", () => {
    expect(connectionOptions("postgres://u:p@db.example.com/x?sslmode=verify-full").ssl).toEqual({ rejectUnauthorized: true });
    expect(connectionOptions("postgres://u:p@db.example.com/x?sslmode=disable").ssl).toBe(false);
    expect(connectionOptions("postgres://u:p@localhost:5432/x").ssl).toBe(false);
    expect(connectionOptions("postgres://u:p@db.example.com/x").ssl).toEqual({ rejectUnauthorized: false });
  });

  it("describes failures without leaking details", () => {
    expect(describeDbError(new Error("self-signed certificate in certificate chain"))).toMatch(/^ssl/);
    expect(describeDbError({ code: "28P01", message: 'password authentication failed for user "postgres"' })).toMatch(/^auth/);
    expect(describeDbError(new Error("getaddrinfo ENOTFOUND db.secret-host.supabase.co"))).not.toContain("secret-host");
    expect(describeDbError(new Error("Tenant or user not found"))).toMatch(/pooler/);
  });
});

describe("APP_URL", async () => {
  const { normalizeAppUrl } = await import("./config");
  it("accepts the address however it was typed", () => {
    expect(normalizeAppUrl("fairdeal-expansion-project.vercel.app")).toBe("https://fairdeal-expansion-project.vercel.app");
    expect(normalizeAppUrl(' "https://fairdeal-expansion-project.vercel.app/" ')).toBe("https://fairdeal-expansion-project.vercel.app");
    expect(normalizeAppUrl("https://fairdeal-expansion-project.vercel.app/login")).toBe("https://fairdeal-expansion-project.vercel.app");
    expect(normalizeAppUrl("localhost:3000")).toBe("http://localhost:3000");
  });
  it("falls back to Vercel's production address, then localhost", () => {
    expect(normalizeAppUrl(undefined, "fairdeal-expansion-project.vercel.app")).toBe("https://fairdeal-expansion-project.vercel.app");
    expect(normalizeAppUrl("", undefined)).toBe("http://localhost:3000");
  });
});

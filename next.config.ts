import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded from node_modules at runtime rather than bundled: PGlite ships
  // WebAssembly files it locates relative to itself, and pg has optional
  // native bindings.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Make sure PGlite's WebAssembly and data files are deployed with every
  // server function (used by the demo and local development).
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@electric-sql/pglite/dist/**/*"],
  },
};

export default nextConfig;

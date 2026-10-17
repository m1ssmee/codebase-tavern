import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents off: it rejects `export const runtime` in routes, and all our data is client-side anyway.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

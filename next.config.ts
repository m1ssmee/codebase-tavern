import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The OG image route reads its fonts from disk.
  outputFileTracingIncludes: { '/roast/og': ['./assets/fonts/*.woff'] },
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

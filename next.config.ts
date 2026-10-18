import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Roast card on the server reads its fonts and the portraits from disk.
  outputFileTracingIncludes: { '/roast/og': ['./assets/fonts/*.woff', './public/portraits/*.webp'], '/roast': ['./public/portraits/*.webp'] },
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

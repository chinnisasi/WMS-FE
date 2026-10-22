import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The web shell is the only Next.js surface; mobile is a separate Expo app
  // under mobile/ (extracted to its own repo later).
  reactStrictMode: true,
  // Story 6-2a — the production image runs `.next/standalone/server.js` on
  // Node (decision 8): the build traces exactly the node_modules the server
  // needs, so the image carries no dev dependencies. The API address is NOT
  // baked in — `/runtime-config.js` serves it from `WMS_API_BASE_URL` at run
  // time, so one image serves every environment.
  output: 'standalone',
};

export default nextConfig;

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
  // Story 5-1a — the accept-invite URL carries a one-time token: the page
  // never leaks it in a Referer (the page's metadata says the same). Story
  // 6-1c — the reset page too (its token rides the fragment, which a Referer
  // never carries, but the page sends none at all).
  async headers() {
    return [
      { source: '/accept-invite', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
      { source: '/reset-password', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    ];
  },
};

export default nextConfig;

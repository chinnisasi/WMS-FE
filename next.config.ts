import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The web shell is the only Next.js surface; mobile is a separate Expo app
  // under mobile/ (extracted to its own repo later).
  reactStrictMode: true,
};

export default nextConfig;
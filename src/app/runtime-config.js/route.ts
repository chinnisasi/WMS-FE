import { runtimeConfigFromEnv, runtimeConfigScript } from '@/lib/api/base-url';

/**
 * Story 6-2a (decision 8, A7) — `GET /runtime-config.js`: the browser's API
 * base, read from the SERVER's environment (`WMS_API_BASE_URL`) on every
 * request, so one built image serves every environment. Never prerendered:
 * a build-time copy would freeze the build machine's value into the image.
 * The root layout loads it with a blocking `<script>` ahead of the app
 * scripts, and `getApiBaseUrl()` reads it at call time.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return new Response(runtimeConfigScript(runtimeConfigFromEnv()), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // Re-read per page load: a config change must reach the next visit.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

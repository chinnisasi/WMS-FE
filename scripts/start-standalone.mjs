/* global URL, process, console -- a Node script outside the browser lint config */
/**
 * Story 6-2a, code review C6 — the image's start. It refuses to serve
 * without a usable `WMS_API_BASE_URL`: unset or not an absolute http(s)
 * URL, every browser would silently fall back to the build default
 * (`http://localhost:3000/api/v1`) and no request would reach the API.
 * Valid, it hands over to Next's standalone `server.js` (copied beside this
 * file in the image).
 *
 *   node start-standalone.mjs        # CMD of the wms-fe image
 */
import { pathToFileURL } from 'node:url';

export function apiBaseUrlProblem(value) {
  if (value === undefined || value === '') return 'WMS_API_BASE_URL is not set';
  let url;
  try {
    url = new URL(value);
  } catch {
    return `WMS_API_BASE_URL is not an absolute URL (got "${value}")`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `WMS_API_BASE_URL must be http(s) (got "${url.protocol}")`;
  }
  return null;
}

// Only when run as the entry point (a test imports the rule above).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problem = apiBaseUrlProblem(process.env.WMS_API_BASE_URL);
  if (problem !== null) {
    console.error(`${problem} — the browser's API base, e.g. https://api.example.in/api/v1 (docs/design/DEPLOY.md). Refusing to start.`);
    process.exit(1);
  }
  await import(process.env.WMS_STANDALONE_SERVER ?? './server.js');
}

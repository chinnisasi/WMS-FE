/**
 * The wms-be `/api/v1` base every request composes from. Its own module so the
 * session-refresh path (which must call the API without the generated
 * client's interceptors) and the client config share one rule.
 *
 * Story 6-2a (decision 8, A7) — the base is resolved at CALL time, never
 * frozen at import, so one image serves every environment:
 *
 *   - in the browser, `window.__WMS_CONFIG__.apiBaseUrl`, which
 *     `/runtime-config.js` (a dynamic route, loaded by the root layout before
 *     the app scripts) sets from the server's `WMS_API_BASE_URL`;
 *   - on the server (a server component's fetch), `WMS_API_INTERNAL_BASE_URL`
 *     when set — the address the web task reaches the API at, which inside a
 *     container network can differ from the browser's — else
 *     `WMS_API_BASE_URL`;
 *   - otherwise `NEXT_PUBLIC_API_BASE_URL`, the dev and build default (inlined
 *     at build time), else `http://localhost:3000/api/v1`.
 *
 * `||` (not `??`) throughout, so a set-but-empty value still falls back; a
 * trailing slash is dropped (callers append `/tenants/…`).
 */
export const DEFAULT_API_BASE_URL = 'http://localhost:3000/api/v1';

/** The build-time default (`NEXT_PUBLIC_API_BASE_URL`, inlined by Next). */
export const BUILD_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;

/** The runtime config `/runtime-config.js` assigns before the app scripts run. */
export interface WmsRuntimeConfig {
  apiBaseUrl?: string;
}

declare global {
  interface Window {
    __WMS_CONFIG__?: WmsRuntimeConfig;
  }
}

function trimmed(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const runtime = window.__WMS_CONFIG__?.apiBaseUrl;
    if (typeof runtime === 'string' && runtime !== '') return trimmed(runtime);
    return trimmed(BUILD_API_BASE_URL);
  }
  return trimmed(process.env.WMS_API_INTERNAL_BASE_URL || process.env.WMS_API_BASE_URL || BUILD_API_BASE_URL);
}

/**
 * What `/runtime-config.js` hands the browser: the public API base from the
 * server's environment, or nothing (the browser then keeps the build default).
 */
export function runtimeConfigFromEnv(env: Record<string, string | undefined> = process.env): WmsRuntimeConfig {
  const apiBaseUrl = env.WMS_API_BASE_URL;
  return apiBaseUrl ? { apiBaseUrl: trimmed(apiBaseUrl) } : {};
}

/**
 * The `/runtime-config.js` body: one assignment of escaped JSON. `<`, `>`,
 * `&` and the two JS line separators are escaped, so no value can close a
 * script element or break the statement wherever the text is embedded.
 */
export function runtimeConfigScript(config: WmsRuntimeConfig): string {
  const json = JSON.stringify(config)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `window.__WMS_CONFIG__ = ${json};\n`;
}

/** The path the root layout loads the runtime config from (and the proxy lets through). */
export const RUNTIME_CONFIG_PATH = '/runtime-config.js';

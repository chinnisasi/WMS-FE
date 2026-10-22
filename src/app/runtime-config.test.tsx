import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { RUNTIME_CONFIG_PATH } from '@/lib/api/base-url';
import { config } from '@/proxy';

import { GET, dynamic } from './runtime-config.js/route';

// `next/font` needs the Next compiler; the layout's font is not under test.
mock.module('geist/font/sans', () => ({ GeistSans: { variable: 'font-geist-sans' } }));
const { default: RootLayout } = await import('./layout');

/**
 * Story 6-2a (decision 8, A7) — the runtime API base reaches the browser
 * through `/runtime-config.js`: a dynamic route reading the server's
 * environment per request, loaded by the root layout BEFORE the theme script
 * and every app script, and let through the auth proxy.
 */
const saved = process.env.WMS_API_BASE_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.WMS_API_BASE_URL;
  else process.env.WMS_API_BASE_URL = saved;
});

describe('/runtime-config.js', () => {
  test('serves the server env as an uncached script, per request (never prerendered)', async () => {
    expect(dynamic).toBe('force-dynamic');
    process.env.WMS_API_BASE_URL = 'https://api.x/api/v1';
    const res = GET();
    expect(res.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toBe('window.__WMS_CONFIG__ = {"apiBaseUrl":"https://api.x/api/v1"};\n');

    // The next request reads the env again — nothing was frozen.
    process.env.WMS_API_BASE_URL = 'https://api.y/api/v1';
    expect(await GET().text()).toContain('https://api.y/api/v1');
    delete process.env.WMS_API_BASE_URL;
    expect(await GET().text()).toBe('window.__WMS_CONFIG__ = {};\n');
  });
});

describe('the root layout', () => {
  test('loads the runtime config with a blocking script, first in <head>', () => {
    const html = renderToStaticMarkup(<RootLayout>{null}</RootLayout>);
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    const scripts = [...head.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts[0]).toBe(`<script src="${RUNTIME_CONFIG_PATH}"></script>`.replace('></script>', '>'));
    // Blocking on purpose: an async or deferred script could run after the app reads the base.
    expect(scripts[0]).not.toMatch(/\basync\b|\bdefer\b|type="module"/);
  });
});

describe('the auth proxy lets the script through', () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);
  test('a signed-out page can load /runtime-config.js; app pages are still gated', () => {
    expect(matcher.test(RUNTIME_CONFIG_PATH)).toBe(false);
    expect(matcher.test('/login')).toBe(true);
    expect(matcher.test('/settings')).toBe(true);
    expect(matcher.test('/runtime-config.json')).toBe(true);
  });
});

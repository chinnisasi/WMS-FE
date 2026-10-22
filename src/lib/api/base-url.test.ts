import { afterEach, describe, expect, test } from 'bun:test';

import { restoreGlobals, stubGlobal } from '../test/globals';
import {
  BUILD_API_BASE_URL,
  DEFAULT_API_BASE_URL,
  getApiBaseUrl,
  runtimeConfigFromEnv,
  runtimeConfigScript,
} from './base-url';
import { fetchApiHealth, syncClientBaseUrl } from './client';
import { client } from './generated/client.gen';

/**
 * Story 6-2a (decision 8, A7) — the API base is resolved at CALL time from
 * the runtime config `/runtime-config.js` assigns, so one image serves every
 * environment; unset, the build default stands.
 */
afterEach(() => {
  restoreGlobals();
  delete window.__WMS_CONFIG__;
  syncClientBaseUrl();
});

describe('getApiBaseUrl', () => {
  test('in the browser: the runtime config wins, trailing slashes dropped', () => {
    window.__WMS_CONFIG__ = { apiBaseUrl: 'https://api.x/api/v1/' };
    expect(getApiBaseUrl()).toBe('https://api.x/api/v1');
  });

  test('unset or empty → the build default (NEXT_PUBLIC_API_BASE_URL, else localhost)', () => {
    expect(getApiBaseUrl()).toBe(BUILD_API_BASE_URL.replace(/\/+$/, ''));
    window.__WMS_CONFIG__ = { apiBaseUrl: '' };
    expect(getApiBaseUrl()).toBe(BUILD_API_BASE_URL.replace(/\/+$/, ''));
    window.__WMS_CONFIG__ = {};
    expect(getApiBaseUrl()).toBe(BUILD_API_BASE_URL.replace(/\/+$/, ''));
    expect(DEFAULT_API_BASE_URL).toBe('http://localhost:3000/api/v1');
  });

  test('read per call, never frozen: a later runtime config is the next answer', () => {
    const before = getApiBaseUrl();
    window.__WMS_CONFIG__ = { apiBaseUrl: 'https://later.example/api/v1' };
    expect(getApiBaseUrl()).toBe('https://later.example/api/v1');
    delete window.__WMS_CONFIG__;
    expect(getApiBaseUrl()).toBe(before);
  });

  test('on the server (no window): WMS_API_INTERNAL_BASE_URL, else WMS_API_BASE_URL, else the build default', () => {
    stubGlobal('window', undefined);
    const saved = { internal: process.env.WMS_API_INTERNAL_BASE_URL, public: process.env.WMS_API_BASE_URL };
    try {
      delete process.env.WMS_API_INTERNAL_BASE_URL;
      delete process.env.WMS_API_BASE_URL;
      expect(getApiBaseUrl()).toBe(BUILD_API_BASE_URL.replace(/\/+$/, ''));
      process.env.WMS_API_BASE_URL = 'https://api.public/api/v1';
      expect(getApiBaseUrl()).toBe('https://api.public/api/v1');
      process.env.WMS_API_INTERNAL_BASE_URL = 'http://api:3000/api/v1';
      expect(getApiBaseUrl()).toBe('http://api:3000/api/v1');
    } finally {
      if (saved.internal === undefined) delete process.env.WMS_API_INTERNAL_BASE_URL;
      else process.env.WMS_API_INTERNAL_BASE_URL = saved.internal;
      if (saved.public === undefined) delete process.env.WMS_API_BASE_URL;
      else process.env.WMS_API_BASE_URL = saved.public;
    }
  });
});

describe('the runtime config script', () => {
  test('from the server env: WMS_API_BASE_URL, or nothing', () => {
    expect(runtimeConfigFromEnv({ WMS_API_BASE_URL: 'https://api.x/api/v1/' })).toEqual({ apiBaseUrl: 'https://api.x/api/v1' });
    expect(runtimeConfigFromEnv({})).toEqual({});
    expect(runtimeConfigFromEnv({ WMS_API_BASE_URL: '' })).toEqual({});
  });

  test('assigns window.__WMS_CONFIG__ with escaped JSON that round-trips — no value can close a script element', () => {
    const hostile = 'https://api.x/</script><script>alert(1)</script>& ';
    const script = runtimeConfigScript({ apiBaseUrl: hostile });
    expect(script).not.toContain('</script>');
    expect(script).not.toContain('<');
    expect(script).not.toContain(' ');
    const target: { __WMS_CONFIG__?: { apiBaseUrl?: string } } = {};
    new Function('window', script)(target);
    expect(target.__WMS_CONFIG__).toEqual({ apiBaseUrl: hostile });
  });
});

describe('the generated client reads the base at call time', () => {
  test('a request after the runtime config is set goes to the runtime base; unset, back to the build default', async () => {
    const urls: string[] = [];
    stubGlobal('fetch', async (input: Request | string) => {
      urls.push(typeof input === 'string' ? input : input.url);
      return new Response(JSON.stringify({ status: 'ok', service: 'wms-be', time: '2026-10-23T00:00:00.000Z' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    // The client was configured when its module loaded — before this config.
    window.__WMS_CONFIG__ = { apiBaseUrl: 'https://api.runtime.example/api/v1' };
    await fetchApiHealth();
    expect(urls[0]).toBe('https://api.runtime.example/api/v1/health');
    expect(client.getConfig().baseUrl).toBe('https://api.runtime.example/api/v1');

    delete window.__WMS_CONFIG__;
    await fetchApiHealth();
    expect(urls[1]).toBe(`${BUILD_API_BASE_URL.replace(/\/+$/, '')}/health`);
  });
});

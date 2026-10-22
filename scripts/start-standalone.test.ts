import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apiBaseUrlProblem } from './start-standalone.mjs';

/**
 * Story 6-2a, code review C6 — the image refuses to start on an unset or
 * non-absolute http(s) `WMS_API_BASE_URL`, and hands over to the server
 * when it is valid. Run with Node, as the image runs it.
 */
const script = join(import.meta.dir, 'start-standalone.mjs');

function start(env: Record<string, string | undefined>) {
  const dir = mkdtempSync(join(tmpdir(), 'wms-fe-start-'));
  const server = join(dir, 'server.mjs');
  writeFileSync(server, "console.log('SERVER STARTED');\n");
  const clean = Object.fromEntries(Object.entries({ ...process.env, ...env }).filter(([, v]) => v !== undefined)) as Record<string, string>;
  if (env.WMS_API_BASE_URL === undefined) delete clean.WMS_API_BASE_URL;
  return spawnSync('node', [script], { env: { ...clean, WMS_STANDALONE_SERVER: server } as unknown as NodeJS.ProcessEnv, encoding: 'utf8' });
}

describe('the image start (C6)', () => {
  test('the rule', () => {
    expect(apiBaseUrlProblem(undefined)).toContain('not set');
    expect(apiBaseUrlProblem('')).toContain('not set');
    expect(apiBaseUrlProblem('api.example.in/api/v1')).toContain('not an absolute URL');
    expect(apiBaseUrlProblem('ftp://api.example.in')).toContain('must be http(s)');
    expect(apiBaseUrlProblem('https://api.example.in/api/v1')).toBeNull();
    expect(apiBaseUrlProblem('http://localhost:3000/api/v1')).toBeNull();
  });

  test('unset or invalid: exit 1 before the server loads; valid: the server starts', () => {
    const unset = start({ WMS_API_BASE_URL: undefined });
    expect(unset.status).toBe(1);
    expect(unset.stderr).toContain('WMS_API_BASE_URL is not set');
    expect(unset.stdout).not.toContain('SERVER STARTED');

    const relative = start({ WMS_API_BASE_URL: '/api/v1' });
    expect(relative.status).toBe(1);
    expect(relative.stdout).not.toContain('SERVER STARTED');

    const valid = start({ WMS_API_BASE_URL: 'https://api.example.in/api/v1' });
    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain('SERVER STARTED');
  });
});

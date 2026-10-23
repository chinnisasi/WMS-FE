import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { Agent, request } from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apiBaseUrlProblem, parseForceExitMs } from './start-standalone.mjs';

/**
 * Story 6-2a, code review C6 — the image refuses to start on an unset or
 * non-absolute http(s) `WMS_API_BASE_URL` (story 6-2c, A18: exit 78), and
 * hands over to the server when it is valid. Run with Node, as the image
 * runs it.
 *
 * Story 6-2c (decision 7, A1, A12) — the bounded drain, against a fixture
 * that does what Next's standalone server does: it creates its server through
 * `http.createServer` (the module object — Next's `_http.default`), sets
 * `KEEP_ALIVE_TIMEOUT`, and only after it listens registers Next's cleanup
 * (`server.close`, then exit 143 / 130).
 */
const script = join(import.meta.dir, 'start-standalone.mjs');
const dir = mkdtempSync(join(tmpdir(), 'wms-fe-start-'));

/** A preload that registers an unrelated SIGTERM listener before the start script runs. */
const otherListener = join(dir, 'other-listener.mjs');
writeFileSync(otherListener, "process.on('SIGTERM', () => {});\n");

const startedFixture = join(dir, 'server.mjs');
writeFileSync(startedFixture, "console.log('SERVER STARTED');\n");

/** Next's start-server, reduced: the capture point, the keep-alive setting, the cleanup and its exit codes. */
const nextFixture = join(dir, 'next-like-server.mjs');
writeFileSync(
  nextFixture,
  `import http from 'node:http';
const delay = Number(process.env.FIXTURE_START_DELAY_MS ?? 0);
if (delay > 0) { console.log('BOOTING'); await new Promise((r) => setTimeout(r, delay)); }
const handler = (req, res) => {
  console.log('REQ ' + req.url);
  if (req.url === '/hang') return;
  const answer = () => { res.setHeader('Content-Type', 'text/plain'); res.end('ok ' + req.url); };
  if (req.url === '/slow') setTimeout(answer, Number(process.env.FIXTURE_SLOW_MS ?? 1500));
  else answer();
};
// FIXTURE_UNCAPTURED: build the server without http.createServer (a capture miss).
const server = process.env.FIXTURE_UNCAPTURED ? new http.Server(handler) : http.createServer(handler);
if (process.env.KEEP_ALIVE_TIMEOUT) server.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT);
server.listen(Number(process.env.PORT), '127.0.0.1', () => {
  let started = false;
  const cleanup = (signal) => {
    if (started) return;
    started = true;
    server.close(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  // FIXTURE_NO_CLEANUP: what NEXT_MANUAL_SIG_HANDLE does — Next registers no handler.
  if (!process.env.FIXTURE_NO_CLEANUP) {
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }
  console.log('LISTENING');
});
`,
);

function cleanEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const merged = { ...process.env, ...env };
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) as unknown as NodeJS.ProcessEnv;
}

function start(env: Record<string, string | undefined>) {
  const clean = cleanEnv(env);
  if (env.WMS_API_BASE_URL === undefined) delete clean.WMS_API_BASE_URL;
  return spawnSync('node', [script], { env: { ...clean, WMS_STANDALONE_SERVER: startedFixture } as NodeJS.ProcessEnv, encoding: 'utf8' });
}

async function freePort(): Promise<number> {
  for (;;) {
    const port = 25_000 + Math.floor(Math.random() * 4_000);
    const free = await new Promise<boolean>((resolve) => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
}

type Running = { child: ChildProcess; port: number; output: () => string; exited: Promise<number | null>; waitFor: (text: string) => Promise<void> };

async function run(env: Record<string, string | undefined> = {}, nodeArgs: string[] = []): Promise<Running> {
  const port = await freePort();
  const child = spawn('node', [...nodeArgs, script], {
    env: cleanEnv({
      WMS_API_BASE_URL: 'https://api.example.in/api/v1',
      WMS_STANDALONE_SERVER: nextFixture,
      KEEP_ALIVE_TIMEOUT: '65000',
      PORT: String(port),
      ...env,
    }),
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code: number | null) => resolve(code)));
  const waitFor = async (text: string) => {
    const deadline = Date.now() + 10_000;
    while (!output.includes(text)) {
      if (Date.now() > deadline) throw new Error(`"${text}" never printed; output: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  return { child, port, output: () => output, exited, waitFor };
}

function get(port: number, path: string, agent: Agent): Promise<{ status: number; connection: string | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, agent }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, connection: res.headers.connection, body }));
    });
    req.on('error', reject);
    req.end();
  });
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

  test('unset or invalid: exit 78 (story 6-2c, A18 — was 1) before the server loads; valid: the server starts', () => {
    const unset = start({ WMS_API_BASE_URL: undefined });
    expect(unset.status).toBe(78);
    expect(unset.stderr).toContain('WMS_API_BASE_URL is not set');
    expect(unset.stdout).not.toContain('SERVER STARTED');

    const relative = start({ WMS_API_BASE_URL: '/api/v1' });
    expect(relative.status).toBe(78);
    expect(relative.stdout).not.toContain('SERVER STARTED');

    const valid = start({ WMS_API_BASE_URL: 'https://api.example.in/api/v1' });
    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain('SERVER STARTED');
  });

  test('WEB_SHUTDOWN_FORCE_EXIT_MS: default 25 000; a bad value refuses the start (78)', () => {
    expect(parseForceExitMs(undefined)).toBe(25_000);
    expect(parseForceExitMs('')).toBe(25_000);
    expect(parseForceExitMs('500')).toBe(500);
    expect(parseForceExitMs('25000')).toBe(25_000);
    // Above 25 000 the 30 s stop timeout SIGKILLs first; past 2^31 the timer overflows.
    for (const bad of ['0', '-1', 'abc', '1.5', '25001', '60000', '4294967296']) expect(typeof parseForceExitMs(bad)).toBe('string');
    const refused = start({ WMS_API_BASE_URL: 'https://api.example.in/api/v1', WEB_SHUTDOWN_FORCE_EXIT_MS: 'soon' });
    expect(refused.status).toBe(78);
    expect(refused.stderr).toContain('WEB_SHUTDOWN_FORCE_EXIT_MS');
    expect(refused.stdout).not.toContain('SERVER STARTED');
  });
});

describe('the bounded drain (story 6-2c, decision 7, A1, A12)', () => {
  test('a keep-alive request in flight at SIGTERM is answered with Connection: close, and the process exits 0 well under 5 s', async () => {
    const r = await run({ FIXTURE_SLOW_MS: '1500' });
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      await r.waitFor('LISTENING');
      const first = await get(r.port, '/', agent);
      expect(first.connection).toBe('keep-alive'); // a kept-alive socket (65 s) before the signal
      const inFlight = get(r.port, '/slow', agent);
      await r.waitFor('REQ /slow');
      const signalledAt = Date.now();
      r.child.kill('SIGTERM');
      const answer = await inFlight;
      expect(answer).toMatchObject({ status: 200, connection: 'close', body: 'ok /slow' });
      expect(await r.exited).toBe(0);
      expect(Date.now() - signalledAt).toBeLessThan(5_000);
    } finally {
      agent.destroy();
      r.child.kill('SIGKILL');
    }
  }, 20_000);

  test('a request that never finishes: the bound ends the process with 75', async () => {
    const r = await run({ WEB_SHUTDOWN_FORCE_EXIT_MS: '700' });
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      await r.waitFor('LISTENING');
      get(r.port, '/hang', agent).catch(() => undefined);
      await r.waitFor('REQ /hang');
      const signalledAt = Date.now();
      r.child.kill('SIGTERM');
      expect(await r.exited).toBe(75);
      expect(Date.now() - signalledAt).toBeGreaterThanOrEqual(600);
      expect(r.output()).toContain('forcing exit 75');
    } finally {
      agent.destroy();
      r.child.kill('SIGKILL');
    }
  }, 20_000);

  test('an idle server: SIGTERM exits 0 at once', async () => {
    const r = await run();
    await r.waitFor('LISTENING');
    const signalledAt = Date.now();
    r.child.kill('SIGTERM');
    expect(await r.exited).toBe(0);
    expect(Date.now() - signalledAt).toBeLessThan(2_000);
  }, 20_000);

  test('an early SIGTERM — before the server exists or listens — exits 0 at once (A12)', async () => {
    const r = await run({ FIXTURE_START_DELAY_MS: '3000' });
    await r.waitFor('BOOTING');
    const signalledAt = Date.now();
    r.child.kill('SIGTERM');
    expect(await r.exited).toBe(0);
    expect(Date.now() - signalledAt).toBeLessThan(2_000);
    expect(r.output()).not.toContain('LISTENING');
  }, 20_000);

  async function inFlightAtSigterm(env: Record<string, string | undefined>, nodeArgs: string[] = []) {
    const r = await run({ FIXTURE_SLOW_MS: '1500', WEB_SHUTDOWN_FORCE_EXIT_MS: '8000', ...env }, nodeArgs);
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      await r.waitFor('LISTENING');
      await get(r.port, '/', agent);
      const inFlight = get(r.port, '/slow', agent);
      await r.waitFor('REQ /slow');
      const signalledAt = Date.now();
      r.child.kill('SIGTERM');
      const answer = await inFlight;
      const code = await r.exited;
      return { answer, code, elapsed: Date.now() - signalledAt, output: r.output() };
    } finally {
      agent.destroy();
      r.child.kill('SIGKILL');
    }
  }

  test('no Next cleanup registered (NEXT_MANUAL_SIG_HANDLE): the request still finishes with Connection: close; the script closes the server, exit 0', async () => {
    const result = await inFlightAtSigterm({ FIXTURE_NO_CLEANUP: '1' });
    expect(result.answer).toMatchObject({ status: 200, connection: 'close', body: 'ok /slow' });
    expect(result.code).toBe(0);
    expect(result.elapsed).toBeLessThan(5_000);
    expect(result.output).toContain("Next's SIGTERM cleanup is not registered");
  }, 20_000);

  test('an unrelated SIGTERM listener is not taken for Next\'s cleanup (identity, not a count)', async () => {
    const result = await inFlightAtSigterm({ FIXTURE_NO_CLEANUP: '1' }, ['--import', otherListener]);
    expect(result.answer).toMatchObject({ status: 200, connection: 'close' });
    expect(result.code).toBe(0); // a count would have waited for a Next exit that never comes → 75
    expect(result.elapsed).toBeLessThan(5_000);
  }, 20_000);

  test('a capture miss is logged loudly after server.js loads', async () => {
    const r = await run({ FIXTURE_UNCAPTURED: '1' });
    try {
      await r.waitFor('LISTENING');
      await r.waitFor('the server was not captured');
    } finally {
      r.child.kill('SIGKILL');
    }
  }, 20_000);

  test('SIGINT keeps Next\'s 130 (only SIGTERM\'s 143 maps to 0)', async () => {
    const r = await run();
    await r.waitFor('LISTENING');
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(130);
  }, 20_000);
});

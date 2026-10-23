/* global URL, process, console, setTimeout, setImmediate -- a Node script outside the browser lint config */
/**
 * Story 6-2a, code review C6 — the image's start. It refuses to serve
 * without a usable `WMS_API_BASE_URL`: unset or not an absolute http(s)
 * URL, every browser would silently fall back to the build default
 * (`http://localhost:3000/api/v1`) and no request would reach the API.
 * Valid, it hands over to Next's standalone `server.js` (copied beside this
 * file in the image).
 *
 * Story 6-2c (decision 7, A1, A12, A18) — and it bounds and completes Next's
 * SIGTERM drain. Next's own cleanup stays (`server.close`, then
 * `nextServer.close`, then exit 143); around it:
 *
 *  - the drain stops keep-alive (A1): `http.createServer` is wrapped BEFORE
 *    `server.js` loads (Next calls `_http.default.createServer`), so the
 *    server Next creates is captured. On SIGTERM: `keepAliveTimeout = 1`,
 *    `Connection: close` on every response not yet sent, and the idle
 *    connections closed after each response finishes. Without it a
 *    keep-alive client with a request in flight holds `server.close` open
 *    until the 65 s keep-alive timeout;
 *  - a bound: an unref'd `WEB_SHUTDOWN_FORCE_EXIT_MS` timer (default 25 000)
 *    that exits 75 (the drain-timeout code);
 *  - exit codes: Next's 143 (SIGTERM) is mapped to 0 — only after this
 *    script's own listener saw the SIGTERM; SIGINT's 130 stays;
 *  - an early SIGTERM (A12) — before the server exists or listens — exits 0
 *    at once; a listening server whose Next cleanup is not registered
 *    (identified by listener identity) is closed here, then exit 0.
 *
 * Exit codes: 0 graceful stop · 78 a bad WMS_API_BASE_URL or
 * WEB_SHUTDOWN_FORCE_EXIT_MS (config refusal) · 75 the drain bound · 130 SIGINT.
 *
 *   node start-standalone.mjs        # CMD of the wms-fe image
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const EXIT_CONFIG_REFUSAL = 78;
export const EXIT_DRAIN_TIMEOUT = 75;
export const DEFAULT_SHUTDOWN_FORCE_EXIT_MS = 25_000;
/**
 * The ceiling: the orchestrator's stop timeout (30 s) must stay at least the
 * bound + 5 s, or it SIGKILLs the drain first (and a value past 2^31 would
 * overflow the timer).
 */
export const MAX_SHUTDOWN_FORCE_EXIT_MS = 25_000;

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

/** `WEB_SHUTDOWN_FORCE_EXIT_MS`: unset/empty → 25 000; else an integer 1–25 000, or a problem string. */
export function parseForceExitMs(raw) {
  if (raw === undefined || raw === '') return DEFAULT_SHUTDOWN_FORCE_EXIT_MS;
  if (!/^\d+$/.test(raw) || Number(raw) <= 0 || Number(raw) > MAX_SHUTDOWN_FORCE_EXIT_MS) {
    return `WEB_SHUTDOWN_FORCE_EXIT_MS must be an integer of milliseconds from 1 to ${MAX_SHUTDOWN_FORCE_EXIT_MS} (got "${raw}")`;
  }
  return Number(raw);
}

/**
 * Installs the drain around Next's standalone server. Must run before
 * `server.js` is imported. Returns the state (tests).
 */
export function installDrain({ forceExitMs, log = (line) => console.error(line) }) {
  const realExit = process.exit.bind(process);
  // `preexisting`: the SIGTERM listeners in place before server.js loads (ours
  // included). Next's own cleanup is then identified as a listener NOT in it.
  const state = { server: undefined, sigterm: false, draining: false, open: new Set(), preexisting: new Set() };

  const markClose = (res) => {
    if (!res.headersSent) res.setHeader('Connection', 'close');
  };

  // A1: capture the server Next creates (on the module object Next's CJS
  // `require('http')` returns — the same object as this default import).
  const createServer = http.createServer;
  http.createServer = function capturedCreateServer(...args) {
    const server = createServer.apply(this, args);
    if (state.server === undefined) {
      state.server = server;
      server.on('request', (_req, res) => {
        state.open.add(res);
        if (state.draining) markClose(res);
        const done = () => {
          state.open.delete(res);
          if (state.draining) setImmediate(() => server.closeIdleConnections?.());
        };
        res.once('finish', done);
        res.once('close', done);
      });
    }
    return server;
  };

  // Next exits 143 after its SIGTERM cleanup: a graceful stop is 0. Mapped
  // only when THIS listener saw the SIGTERM (a 143 from anything else stays).
  process.exit = (code) => realExit(code === 143 && state.sigterm ? 0 : code);

  const onSigterm = () => {
    if (state.sigterm) return;
    state.sigterm = true;
    const server = state.server;
    // A12: nothing to drain yet — no server, or not listening.
    if (server === undefined || !server.listening) {
      log('SIGTERM before the server was serving — exiting 0');
      realExit(0);
      return;
    }
    state.draining = true;
    // Next's cleanup, by identity: a SIGTERM listener added after server.js
    // began loading. Without one (not registered yet, or
    // NEXT_MANUAL_SIG_HANDLE), this script closes the server itself — the
    // in-flight requests still finish — and exits 0 once it has closed.
    const nextCleanup = process.listeners('SIGTERM').filter((listener) => !state.preexisting.has(listener));
    if (nextCleanup.length === 0) {
      log("Next's SIGTERM cleanup is not registered — closing the server here");
      server.close(() => realExit(0));
    }
    server.keepAliveTimeout = 1;
    for (const res of state.open) markClose(res);
    server.closeIdleConnections?.();
    const timer = setTimeout(() => {
      log(`Graceful shutdown did not finish within ${forceExitMs}ms — forcing exit ${EXIT_DRAIN_TIMEOUT}`);
      realExit(EXIT_DRAIN_TIMEOUT);
    }, forceExitMs);
    timer.unref();
  };
  process.on('SIGTERM', onSigterm);
  state.preexisting = new Set(process.listeners('SIGTERM'));

  return state;
}

/** After server.js loaded: say so loudly when the server was not captured (the drain cannot stop keep-alive). */
export function warnIfUncaptured(state, log = (line) => console.warn(line)) {
  if (state.server === undefined) {
    log(
      'start-standalone: the server was not captured through http.createServer — a SIGTERM will exit 0 at once, ' +
        'without draining in-flight requests (has Next changed how it creates its server?)',
    );
  }
}

// Only when run as the entry point (a test imports the rules above).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problem = apiBaseUrlProblem(process.env.WMS_API_BASE_URL);
  if (problem !== null) {
    console.error(`${problem} — the browser's API base, e.g. https://api.example.in/api/v1 (docs/design/DEPLOY.md). Refusing to start.`);
    process.exit(EXIT_CONFIG_REFUSAL);
  }
  const forceExitMs = parseForceExitMs(process.env.WEB_SHUTDOWN_FORCE_EXIT_MS);
  if (typeof forceExitMs === 'string') {
    console.error(`${forceExitMs}. Refusing to start.`);
    process.exit(EXIT_CONFIG_REFUSAL);
  }
  const state = installDrain({ forceExitMs });
  await import(process.env.WMS_STANDALONE_SERVER ?? './server.js');
  // Next's startServer creates its server synchronously while server.js is evaluated.
  warnIfUncaptured(state);
}

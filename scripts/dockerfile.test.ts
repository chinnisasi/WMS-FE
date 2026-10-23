import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Story 6-2c (decision 9, decision 10, A19) — every base image is a literal
 * `image:tag-alpine@sha256:<digest>` (no build ARG in a FROM), the Bun tag
 * equals `.bun-version`, the Node tag is `22-alpine`; and the runtime code
 * is root-owned (no `--chown`), only `.next/cache` handed to `node`.
 */
const ROOT = join(import.meta.dir, '..');

export function fromLines(dockerfile: string): string[] {
  return dockerfile
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^FROM\s/i.test(line))
    .map((line) => line.replace(/^FROM\s+/i, '').split(/\s+/)[0]!);
}

export function pinProblems(dockerfile: string, bunVersion: string): string[] {
  const problems: string[] = [];
  const images = fromLines(dockerfile);
  if (images.length === 0) problems.push('no FROM line');
  if (/^\s*ARG\s+(BUN|NODE)_VERSION/im.test(dockerfile)) problems.push('a BUN_VERSION/NODE_VERSION build ARG remains');
  for (const image of images) {
    const match = /^([a-z0-9./_-]+):([A-Za-z0-9._-]+)@sha256:([0-9a-f]{64})$/.exec(image);
    if (match === null) {
      problems.push(`${image}: not a literal image:tag@sha256:<64 hex> reference`);
      continue;
    }
    const [, name, tag] = match;
    if (!tag!.endsWith('-alpine')) problems.push(`${image}: not an -alpine variant`);
    if (name === 'oven/bun' && tag !== `${bunVersion}-alpine`) problems.push(`${image}: the Bun tag is not .bun-version (${bunVersion})`);
    if (name === 'node' && tag !== '22-alpine') problems.push(`${image}: the Node tag is not 22-alpine`);
  }
  return problems;
}

describe('the Dockerfile (story 6-2c)', () => {
  const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
  const bunVersion = readFileSync(join(ROOT, '.bun-version'), 'utf8').trim();

  test('every FROM is digest-pinned and -alpine; Bun = .bun-version, Node = 22-alpine', () => {
    const images = fromLines(dockerfile);
    expect(images).toHaveLength(3);
    expect(pinProblems(dockerfile, bunVersion)).toEqual([]);
    expect(images.filter((image) => image.startsWith(`oven/bun:${bunVersion}-alpine@sha256:`))).toHaveLength(1);
    expect(images.filter((image) => image.startsWith('node:22-alpine@sha256:'))).toHaveLength(2);
  });

  test('the check bites: a lost digest, a lost -alpine, a tag drift, an ARG in FROM', () => {
    const digest = '@sha256:' + 'a'.repeat(64);
    expect(pinProblems(`FROM node:22-alpine${digest}\n`, '1.4.2')).toEqual([]);
    expect(pinProblems('FROM node:22-alpine AS build\n', '1.4.2')[0]).toMatch(/not a literal/);
    expect(pinProblems(`FROM node:22${digest}\n`, '1.4.2').join()).toMatch(/-alpine/);
    expect(pinProblems(`FROM node:24-alpine${digest}\n`, '1.4.2')[0]).toMatch(/22-alpine/);
    expect(pinProblems(`FROM oven/bun:1.4.0-alpine${digest} AS bun\n`, '1.4.2')[0]).toMatch(/\.bun-version/);
    expect(pinProblems('ARG NODE_VERSION=22\nFROM node:${NODE_VERSION}-alpine\n', '1.4.2')).toHaveLength(2);
  });

  test('root-owned code: no --chown; only .next/cache is handed to node; the keep-alive is set (decisions 3, 10)', () => {
    expect(dockerfile).not.toMatch(/--chown/);
    expect(dockerfile).toMatch(/^RUN mkdir -p \.next\/cache && chown node:node \.next\/cache$/m);
    expect(dockerfile).toMatch(/KEEP_ALIVE_TIMEOUT=65000/);
    expect(dockerfile).toMatch(/^USER node$/m);
  });

  test('runtime-contract.json carries the image keep-alive and the start script\'s bound (A8)', async () => {
    const contract = JSON.parse(readFileSync(join(ROOT, 'runtime-contract.json'), 'utf8'));
    const { DEFAULT_SHUTDOWN_FORCE_EXIT_MS } = await import('./start-standalone.mjs');
    const keepAlive = Number(/KEEP_ALIVE_TIMEOUT=(\d+)/.exec(dockerfile)?.[1]);
    expect(contract).toEqual({ keepAliveTimeoutMs: keepAlive, shutdownForceExitMs: DEFAULT_SHUTDOWN_FORCE_EXIT_MS });
    expect(keepAlive).toBe(65_000);
  });
});

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Story 6-2c (A15) — the image's code is root-owned and only
 * `/app/.next/cache` is writable (decision 10), which holds only while the app
 * makes no ISR writes: no `export const revalidate`, no `revalidatePath(` and
 * no `revalidateTag(` anywhere under `src/`. Adding one is a deliberate
 * change to the image's writable paths (and its read-only run in CI).
 */
const SRC = join(import.meta.dir, '..', 'src');
const ISR = /export\s+const\s+revalidate\b|\brevalidatePath\s*\(|\brevalidateTag\s*\(/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [path] : [];
  });
}

describe('no ISR writes (story 6-2c, A15)', () => {
  test('the detector bites', () => {
    expect(ISR.test('export const revalidate = 60;')).toBe(true);
    expect(ISR.test("revalidatePath('/orders')")).toBe(true);
    expect(ISR.test("revalidateTag('stock')")).toBe(true);
    expect(ISR.test("export const dynamic = 'force-dynamic';")).toBe(false);
  });

  test('nothing under src/ revalidates', () => {
    const offenders = files(SRC)
      .filter((path) => ISR.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });
});

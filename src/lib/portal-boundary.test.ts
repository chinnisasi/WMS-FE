import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/**
 * Story 21-11b (retro F1) — the portal boundary, enforced:
 * `frontend/SYSTEM-DESIGN.md` says "no operator type or hook reaches the
 * portal", and nothing pinned it. The leak that broke it was INDIRECT — the
 * portal imported `LineRows` from `inbound/asn-card.tsx`, whose module
 * imported `useAsns`, `useClients` and `useSkuMap` — so a direct-import rule
 * (ESLint `no-restricted-imports`) would have missed it. This walks the
 * import graph TRANSITIVELY from every portal entry file:
 *
 * - entries: `components/portal/**`, `app/(portal)/**`, `lib/portal.ts`,
 *   `lib/use-portal.ts`; test files (`*.test.*`, `lib/test/**`) are
 *   excluded from the entries AND the walk (`portal.test.tsx` imports the
 *   operator shell on purpose);
 * - resolves `@/…` and relative specifiers (`.ts`, `.tsx`, `index`);
 * - counts `import type` (a type import is still an operator dependency) and
 *   follows `export … from` (so a re-export cannot launder one);
 * - fails on any reached module that is a `lib/use-*.ts` other than
 *   `use-portal.ts`, or a `components/*` outside the shared allowlist —
 *   printing the import chain that reached it.
 *
 * It must never drop an edge silently: comments are stripped before
 * matching (a comment inside an import clause would hide it), an `@/` or
 * relative specifier that resolves to nothing throws (it is not a package),
 * and every reached file's specifier count is cross-checked against an
 * independent count, so a pattern miss fails loudly.
 *
 * Pure `lib/*` helpers (non-hook) stay allowed: they are shared by design.
 */

const SRC = join(import.meta.dir, '..');

/** Components a portal page may reach (paths under `components/`, no extension). */
const ALLOWED_COMPONENTS = ['portal/', 'shared/', 'data-table/', 'feedback/', 'auth/sign-out', 'kpi-tile', 'reports/service-tiles'];

function isTestFile(path: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(path) || path.startsWith('lib/test/');
}

/** Why `path` (relative to `src/`) may not be reached from the portal — or null when it may. */
export function offence(path: string): string | null {
  const bare = path.replace(/\.(tsx?|jsx?)$/, '');
  if (/^lib\/(.*\/)?use-[^/]+$/.test(bare) && bare !== 'lib/use-portal') return 'an operator hook module';
  if (bare.startsWith('components/')) {
    const rest = bare.slice('components/'.length);
    const allowed = ALLOWED_COMPONENTS.some((prefix) => (prefix.endsWith('/') ? rest.startsWith(prefix) : rest === prefix));
    if (!allowed) return 'an operator component';
  }
  return null;
}

const SPECIFIER =
  /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * `source` with its line and block comments removed, string literals kept (a
 * `//` inside a quoted URL is not a comment). Quoted strings never span a
 * line, so a stray quote in a regex literal cannot swallow the file.
 */
export function stripComments(source: string): string {
  return source.replace(
    /('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match: string, literal: string | undefined) => literal ?? (match.startsWith('/*') ? match.replace(/[^\n]/g, ' ') : ''),
  );
}

/** Every module specifier in `source`: `import`, `import type`, side-effect imports, `export … from`, `import()`. */
export function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of stripComments(source).matchAll(SPECIFIER)) found.push((match[1] ?? match[2])!);
  return found;
}

/**
 * An independent count of the same specifiers — `from '…'`, a side-effect
 * `import '…'` and `import('…')`, by plain token search rather than the
 * clause-shaped `SPECIFIER` — so a clause the main pattern misses fails
 * loudly instead of dropping an edge.
 */
export function independentCount(source: string): number {
  const code = stripComments(source);
  // `from` as a keyword: after whitespace or `}`, never inside quotes (`'from' | 'to'`).
  const froms = code.match(/(?:^|[\s}])from\s*['"][^'"\n]+['"]/g)?.length ?? 0;
  const sideEffects = code.match(/(?:^|[\s;])import\s*['"][^'"\n]+['"]/g)?.length ?? 0;
  const dynamic = code.match(/\bimport\(\s*['"][^'"\n]+['"]\s*\)/g)?.length ?? 0;
  return froms + sideEffects + dynamic;
}

/**
 * Resolve a specifier from `from` (relative to `src/`) to a file relative to
 * `src/`; null for a package or an existing non-code asset (`.css`, `.json`).
 * An `@/` or relative specifier that resolves to nothing THROWS — skipping it
 * as if it were a package would drop an edge silently.
 */
function resolve(from: string, specifier: string, exists: (path: string) => boolean): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = specifier.slice(2);
  else if (specifier.startsWith('.')) base = join(dirname(from), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.(tsx?|jsx?)$/.test(candidate) && exists(candidate)) return candidate;
  }
  if (/\.(css|json|svg|png)$/.test(base) && exists(base)) return null;
  throw new Error(`portal-boundary: '${specifier}' in ${from} resolves to no file`);
}

export interface Violation {
  readonly module: string;
  readonly why: string;
  readonly chain: readonly string[];
}

/**
 * Walk the import graph from `entries` (paths relative to `src/`), breadth
 * first so each reported chain is a shortest one. Offenders are reported and
 * still followed, so one bad import shows everything it drags in.
 */
export function walk(
  entries: readonly string[],
  read: (path: string) => string = (path) => readFileSync(join(SRC, path), 'utf8'),
  exists: (path: string) => boolean = (path) => existsSync(join(SRC, path)) && statSync(join(SRC, path)).isFile(),
): Violation[] {
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const entry of entries) {
    if (!parent.has(entry)) {
      parent.set(entry, null);
      queue.push(entry);
    }
  }
  const violations: Violation[] = [];
  while (queue.length > 0) {
    const module = queue.shift()!;
    const why = offence(module);
    if (why !== null) {
      const chain: string[] = [];
      for (let at: string | null | undefined = module; at != null; at = parent.get(at)) chain.unshift(at);
      violations.push({ module, why, chain });
    }
    const source = read(module);
    const found = specifiers(source);
    const counted = independentCount(source);
    if (found.length !== counted) {
      throw new Error(`portal-boundary: ${module} — the specifier scan found ${found.length}, the independent count ${counted}`);
    }
    for (const specifier of found) {
      const next = resolve(module, specifier, exists);
      if (next === null || isTestFile(next) || parent.has(next)) continue;
      parent.set(next, module);
      queue.push(next);
    }
  }
  return violations;
}

function filesUnder(dir: string): string[] {
  const absolute = join(SRC, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { recursive: true, encoding: 'utf8' })
    .map((name) => relative(SRC, join(absolute, name)))
    .filter((path) => /\.(tsx?|jsx?)$/.test(path) && statSync(join(SRC, path)).isFile());
}

/** The portal's entry files, tests excluded. */
export function portalEntries(): string[] {
  return [...filesUnder('components/portal'), ...filesUnder('app/(portal)'), 'lib/portal.ts', 'lib/use-portal.ts']
    .filter((path) => !isTestFile(path))
    .sort();
}

function report(violations: readonly Violation[]): string {
  return violations.map((v) => `${v.module} (${v.why}), reached by: ${v.chain.join(' → ')}`).join('\n');
}

describe('portal boundary — no operator hook or component reaches the portal', () => {
  test('the entries are the portal pages, the portal route group and the two portal lib modules — tests excluded', () => {
    const entries = portalEntries();
    expect(entries).toContain('components/portal/portal-inbound.tsx');
    // Story 4-7a — the returns page and its route.
    expect(entries).toContain('components/portal/portal-returns.tsx');
    expect(entries).toContain('app/(portal)/portal/returns/page.tsx');
    // Story 3-7a — the recalls page and its route (it reaches the shared recall pieces and pure lib/recalls only).
    expect(entries).toContain('components/portal/portal-recalls.tsx');
    expect(entries).toContain('app/(portal)/portal/recalls/page.tsx');
    expect(entries).toContain('app/(portal)/layout.tsx');
    expect(entries).toContain('lib/portal.ts');
    expect(entries).toContain('lib/use-portal.ts');
    expect(entries.some(isTestFile)).toBe(false);
  });

  test('story 2-3b — DetailDrawer and StatusChip are portal-allowed (2-3c portal booking reuses them)', () => {
    expect(report(walk(['components/shared/detail-drawer.tsx', 'components/shared/status-chip.tsx']))).toBe('');
  });

  test('nothing reachable from a portal entry is an operator hook module or an operator component', () => {
    const violations = walk(portalEntries());
    // On failure, the message names each offender and the chain that reached it.
    expect(report(violations)).toBe('');
  });

  test('the detector flags the old route: a portal file importing LineRows from inbound/asn-card', () => {
    const fixture = 'components/portal/__boundary-fixture__.tsx';
    const read = (path: string) =>
      path === fixture ? "import { LineRows } from '@/components/inbound/asn-card';\n" : readFileSync(join(SRC, path), 'utf8');
    const exists = (path: string) => path === fixture || (existsSync(join(SRC, path)) && statSync(join(SRC, path)).isFile());
    const violations = walk([fixture], read, exists);
    const byModule = new Map(violations.map((v) => [v.module, v]));
    expect(byModule.get('components/inbound/asn-card.tsx')?.chain).toEqual([fixture, 'components/inbound/asn-card.tsx']);
    // ...and the operator hooks it drags in, each with its chain.
    for (const hook of ['lib/use-asns.ts', 'lib/use-clients.ts', 'lib/use-inbound.ts']) {
      expect(byModule.get(hook)?.chain.slice(0, 3)).toEqual([fixture, 'components/inbound/asn-card.tsx', hook]);
    }
    expect(report(violations)).toContain(`${fixture} → components/inbound/asn-card.tsx`);
  });

  test('a comment inside an import clause cannot hide it (detector)', () => {
    const fixture = 'components/portal/__comment-fixture__.tsx';
    const read = (path: string) =>
      path === fixture
        ? "import {\n  // the announce form's rows\n  LineRows, /* generic */\n} from '@/components/inbound/asn-card';\n"
        : readFileSync(join(SRC, path), 'utf8');
    const exists = (path: string) => path === fixture || (existsSync(join(SRC, path)) && statSync(join(SRC, path)).isFile());
    expect(walk([fixture], read, exists).map((v) => v.module)).toContain('components/inbound/asn-card.tsx');
    // A `//` inside a string is not a comment.
    expect(specifiers("const u = 'http://x'; import { a } from '@/lib/asns';")).toEqual(['@/lib/asns']);
  });

  test('an unresolvable @/ or relative specifier throws, naming it and its file (detector)', () => {
    const fixture = 'components/portal/__missing-fixture__.tsx';
    const exists = (path: string) => path === fixture || (existsSync(join(SRC, path)) && statSync(join(SRC, path)).isFile());
    const alias = (path: string) => (path === fixture ? "import { gone } from '@/lib/no-such-module';\n" : readFileSync(join(SRC, path), 'utf8'));
    expect(() => walk([fixture], alias, exists)).toThrow(`'@/lib/no-such-module' in ${fixture}`);
    const rel = (path: string) => (path === fixture ? "export * from './nowhere';\n" : readFileSync(join(SRC, path), 'utf8'));
    expect(() => walk([fixture], rel, exists)).toThrow(`'./nowhere' in ${fixture}`);
  });

  test('a clause the specifier pattern misses fails loudly through the independent count', () => {
    const fixture = 'components/portal/__count-fixture__.tsx';
    // A clause shape SPECIFIER does not accept (a `=` in the clause): the scan finds 0, the count 1.
    const read = (path: string) => (path === fixture ? "import x = y from '@/lib/asns';\n" : readFileSync(join(SRC, path), 'utf8'));
    const exists = (path: string) => path === fixture || (existsSync(join(SRC, path)) && statSync(join(SRC, path)).isFile());
    expect(() => walk([fixture], read, exists)).toThrow('independent count 1');
  });

  test('type imports and re-exports are followed', () => {
    expect(specifiers("import type { A } from '@/lib/use-outbound-orders';")).toEqual(['@/lib/use-outbound-orders']);
    expect(specifiers("export { Section } from '@/components/shared/surface';")).toEqual(['@/components/shared/surface']);
    expect(specifiers("export * from './x';\nimport './side-effect';")).toEqual(['./x', './side-effect']);
    expect(specifiers("import {\n  a,\n  type B,\n} from '@/lib/asns';")).toEqual(['@/lib/asns']);
    // A re-export from an allowed-looking module still reaches what it re-exports.
    const fixture = 'components/portal/__reexport-fixture__.tsx';
    const read = (path: string) =>
      path === fixture ? "import { ReadFailure } from '@/components/outbound/shell';\n" : readFileSync(join(SRC, path), 'utf8');
    const exists = (path: string) => path === fixture || (existsSync(join(SRC, path)) && statSync(join(SRC, path)).isFile());
    expect(walk([fixture], read, exists).map((v) => v.module)).toContain('components/outbound/shell.tsx');
  });

  test('the allowlist: shared primitives and pure lib helpers pass; operator hooks and components do not', () => {
    expect(offence('lib/use-portal.ts')).toBeNull();
    expect(offence('lib/portal.ts')).toBeNull();
    expect(offence('lib/resource-state.ts')).toBeNull();
    expect(offence('components/shared/surface.tsx')).toBeNull();
    expect(offence('components/kpi-tile.tsx')).toBeNull();
    expect(offence('components/auth/sign-out.tsx')).toBeNull();
    expect(offence('components/reports/service-tiles.tsx')).toBeNull();
    expect(offence('lib/use-outbound-orders.ts')).not.toBeNull();
    expect(offence('lib/reports/use-anything.ts')).not.toBeNull();
    expect(offence('components/outbound/shell.tsx')).not.toBeNull();
    expect(offence('components/auth/auth-forms.tsx')).not.toBeNull();
    expect(offence('components/reports/client-service.tsx')).not.toBeNull();
  });
});

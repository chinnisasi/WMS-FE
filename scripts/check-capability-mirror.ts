/**
 * Capability-mirror drift guard (story 4.2b).
 *
 * `src/lib/users.ts` is a hand-maintained mirror of wms-be's
 * `src/modules/tenancy/permissions.ts`. Nothing enforced that: `stock.adjust`,
 * `vendor.manage` and `po.manage` were missing from epics 2–3 until story
 * 4.2b noticed, and `users.test.ts` cannot catch it because it only restates
 * the file under test. This reads the backend's own source and fails naming
 * exactly what drifted.
 *
 * Run: `bun run check:capability-mirror` (CI runs it in the `generated-client`
 * job, which already checks wms-be out into the workspace layout).
 */
import { CAPABILITIES, ROLE_CAPABILITIES } from '../src/lib/users';

const PERMISSIONS_PATH = '../../../backend/wms-be/src/modules/tenancy/permissions.ts';  // resolved from scripts/, i.e. the meta-repo workspace layout
const ROLES = ['owner', 'ops_manager', 'operator', 'accountant'] as const;

/** Comments carry capability names in prose; they are not grants. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function quotedStrings(block: string): string[] {
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

/** The text between a named declaration's first `[` and its matching `]`. */
function arrayLiteralAfter(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  if (start === -1) throw new Error(`permissions.ts no longer declares ${declaration}`);
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  if (open === -1 || close === -1) throw new Error(`Could not read the ${declaration} array`);
  return source.slice(open + 1, close);
}

function difference(a: readonly string[], b: readonly string[]): string[] {
  const other = new Set(b);
  return a.filter((entry) => !other.has(entry));
}

function report(what: string, mine: readonly string[], theirs: readonly string[]): string[] {
  const missing = difference(theirs, mine);
  const extra = difference(mine, theirs);
  const problems: string[] = [];
  if (missing.length > 0) problems.push(`${what}: missing from wms-fe — ${missing.join(', ')}`);
  if (extra.length > 0) problems.push(`${what}: not granted by wms-be — ${extra.join(', ')}`);
  return problems;
}

const source = stripComments(await Bun.file(new URL(PERMISSIONS_PATH, import.meta.url)).text());
const backendCapabilities = quotedStrings(arrayLiteralAfter(source, 'export const CAPABILITIES'));

const rolesBlock = source.slice(source.indexOf('export const ROLE_CAPABILITIES'));
const backendGrants = new Map<string, string[]>();
for (const role of ROLES) {
  const at = rolesBlock.indexOf(`${role}:`);
  if (at === -1) throw new Error(`permissions.ts no longer grants a set to ${role}`);
  const set = rolesBlock.slice(at, rolesBlock.indexOf(')', at));
  // `owner: new Set<Capability>(CAPABILITIES)` names no members of its own.
  backendGrants.set(role, set.includes('(CAPABILITIES') ? backendCapabilities : quotedStrings(set));
}

const problems = [
  ...report('CAPABILITIES', CAPABILITIES, backendCapabilities),
  ...ROLES.flatMap((role) => report(role, ROLE_CAPABILITIES[role], backendGrants.get(role)!)),
];

if (problems.length > 0) {
  console.error('The wms-fe capability mirror has drifted from wms-be permissions.ts:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nFix src/lib/users.ts (CAPABILITIES and/or ROLE_CAPABILITIES) to match.');
  process.exit(1);
}

console.warn(
  `Capability mirror matches wms-be: ${backendCapabilities.length} capabilities across ${ROLES.length} roles.`,
);

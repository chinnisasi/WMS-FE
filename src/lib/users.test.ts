import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { restoreGlobals, stubGlobal } from './test/globals';

import type { Capability } from './users';
import { notifyUsersChanged, roleHasCapability, ROLE_CAPABILITIES, USERS_CHANGED_EVENT } from './users';

/**
 * The capability matrix contract (story 1.5): this file pins the UI mirror
 * of wms-be's `src/modules/tenancy/permissions.ts`. If the backend matrix
 * changes, these assertions fail first — the mirror must move with it, or a
 * hidden surface hides work a role is actually allowed to do.
 */

let dispatched: string[] = [];

beforeEach(() => {
  dispatched = [];
  // notifyUsersChanged dispatches on window; a minimal shim suffices.
  stubGlobal('window', {
    dispatchEvent: (event: Event) => {
      dispatched.push(event.type);
      return true;
    },
  } as unknown as typeof window);
});

afterEach(() => {
  restoreGlobals();
});

describe('ROLE_CAPABILITIES (UI mirror of wms-be permissions.ts)', () => {
  test('owner holds every capability', () => {
    expect(ROLE_CAPABILITIES.owner.length).toBe(23);
    expect(roleHasCapability('owner', 'warehouse.create')).toBe(true);
    expect(roleHasCapability('owner', 'zone.create')).toBe(true);
    expect(roleHasCapability('owner', 'bin.create')).toBe(true);
    expect(roleHasCapability('owner', 'bin.block')).toBe(true);
    expect(roleHasCapability('owner', 'catalog.import')).toBe(true);
    expect(roleHasCapability('owner', 'sku.edit')).toBe(true);
    expect(roleHasCapability('owner', 'users.invite')).toBe(true);
    expect(roleHasCapability('owner', 'users.role_change')).toBe(true);
    expect(roleHasCapability('owner', 'device.manage')).toBe(true);
    expect(roleHasCapability('owner', 'review.decide')).toBe(true);
    expect(roleHasCapability('owner', 'qc.manage')).toBe(true);
    expect(roleHasCapability('owner', 'putaway.execute')).toBe(true);
    expect(roleHasCapability('owner', 'bin.retire')).toBe(true);
    expect(roleHasCapability('owner', 'stock.adjust')).toBe(true);
    expect(roleHasCapability('owner', 'vendor.manage')).toBe(true);
    expect(roleHasCapability('owner', 'po.manage')).toBe(true);
    expect(roleHasCapability('owner', 'orders.manage')).toBe(true);
    expect(roleHasCapability('owner', 'waves.manage')).toBe(true);
    expect(roleHasCapability('owner', 'picks.execute')).toBe(true);
    expect(roleHasCapability('owner', 'pack.execute')).toBe(true);
    expect(roleHasCapability('owner', 'dispatch.execute')).toBe(true);
    expect(roleHasCapability('owner', 'carrier.manage')).toBe(true);
    expect(roleHasCapability('owner', 'secure.move')).toBe(true);
  });

  test('ops_manager is operationally broad but holds no users capabilities', () => {
    expect(roleHasCapability('ops_manager', 'warehouse.create')).toBe(true);
    expect(roleHasCapability('ops_manager', 'zone.create')).toBe(true);
    expect(roleHasCapability('ops_manager', 'bin.create')).toBe(true);
    expect(roleHasCapability('ops_manager', 'bin.block')).toBe(true);
    expect(roleHasCapability('ops_manager', 'catalog.import')).toBe(true);
    expect(roleHasCapability('ops_manager', 'sku.edit')).toBe(true);
    expect(roleHasCapability('ops_manager', 'users.invite')).toBe(false);
    expect(roleHasCapability('ops_manager', 'users.role_change')).toBe(false);
    expect(roleHasCapability('ops_manager', 'device.manage')).toBe(true);
    expect(roleHasCapability('ops_manager', 'review.decide')).toBe(true);
    expect(roleHasCapability('ops_manager', 'qc.manage')).toBe(true);
    expect(roleHasCapability('ops_manager', 'putaway.execute')).toBe(true);
    expect(roleHasCapability('ops_manager', 'bin.retire')).toBe(true);
    expect(roleHasCapability('ops_manager', 'stock.adjust')).toBe(true);
    expect(roleHasCapability('ops_manager', 'vendor.manage')).toBe(true);
    expect(roleHasCapability('ops_manager', 'po.manage')).toBe(true);
    expect(roleHasCapability('ops_manager', 'orders.manage')).toBe(true);
    expect(roleHasCapability('ops_manager', 'waves.manage')).toBe(true);
    expect(roleHasCapability('ops_manager', 'picks.execute')).toBe(true);
    expect(roleHasCapability('ops_manager', 'pack.execute')).toBe(true);
    expect(roleHasCapability('ops_manager', 'dispatch.execute')).toBe(true);
    expect(roleHasCapability('ops_manager', 'carrier.manage')).toBe(true);
    expect(roleHasCapability('ops_manager', 'secure.move')).toBe(true);
    // Membership, spelled out — a length check passes a list of the right
    // size with the wrong member in it, which is the drift this file exists
    // to catch. The expected set is written here rather than derived from
    // the implementation, so the assertion is not a tautology.
    expect([...ROLE_CAPABILITIES.ops_manager].sort()).toEqual(
      ([
        'warehouse.create',
        'zone.create',
        'bin.create',
        'bin.block',
        'catalog.import',
        'sku.edit',
        'stock.adjust',
        'vendor.manage',
        'po.manage',
        'device.manage',
        'review.decide',
        'qc.manage',
        'putaway.execute',
        'bin.retire',
        'orders.manage',
        'waves.manage',
        'picks.execute',
        'pack.execute',
        'dispatch.execute',
        'carrier.manage',
        'secure.move',
      ] as const satisfies readonly Capability[])
        .slice()
        .sort(),
    );
  });

  test('operator holds exactly the four floor verbs; accountant is read-only', () => {
    // Story 3.5 opened the operator column with `putaway.execute`; stories
    // 4.3 / 4.5 / 4.6 added pick, pack and dispatch. Planning verbs
    // (orders, waves) stay out — an Operator executes, it does not plan.
    expect(ROLE_CAPABILITIES.operator).toEqual([
      'putaway.execute',
      'picks.execute',
      'pack.execute',
      'dispatch.execute',
    ]);
    expect(roleHasCapability('operator', 'putaway.execute')).toBe(true);
    expect(roleHasCapability('operator', 'warehouse.create')).toBe(false);
    expect(roleHasCapability('operator', 'users.invite')).toBe(false);
    expect(roleHasCapability('operator', 'sku.edit')).toBe(false);
    expect(roleHasCapability('operator', 'orders.manage')).toBe(false);
    expect(roleHasCapability('operator', 'waves.manage')).toBe(false);
    // Story 4.6b — configuring a carrier account is settings work, not a
    // floor verb: the operator column stays at four.
    expect(roleHasCapability('operator', 'carrier.manage')).toBe(false);
    expect(ROLE_CAPABILITIES.accountant.length).toBe(0);
    expect(roleHasCapability('accountant', 'putaway.execute')).toBe(false);
    expect(roleHasCapability('accountant', 'users.invite')).toBe(false);
    expect(roleHasCapability('accountant', 'orders.manage')).toBe(false);
  });

  test('users.invite and users.role_change belong to the owner alone', () => {
    for (const capability of ['users.invite', 'users.role_change'] as const) {
      expect(
        (['owner', 'ops_manager', 'operator', 'accountant'] as const).filter((role) =>
          roleHasCapability(role, capability),
        ),
      ).toEqual(['owner']);
    }
  });

  // Story 3.3 — every over-receipt is decided by owner or ops_manager in v1.
  test('review.decide belongs to owner and ops_manager', () => {
    expect(
      (['owner', 'ops_manager', 'operator', 'accountant'] as const).filter((role) =>
        roleHasCapability(role, 'review.decide'),
      ),
    ).toEqual(['owner', 'ops_manager']);
  });

  // Story 3.4 — the QC hold/release decisions: owner or ops_manager only.
  test('qc.manage belongs to owner and ops_manager', () => {
    expect(
      (['owner', 'ops_manager', 'operator', 'accountant'] as const).filter((role) =>
        roleHasCapability(role, 'qc.manage'),
      ),
    ).toEqual(['owner', 'ops_manager']);
  });

  // Story 3.5 — the placement command's capability (the device holds the
  // mutation; the web surface stays read-only): owner, ops_manager, and —
  // deliberately, the first non-empty operator capability — operator.
  test('putaway.execute belongs to owner, ops_manager, and operator', () => {
    expect(
      (['owner', 'ops_manager', 'operator', 'accountant'] as const).filter((role) =>
        roleHasCapability(role, 'putaway.execute'),
      ),
    ).toEqual(['owner', 'ops_manager', 'operator']);
  });

  // Story 4.6b — the carrier credential vault: a settings capability, owner
  // or ops_manager only (the `device.manage` shape).
  test('carrier.manage belongs to owner and ops_manager', () => {
    expect(
      (['owner', 'ops_manager', 'operator', 'accountant'] as const).filter((role) =>
        roleHasCapability(role, 'carrier.manage'),
      ),
    ).toEqual(['owner', 'ops_manager']);
  });

  // Story 3.6 — merge/retire are terminal administration: owner or
  // ops_manager only (the block toggle stays on `bin.block`).
  test('bin.retire belongs to owner and ops_manager', () => {
    expect(
      (['owner', 'ops_manager', 'operator', 'accountant'] as const).filter((role) =>
        roleHasCapability(role, 'bin.retire'),
      ),
    ).toEqual(['owner', 'ops_manager']);
  });

  // Story 12-3 — FR-42: the secure/cage authority gate. Owner and Ops Manager
  // only — the cage is off-limits to floor staff, so the operator column
  // stays at four.
  test('secure.move belongs to owner and ops_manager — never the floor', () => {
    expect(
      (['owner', 'ops_manager', 'operator', 'accountant'] as const).filter((role) =>
        roleHasCapability(role, 'secure.move'),
      ),
    ).toEqual(['owner', 'ops_manager']);
    expect(roleHasCapability('operator', 'secure.move')).toBe(false);
  });

  // Stories 2.1 / 3.1 — the three capabilities the mirror had simply never
  // grown (the drift story 4.2b closed). Owner and Ops Manager only.
  test('stock.adjust, vendor.manage and po.manage belong to owner and ops_manager', () => {
    for (const capability of ['stock.adjust', 'vendor.manage', 'po.manage'] as const) {
      expect(
        (['owner', 'ops_manager', 'operator', 'accountant'] as const).filter((role) =>
          roleHasCapability(role, capability),
        ),
      ).toEqual(['owner', 'ops_manager']);
    }
  });

  // Story 4.1/4.2 — order and wave planning is a manager verb. The Outbound
  // surface's create form and cancel affordance hang off `orders.manage`, so
  // an Operator session must read the list and see neither.
  test('orders.manage and waves.manage belong to owner and ops_manager — never operator', () => {
    for (const capability of ['orders.manage', 'waves.manage'] as const) {
      expect(
        (['owner', 'ops_manager', 'operator', 'accountant'] as const).filter((role) =>
          roleHasCapability(role, capability),
        ),
      ).toEqual(['owner', 'ops_manager']);
    }
  });

  // Stories 4.3 / 4.5 / 4.6 — the floor executes what the planner released.
  test('picks.execute, pack.execute and dispatch.execute reach the operator', () => {
    for (const capability of ['picks.execute', 'pack.execute', 'dispatch.execute'] as const) {
      expect(
        (['owner', 'ops_manager', 'operator', 'accountant'] as const).filter((role) =>
          roleHasCapability(role, capability),
        ),
      ).toEqual(['owner', 'ops_manager', 'operator']);
    }
  });
});

describe('roleHasCapability (fail-closed)', () => {
  test('an unknown role hides every surface — hiding is recoverable', () => {
    // A pre-1.5 session row or a server render has no role; a wrongly shown
    // form is a broken promise, a hidden one is fixed by the next sign-in.
    expect(roleHasCapability(undefined, 'warehouse.create')).toBe(false);
    expect(roleHasCapability(undefined, 'users.invite')).toBe(false);
  });
});

describe('notifyUsersChanged', () => {
  test('dispatches the users-changed event on window', () => {
    notifyUsersChanged();
    expect(dispatched).toEqual([USERS_CHANGED_EVENT]);
  });
});
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

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
  (globalThis as Record<string, unknown>).window = {
    dispatchEvent: (event: Event) => {
      dispatched.push(event.type);
      return true;
    },
  } as unknown as typeof window;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe('ROLE_CAPABILITIES (UI mirror of wms-be permissions.ts)', () => {
  test('owner holds every capability', () => {
    expect(ROLE_CAPABILITIES.owner.length).toBe(11);
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
  });

  test('operator and accountant are read-only', () => {
    for (const role of ['operator', 'accountant'] as const) {
      expect(ROLE_CAPABILITIES[role].length).toBe(0);
      expect(roleHasCapability(role, 'warehouse.create')).toBe(false);
      expect(roleHasCapability(role, 'users.invite')).toBe(false);
      expect(roleHasCapability(role, 'sku.edit')).toBe(false);
    }
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
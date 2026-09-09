/**
 * Users/roles helpers (Story 1.5) — the change-event broadcaster (same
 * pattern as catalog.ts/zones.ts) plus the UI-side capability mirror.
 *
 * IMPORTANT: ROLE_CAPABILITIES is a **UI mirror** of wms-be's
 * `src/modules/tenancy/permissions.ts`. It hides surfaces the session role
 * cannot act on (hide surfaces, never "blocked" screens) — the backend's
 * per-command DB read stays the only authority; a stale FE role at worst
 * shows a form whose submit answers 403 `role-denied`, never grants one.
 */
import type { UserResponse } from '@/lib/api/generated';

export type UserRole = UserResponse['role'];

export const CAPABILITIES = [
  'warehouse.create',
  'zone.create',
  'bin.create',
  'bin.block',
  'catalog.import',
  'sku.edit',
  'users.invite',
  'users.role_change',
  // Story 3.2 — floor-device lifecycle (mint enrollment codes, revoke).
  'device.manage',
  // Story 3.3 — over-receipt approve/reject (the Conflicts & Reviews queue).
  'review.decide',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const ROLE_CAPABILITIES: Readonly<Record<UserRole, readonly Capability[]>> = {
  owner: CAPABILITIES,
  ops_manager: ['warehouse.create', 'zone.create', 'bin.create', 'bin.block', 'catalog.import', 'sku.edit', 'device.manage', 'review.decide'],
  operator: [],
  accountant: [],
};

/**
 * Whether the session role holds a capability. An unknown role (a legacy
 * session row without `user`, before the /me bootstrap backfills it) hides
 * the gated surfaces — hiding is recoverable by a reload, a wrongly shown
 * form is a broken promise.
 */
export function roleHasCapability(role: UserRole | undefined, capability: Capability): boolean {
  if (role === undefined) return false;
  return ROLE_CAPABILITIES[role].includes(capability);
}

/** Fired on `window` after a users mutation (invite, role change, accept). */
export const USERS_CHANGED_EVENT = 'wms-users-changed';

export function notifyUsersChanged(): void {
  window.dispatchEvent(new Event(USERS_CHANGED_EVENT));
}
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
  // Story 2.1 — the manual stock adjustment (the first ledger movement
  // producer). Owner + Ops Manager.
  'stock.adjust',
  // Story 3.1 — the inbound module's mutations (vendor master data + the PO
  // lifecycle). Owner and Ops Manager only.
  'vendor.manage',
  'po.manage',
  // Story 3.2 — floor-device lifecycle (mint enrollment codes, revoke).
  'device.manage',
  // Story 3.3 — over-receipt approve/reject (the Conflicts & Reviews queue).
  'review.decide',
  // Story 3.4 — QC hold/release (the Inbound surface's QC Holds card): an
  // Ops Manager quarantines a (sku, bin) scope and releases it.
  'qc.manage',
  // Story 3.5 — directed putaway (web reads only; the device holds
  // `putaway.place`). The first non-empty operator capability: operators
  // place stock from the floor, so the mirror hides no putaway surface from
  // them (the web surface is read-only anyway).
  'putaway.execute',
  // Story 3.6 — bin administration (merge + retire; the block toggle stays
  // on `bin.block`): Owner and Ops Manager only — retirement is terminal.
  'bin.retire',
  // Story 4.1 — the outbound module's order mutations (manual entry and
  // ingested-channel creation, both accepted with per-line ATP reservation;
  // cancellation releases the holds). Owner and Ops Manager only — an
  // Operator picks what was planned, it does not plan. Gates the Outbound
  // orders surface's create form and cancel affordance (story 4.2b).
  'orders.manage',
  // Story 4.2 — waves and their policies (generate, release, cancel; a
  // policy IS the wave rule). Owner and Ops Manager only.
  'waves.manage',
  // Story 4.3 — the scan-verified pick command. Owner + Ops Manager +
  // Operator (the floor executes the walk the planner released).
  'picks.execute',
  // Story 4.5 — the pack-station verification command. Owner + Ops Manager +
  // Operator: a Pack Station is a place in the building, and the person
  // standing at it is an Operator.
  'pack.execute',
  // Story 4.6 — the dispatch command, the order's terminal transition. Owner
  // + Ops Manager + Operator, mirroring `pack.execute`: the person who hands
  // the parcel to the courier is the one who packed it.
  'dispatch.execute',
  // Story 12-3 — FR-42's authority gate: every ledger movement that touches a
  // secure/cage-class bin additionally requires `secure.move` (owner + Ops
  // Manager only, the backend's decided matrix). No web surface consumes it
  // yet — the mirror stays in step with the backend so the drift guard keeps
  // passing and the 12-7 admin surface lands with the gate ready.
  'secure.move',
  // Story 4.6b — the carrier credential vault (connect a carrier account,
  // rotate its material, disconnect it). A settings capability like
  // `device.manage`: Owner and Ops Manager only — an API key is not a floor
  // verb. No web surface consumes it yet; the mirror stays in step with the
  // backend so the drift guard keeps passing and the surface that lands next
  // has the gate ready.
  'carrier.manage',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * The only capabilities the Ops Manager does not hold. Stated once, as the
 * implementation of the grant below rather than as a comment above a
 * hand-copied list — a copy drifts the moment a capability is added, which is
 * exactly how this mirror fell eight entries behind in the first place.
 */
const OWNER_ONLY_CAPABILITIES: readonly Capability[] = ['users.invite', 'users.role_change'];

export const ROLE_CAPABILITIES: Readonly<Record<UserRole, readonly Capability[]>> = {
  owner: CAPABILITIES,
  // Every operational mutation, no user management.
  ops_manager: CAPABILITIES.filter((capability) => !OWNER_ONLY_CAPABILITIES.includes(capability)),
  // The floor verbs only: place, pick, pack, dispatch. Notably **not**
  // `orders.manage` — an Operator never creates or cancels an order — and
  // **not** `secure.move` (story 12-3): the cage is off-limits to floor
  // staff.
  operator: ['putaway.execute', 'picks.execute', 'pack.execute', 'dispatch.execute'],
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
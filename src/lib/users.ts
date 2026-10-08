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
  // Manager only, the backend's decided matrix). Story 12-7 made the class
  // itself visible on the web (the bin Edit-class affordance and the
  // cold-chain trace's per-hop class annotation), but the movement gate still
  // has no web surface — moves run through the API and mobile. The mirror
  // stays in step with the backend so the drift guard keeps passing.
  'secure.move',
  // Story 4.6b — the carrier credential vault (connect a carrier account,
  // rotate its material, disconnect it). A settings capability like
  // `device.manage`: Owner and Ops Manager only — an API key is not a floor
  // verb. No web surface consumes it yet; the mirror stays in step with the
  // backend so the drift guard keeps passing and the surface that lands next
  // has the gate ready.
  'carrier.manage',
  // Story 12-5 — the temperature-excursion record (FR-44): Owner + Ops
  // Manager + Operator, mirroring `putaway.execute`'s rationale — recording
  // what the floor observes is a floor verb. It does NOT gate a resolve
  // (that is `review.decide`'s, unchanged — the review queue 12-7 added to
  // /conflicts gates resolve exactly so). Recording itself still has no web
  // surface — 12-8 owns the mobile capture; the mirror stays in step with the
  // backend so the drift guard keeps passing.
  'excursion.record',
  // Story 4.6c — the label station and the manifest closure (Owner + Ops
  // Manager + Operator, mirroring `pack.execute`): the person who packed the
  // parcel is the one who labels and hands it over.
  'labels.execute',
  // Story 5-1 — the transfer-order commands (FR-18/FR-29; the FE mirror
  // catch-up: the 5-1 story shipped backend-only). `transfers.manage` plans
  // and confirms the outbound leg (the planner verbs); `transfers.execute`
  // confirms the inbound leg, the floor verb mirroring
  // `putaway.execute`'s rationale.
  'transfers.manage',
  'transfers.execute',
  // Story 5-2 — FR-19: the approval-flow decisions (approve/reject a pending
  // over-threshold stock adjustment) AND the threshold policy write (the
  // config rides the same capability, per the human-approved decision of
  // 2026-09-28). OWNER-ONLY (see OWNER_ONLY_CAPABILITIES), mirroring
  // `review.decide`'s routing rationale: the ops_manager who may raise the
  // very adjustment must not also hold the pen.
  'adjustments.approve',
  // Story 5-3 — FR-cycle-count's verbs. `counts.manage` plans: the on-demand
  // count create (a planner pointing a bin at a count) AND the per-warehouse
  // policy write (a policy IS the schedule — gating it separately would let
  // a role that cannot manage counts redefine when counts happen, the
  // `waves.manage` rationale). `counts.execute` is the floor verb —
  // submitting the counted quantities through the inbox Count tab, mirroring
  // `transfers.execute`/`picks.execute`: the operator counts what it walks.
  // Neither has a web surface yet (counts run from mobile; the mirror stays
  // in step with the backend so the drift guard keeps passing).
  'counts.manage',
  'counts.execute',
  // Story 5-4 — variances.resolve: the resolution verb for an open count
  // variance — approve-adjust (the explicit stock correction) or recount
  // (the fresh task as the new basis). Owner + Ops Manager (CHECKPOINT 1,
  // ratified 2026-09-29 — one step above the floor that counts). The
  // over-threshold owner-only rule is NOT modelled here: it is a command
  // check on the submit-frozen threshold stamp, not a capability split.
  'variances.resolve',
  // Story 6-1 — the replenishment planning verbs: the per-warehouse reorder
  // policy upsert/delete, the breach dismissal and the suggested-PO submit.
  // Owner + Ops Manager only — a planner verb like `orders.manage`/`drops
  // waves.manage`: an Operator picks stock, it never reorders it. The submit
  // arm re-executes PO creation under `po.manage` (the inbound command
  // re-asserts its own gate), so this capability covers the PLANNING surface;
  // no web verb exists without it that could mint a PO directly.
  'replenishment.manage',
  // Story 7-1 — the channels surface's mutations (connect a sales channel,
  // rotate its credentials, set its standing buffers, disconnect). Owner +
  // Ops Manager only (the backend's decided holder set — channels are not a
  // floor verb and not an accounting verb). The /channels surface is this
  // story's T4; the mirror keeps the drift guard honest either way.
  'channel.manage',
  // Story 8-1 — the manual invoice generate/regenerate, carrying per-line
  // rates for UNPRICED lines (a line priced at order acceptance keeps that
  // frozen rate). Owner + Ops Manager only: pricing a line on a numbered tax
  // document is a finance act, not a floor verb — the Accountant reads every
  // invoice (reads are never gated) but does not set what a buyer is charged.
  // Gates the /compliance Invoices section's pricing panel.
  'invoice.generate',
  // Story 8-2b — the e-way bill paperwork: Part B, the NIC JSON export,
  // recording a returned EWB number, dismiss and gateway generate. Owner +
  // Ops Manager + ACCOUNTANT — the accountant's first write capability, a
  // deliberate exception (e-way paperwork is finance work). Gates the
  // /compliance E-way bills section's row actions and selection.
  'eway.manage',
  // Story 8-2b — the e-way configuration (the per-state threshold overrides
  // and the per-GSTIN e-invoicing flag). OWNER-ONLY.
  'eway.configure',
  // Story 21-2b — client admin: register a client brand, rename it, and
  // correct a SKU's client while it has no history. OWNER-ONLY (a client is
  // a commercial relationship — the person who signs the contract). Gates
  // the Settings clients card's create/rename and the SKU table's "Correct
  // client" action; the client list read stays open to every member.
  'clients.manage',
  // Story 21-3 — rate cards: draft a client's card, edit or discard the
  // draft, activate it from a date, cancel a scheduled card. OWNER +
  // ACCOUNTANT (decision 2 — a client's price list is finance work; this
  // reverses 8-1's "the accountant does not set prices" for the client
  // price list only — `invoice.generate` is unchanged). Ops Manager does NOT
  // hold it (see OPS_EXCLUDED_CAPABILITIES). Gates the Settings rate-cards
  // card's editor and row actions; every member reads the cards.
  'rates.manage',
  // Story 21-5 — client invoices: prepare a client's monthly services
  // invoice drafts, refresh, discard, issue, dispute, settle and void — AND
  // the client tax-details write (legal name, GSTIN, billing address), so
  // whoever clears an invoice's recipient gaps can fix them. OWNER +
  // ACCOUNTANT (the `rates.manage` rationale: billing is finance work). Ops
  // Manager does NOT hold it (see OPS_EXCLUDED_CAPABILITIES). Gates the
  // /compliance Client invoices actions and the clients card's tax-details
  // form; every member reads the invoices.
  'billing.invoice',
  // Story 21-6 — advance shipment notices: create, amend, close (short) and
  // cancel an ASN. Owner + Ops Manager, the `po.manage` holder set (an ASN is
  // the PO's mirror). Gates the Inbound surface's ASN card actions; every
  // member reads ASNs.
  'asn.manage',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * The only capabilities the Ops Manager does not hold. Stated once, as the
 * implementation of the grant below rather than as a comment above a
 * hand-copied list — a copy drifts the moment a capability is added, which is
 * exactly how this mirror fell eight entries behind in the first place.
 */
const OWNER_ONLY_CAPABILITIES: readonly Capability[] = [
  'users.invite',
  'users.role_change',
  // Story 5-2 — the adjustment approval gate: owner-only by the same
  // segregation-of-duties rationale as the user-management verbs.
  'adjustments.approve',
  // Story 8-2b — the e-way thresholds decide which consignments need a bill:
  // the person who sets the bar is the owner.
  'eway.configure',
  // Story 21-2b — client admin is the owner's (the commercial relationship).
  'clients.manage',
];

/**
 * Everything the Ops Manager does not hold: the owner-only capabilities,
 * plus (story 21-3) `rates.manage` — which is NOT owner-only (the accountant
 * holds it too), so it cannot ride the owner-only list. Stated as an
 * explicit set so the computed grant below stays the one place the Ops
 * Manager's exclusions live.
 */
const OPS_EXCLUDED_CAPABILITIES: readonly Capability[] = [
  ...OWNER_ONLY_CAPABILITIES,
  // Story 21-3 — rate cards are the owner's and the accountant's (finance
  // work); the Ops Manager runs the floor and reads the cards.
  'rates.manage',
  // Story 21-5 — client invoices and tax details, the same holder set.
  'billing.invoice',
];

export const ROLE_CAPABILITIES: Readonly<Record<UserRole, readonly Capability[]>> = {
  owner: CAPABILITIES,
  // Every operational mutation, no user management, no rate cards.
  ops_manager: CAPABILITIES.filter((capability) => !OPS_EXCLUDED_CAPABILITIES.includes(capability)),
  // The floor verbs only: place, pick, pack, label, dispatch, record. Notably
  // **not** `orders.manage` — an Operator never creates or cancels an order —
  // and **not** `secure.move` (story 12-3): the cage is off-limits to floor
  // staff.
  operator: [
    'putaway.execute',
    'picks.execute',
    'pack.execute',
    'dispatch.execute',
    'excursion.record',
    'labels.execute',
    // Story 5-1 — the floor confirms the transfer's inbound leg (the
    // Transfer inbox task's op; `putaway.execute`'s rationale).
    'transfers.execute',
    // Story 5-3 — the floor submits the bin's counted quantities (the Count
    // inbox tab's op; the floor-verb pattern — `putaway.execute`'s
    // rationale). Planning stays above: an operator never schedules counts.
    'counts.execute',
  ],
  // Story 8-2b: read-only except the e-way paperwork (finance work); story
  // 21-3: and the client rate cards (finance work); story 21-5: and the
  // client invoices and tax details (finance work).
  accountant: ['eway.manage', 'rates.manage', 'billing.invoice'],
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
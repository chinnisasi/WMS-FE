import { ApiProblem } from '@/lib/api/client';
import type { PicklistDto, PicklistLineDto, WaveDto, WaveEntryDto, WavePolicyDto } from '@/lib/api/generated';
import { quantityLabel, type QuantityUom } from '@/lib/format-quantity';
import { UNREACHABLE_REASON, verbatim, type Outcome } from '@/lib/outbound-orders';

/**
 * Pure copy and derivation for the Outbound waves surface (story 4.2c) —
 * the sibling of `outbound-orders.ts`, and for the same reason: the logic
 * that can be wrong without anyone noticing lives in a function with a test,
 * not in JSX.
 *
 * Three decisions live here:
 *   1. **The carrier-cutoff derivation is the whole reason this file exists.**
 *      The backend computes no at-risk flag and exposes no time-remaining
 *      field, so the browser derives both from the policy's `HH:MM` wall
 *      clock and its IANA zone. `cutoffStatus` takes an injected `now` — the
 *      only way to test "18:00 Asia/Kolkata" from a machine in any timezone,
 *      across a DST transition, and at the midnight rollover where minutes
 *      remaining would otherwise go negative or wrap.
 *   2. **Amber is advisory, never preventive.** `cutoff-passed` is decided by
 *      the server's clock against its own reading of the policy; the browser
 *      is a different clock. Nothing here gates an action — `canReleaseWave`
 *      branches on the wave's STATUS alone and never consults the cutoff.
 *   3. **A refusal the row could not predict is rendered verbatim.** Only two
 *      refusals are knowable from a visible row (release on a cancelled wave,
 *      and the `waves.manage` gate). `cutoff-passed`, the open-wave claim,
 *      `no-eligible-orders` and `wave-cap-exceeded` are all decided by state
 *      no DTO the client holds can show, so the server's own words are what
 *      gets rendered.
 */

/* ------------------------------------------------------------------ */
/* Status vocabulary                                                   */
/* ------------------------------------------------------------------ */

export type WaveStatus = WaveEntryDto['status'];

/** The three lifecycle arms, in plain words (spec: numbers and verbs). */
export const WAVE_STATUS_LABEL: Readonly<Record<WaveStatus, string>> = {
  planned: 'Planned',
  released: 'Released',
  cancelled: 'Cancelled',
};

/**
 * Derived from the label Record, never hand-listed — a new lifecycle arm
 * fails the compile at WAVE_STATUS_LABEL and then appears in the page filter
 * on its own.
 */
export const WAVE_STATUSES = Object.keys(WAVE_STATUS_LABEL) as readonly WaveStatus[];

export function waveStatusLabel(status: WaveStatus): string {
  return WAVE_STATUS_LABEL[status];
}

export type PicklistStatus = PicklistDto['status'];

export const PICKLIST_STATUS_LABEL: Readonly<Record<PicklistStatus, string>> = {
  planned: 'Planned',
  ready: 'Ready to pick',
  cancelled: 'Cancelled',
};

export function picklistStatusLabel(status: PicklistStatus): string {
  return PICKLIST_STATUS_LABEL[status];
}

export type PickLineStatus = PicklistLineDto['status'];

/**
 * Five arms, including the two that are not failures of the picker:
 * `unfulfillable` means nothing pickable was ever found for the slice, and
 * `short` means fewer units moved than were planned (story 4.4).
 */
export const PICK_LINE_STATUS_LABEL: Readonly<Record<PickLineStatus, string>> = {
  planned: 'Planned',
  unfulfillable: 'Nothing to pick',
  picked: 'Picked',
  short: 'Short',
  cancelled: 'Cancelled',
};

export function pickLineStatusLabel(status: PickLineStatus): string {
  return PICK_LINE_STATUS_LABEL[status];
}

/** Story 4.4's fixed reason set, in plain words; `null` on every other line. */
const PICK_REASON_LABEL: Readonly<Record<string, string>> = {
  'bin-empty': 'Bin empty',
  'fewer-units-than-planned': 'Fewer units than planned',
  'damaged-units': 'Damaged units',
  'stock-not-found': 'Stock not found',
  other: 'Other',
};

export function pickReasonLabel(reasonCode: string | null): string | null {
  if (reasonCode === null) return null;
  return PICK_REASON_LABEL[reasonCode] ?? reasonCode;
}

/**
 * Release is offered for exactly one status.
 *
 * `cancelled` is the refusal the row can predict — the backend answers 409
 * for it, and offering an action the server will refuse for a state the row
 * already shows is the rule this exists to keep. `released` is excluded for
 * the softer reason that the wave already made it: the endpoint replays the
 * release as a 200 no-op, so the button would do nothing but suggest
 * otherwise.
 *
 * Note what this does NOT consult: the cutoff. The browser's clock is not the
 * server's, so hiding release once the browser believes the cutoff has passed
 * would refuse an action the server might still accept.
 */
export function canReleaseWave(status: WaveStatus): boolean {
  return status === 'planned';
}

/**
 * Cancel has no predictable refusal and is offered on every visible wave —
 * stated as a function so the claim is pinned by a test rather than implied
 * by the absence of a check in JSX. A cancel of an already-cancelled wave is
 * an idempotent no-op; a cancel that races a release is a 409 the client
 * cannot foresee and renders verbatim.
 */
export function canCancelWave(): boolean {
  return true;
}

/* ------------------------------------------------------------------ */
/* The carrier cutoff                                                  */
/* ------------------------------------------------------------------ */

/**
 * How long before the cutoff the amber at-risk indicator lights, in minutes.
 *
 * One named constant with a test pinning the boundary, so retuning the
 * warning window is a one-line change rather than a magic number spread
 * through a component.
 */
export const AT_RISK_THRESHOLD_MINUTES = 60;

/**
 * Where a planned wave stands against its policy's carrier cutoff.
 *
 * - `none`      — the policy carries NO cutoff: release is always allowed.
 * - `unreadable`— a cutoff IS configured, but this browser cannot place it (an
 *                 `HH:MM` it cannot parse, or an IANA zone this runtime does
 *                 not know). Distinct from `none` on purpose: collapsing the
 *                 two told a viewer "no cutoff, release whenever" about a
 *                 policy the server refuses at 18:01.
 * - `ahead`     — the cutoff is further away than the threshold.
 * - `at-risk`   — inside the threshold: amber, with the minutes remaining.
 * - `passed`    — the cutoff has gone by for the policy's local day BY THIS
 *                 BROWSER'S CLOCK. Release is still offered; the server
 *                 decides, and it compares whole minutes (see `cutoffLabel`).
 */
export type CutoffStatus =
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'ahead'; readonly minutesRemaining: number }
  | { readonly kind: 'at-risk'; readonly minutesRemaining: number }
  | { readonly kind: 'passed' };

const CUTOFF_NONE: CutoffStatus = { kind: 'none' };
const CUTOFF_UNREADABLE: CutoffStatus = { kind: 'unreadable' };

type CutoffPolicy = Pick<WavePolicyDto, 'cutoffLocalTime' | 'cutoffTimezone'>;

/** `HH:MM`, 24-hour, as minutes past midnight; `null` when unreadable. */
function parseCutoffMinutes(cutoffLocalTime: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(cutoffLocalTime);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * The wall clock in `timeZone` at instant `now`, in seconds past its local
 * midnight; `null` when the zone is not one this runtime knows.
 *
 * `Intl` is the whole implementation on purpose (the spec bans a date
 * library): `hourCycle: 'h23'` because `hour12: false` renders midnight as
 * "24" on some engines, and `formatToParts` because parsing a formatted
 * string is what locale changes break.
 */
function zoneSecondsOfDay(now: Date, timeZone: string): number | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(now);
  } catch {
    // An unknown IANA zone throws RangeError. Nothing honest can be derived,
    // so the caller reports `none` rather than guessing in the browser's zone.
    return null;
  }
  const read = (type: Intl.DateTimeFormatPartTypes): number | null => {
    const part = parts.find((p) => p.type === type);
    if (part === undefined) return null;
    const value = Number(part.value);
    return Number.isFinite(value) ? value : null;
  };
  const hours = read('hour');
  const minutes = read('minute');
  const seconds = read('second');
  if (hours === null || minutes === null || seconds === null) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * The at-risk derivation: how a policy's carrier cutoff stands at `now`.
 *
 * Both sides are compared as wall-clock times within the SAME local day of
 * the policy's zone, which is what makes DST a non-event — no UTC arithmetic
 * is done, so an hour that repeats or never happens changes nothing about
 * "is it past 18:00 in Kolkata". It is also why the cutoff never rolls over
 * to tomorrow: the backend refuses release once the cutoff has passed for the
 * local day, so a passed cutoff reads `passed`, never "23 hours remaining".
 *
 * The threshold is compared at second resolution and the countdown is floored
 * to whole minutes, so 16:59:59 against an 18:00 cutoff is `ahead` (3601 s)
 * while 17:00:00 is exactly at the boundary and lights amber at 60 minutes.
 */
export function cutoffStatus(policy: CutoffPolicy, now: Date): CutoffStatus {
  if (policy.cutoffLocalTime === null) return CUTOFF_NONE;
  // A cutoff IS set from here on. Every failure below is "this browser cannot
  // place it", never "there is no cutoff" — the server still enforces one.
  const cutoffMinutes = parseCutoffMinutes(policy.cutoffLocalTime);
  if (cutoffMinutes === null) return CUTOFF_UNREADABLE;
  const nowSeconds = zoneSecondsOfDay(now, policy.cutoffTimezone);
  if (nowSeconds === null) return CUTOFF_UNREADABLE;

  const remainingSeconds = cutoffMinutes * 60 - nowSeconds;
  if (remainingSeconds <= 0) return { kind: 'passed' };
  const minutesRemaining = Math.floor(remainingSeconds / 60);
  return remainingSeconds <= AT_RISK_THRESHOLD_MINUTES * 60
    ? { kind: 'at-risk', minutesRemaining }
    : { kind: 'ahead', minutesRemaining };
}

/**
 * The at-risk indicator's own sentence, for a wave the surface has already
 * decided to warn about. Separate from `cutoffLabel` because the amber chip
 * says the urgent half and nothing else.
 */
export function minutesRemainingLabel(minutesRemaining: number): string {
  if (minutesRemaining < 1) return 'under a minute left';
  return `${minutesRemaining} ${minutesRemaining === 1 ? 'minute' : 'minutes'} left`;
}

/**
 * The cutoff line a wave row shows: the configured wall clock and its zone,
 * both named, plus the standing. Naming the zone is what keeps a viewer in
 * another timezone from reading "18:00" as their own evening.
 */
export function cutoffLabel(policy: CutoffPolicy, status: CutoffStatus): string {
  if (status.kind === 'none' || policy.cutoffLocalTime === null) return 'No cutoff';
  const head = `Cutoff ${policy.cutoffLocalTime} ${policy.cutoffTimezone}`;
  // Neither of the next two arms may sound certain. The server compares WHOLE
  // MINUTES (`nowLocal > cutoff`), so it still accepts a release at 18:00:30
  // while this derivation, counting seconds, already reads the cutoff as
  // gone; and an unplaceable zone leaves the browser with no view at all.
  if (status.kind === 'unreadable') {
    return `${head} — standing unknown in this browser; the server decides`;
  }
  if (status.kind === 'passed') {
    return `${head} — passed by this browser's clock; the server decides`;
  }
  return `${head} — ${minutesRemainingLabel(status.minutesRemaining)}`;
}

/**
 * The cutoff a policy simply HAS, with no standing attached — what a released
 * or cancelled wave's row shows. A countdown on either would be counting down
 * to a deadline that wave can no longer miss.
 */
export function cutoffConfiguredLabel(policy: CutoffPolicy): string {
  if (policy.cutoffLocalTime === null) return 'No cutoff';
  return `Cutoff ${policy.cutoffLocalTime} ${policy.cutoffTimezone}`;
}

/**
 * Whether this row lights amber: an at-risk cutoff on a PLANNED wave only.
 *
 * A released wave already made it and a cancelled one is not going anywhere,
 * so warning about either would be noise the floor learns to ignore.
 */
export function isWaveAtRisk(status: WaveStatus, cutoff: CutoffStatus): boolean {
  return status === 'planned' && cutoff.kind === 'at-risk';
}

/* ------------------------------------------------------------------ */
/* Policy copy                                                         */
/* ------------------------------------------------------------------ */

export type WaveGrouping = WavePolicyDto['grouping'];

export const GROUPING_LABEL: Readonly<Record<WaveGrouping, string>> = {
  single: 'One picklist per order',
  batch: 'One picklist across the wave',
};

export function groupingLabel(grouping: WaveGrouping): string {
  return GROUPING_LABEL[grouping];
}

/** The policy picker's one line: what the rule does, in the order it matters. */
export function policySummary(policy: WavePolicyDto): string {
  const cap = policy.maxOrders === null ? 'server default cap' : `up to ${policy.maxOrders} orders`;
  const cutoff =
    policy.cutoffLocalTime === null
      ? 'no cutoff'
      : `cutoff ${policy.cutoffLocalTime} ${policy.cutoffTimezone}`;
  return `${groupingLabel(policy.grouping)} · priority ${policy.priority} · ${cap} · ${cutoff}`;
}

/* ------------------------------------------------------------------ */
/* Picklist and stop copy                                              */
/* ------------------------------------------------------------------ */

export interface WaveTotals {
  /**
   * Distinct orders on the wave, counted from the pick LINES rather than the
   * picklists: `WaveEntryDto` carries no order count, and a batch policy
   * plans ONE picklist across many orders, so `picklistCount` is the order
   * count only under a `single` policy.
   */
  readonly orders: number;
  readonly picklists: number;
  readonly stops: number;
  readonly lines: number;
  readonly qty: number;
  readonly shortfallQty: number;
  readonly unfulfillableLines: number;
}

export function waveTotals(picklists: readonly PicklistDto[]): WaveTotals {
  // Distinct orders come off the lines, not the picklists: a batch picklist
  // carries `orderId: null` and serves many orders at once.
  const orders = new Set<string>();
  let stops = 0;
  let lines = 0;
  let qty = 0;
  let shortfallQty = 0;
  let unfulfillableLines = 0;
  for (const picklist of picklists) {
    stops += picklist.stopCount;
    for (const line of picklist.lines) {
      orders.add(line.orderId);
      lines += 1;
      qty += line.qty;
      shortfallQty += line.shortfallQty;
      if (line.status === 'unfulfillable') unfulfillableLines += 1;
    }
  }
  return {
    orders: orders.size,
    picklists: picklists.length,
    stops,
    lines,
    qty,
    shortfallQty,
    unfulfillableLines,
  };
}

/**
 * The expanded row's one-sentence summary. The uncovered clause is the whole
 * point of showing it — a wave that plans 40 units and covers 31 is the thing
 * an Ops Manager needs to see before releasing it — so it lives here under
 * test rather than in JSX where dropping it would stay green.
 */
export function waveTotalsLabel(totals: WaveTotals, uom?: QuantityUom | null): string {
  // The unit figures render at the wave's SHARED unit's precision with the
  // unit named; a wave mixing units (or carrying an unresolvable SKU) has no
  // precision to state and keeps the unit-agnostic "`N` units" fallback.
  const q = (value: number) => quantityLabel(value, uom ?? null);
  const head = `${totals.orders} ${totals.orders === 1 ? 'order' : 'orders'} · ${totals.picklists} ${totals.picklists === 1 ? 'picklist' : 'picklists'} · ${totals.stops} ${totals.stops === 1 ? 'stop' : 'stops'} · ${totals.lines} ${totals.lines === 1 ? 'line' : 'lines'} · ${q(totals.qty)} to pick`;
  // Each half is emitted on its own count. A short line (story 4.4) carries
  // uncovered units WITHOUT being unfulfillable, so joining the two produced
  // "3 units uncovered across 0 lines with nothing to pick".
  const clauses: string[] = [];
  if (totals.shortfallQty > 0) clauses.push(`${q(totals.shortfallQty)} uncovered`);
  if (totals.unfulfillableLines > 0) {
    clauses.push(
      `${totals.unfulfillableLines} ${totals.unfulfillableLines === 1 ? 'line' : 'lines'} with nothing to pick`,
    );
  }
  return clauses.length === 0 ? head : `${head} · ${clauses.join(' · ')}`;
}

/** A picklist's own heading: the walk it is, and how long it is. */
export function picklistLabel(picklist: Pick<PicklistDto, 'orderId' | 'stopCount' | 'lines'>): string {
  const scope = picklist.orderId === null ? 'Batch picklist' : `Order ${picklist.orderId}`;
  const stops = `${picklist.stopCount} ${picklist.stopCount === 1 ? 'stop' : 'stops'}`;
  const lines = `${picklist.lines.length} ${picklist.lines.length === 1 ? 'line' : 'lines'}`;
  return `${scope} · ${stops} · ${lines}`;
}

/**
 * One stop's quantities, as the expanded row states them. The line's OWN SKU
 * names the unit and its precision per row — a batch picklist walks many
 * SKUs' units in one walk, so the column mixes units and each row states its
 * own. An unresolvable SKU falls back to the shared unit-agnostic fallback —
 * "`N` units" — rather than guessing.
 */
export function pickLineQuantityLabel(
  line: Pick<PicklistLineDto, 'qty' | 'shortfallQty'>,
  uom?: QuantityUom | null,
): string {
  const q = (value: number) => quantityLabel(value, uom ?? null);
  const base = `${q(line.qty)} to pick`;
  return line.shortfallQty > 0 ? `${base} · ${q(line.shortfallQty)} uncovered` : base;
}

/** The bin a stop visits; `—` on an unfulfillable slice, which has no bin. */
export function stopBinLabel(line: Pick<PicklistLineDto, 'binCode'>): string {
  return line.binCode ?? '—';
}

/* ------------------------------------------------------------------ */
/* Outcomes                                                            */
/* ------------------------------------------------------------------ */

/** The generate result — what was actually planned, not just "done". */
export function generateOutcome(wave: WaveDto): Outcome {
  const totals = waveTotals(wave.picklists);
  return {
    tone: 'accepted',
    word: 'Wave generated',
    reason: `${waveTotalsLabel(totals)}. The wave is planned — release it to send the walk to the floor.`,
  };
}

/**
 * The release result.
 *
 * Counted by STATUS, not by length: release flips a picklist with nothing
 * pickable left to `cancelled` and only the rest to `ready`, so a wave where
 * two of five had no bin would otherwise announce "5 picklists are ready to
 * pick" — and the floor would go looking for two walks that are not there.
 */
export function releaseOutcome(wave: WaveDto): Outcome {
  const ready = wave.picklists.filter((picklist) => picklist.status === 'ready').length;
  const dropped = wave.picklists.filter((picklist) => picklist.status === 'cancelled').length;
  const head = `${ready} ${ready === 1 ? 'picklist is' : 'picklists are'} ready to pick`;
  const tail =
    dropped === 0
      ? ''
      : `; ${dropped} ${dropped === 1 ? 'picklist had' : 'picklists had'} nothing to pick and ${dropped === 1 ? 'was' : 'were'} cancelled`;
  return {
    tone: 'accepted',
    word: 'Wave released',
    reason: `${head}${tail}; the wave reads released.`,
  };
}

/**
 * The cancel result, branching on the status the wave held BEFORE the call.
 *
 * "No stock moved" is true of a planned wave and false of a released one: the
 * backend accepts cancel on both and deliberately does not free lines that
 * already drew units, whose stock has physically left the bin. Saying it
 * anyway would tell an Ops Manager the floor had been rewound.
 */
export function cancelWaveOutcome(wave: WaveDto, priorStatus: WaveStatus): Outcome {
  const count = wave.picklists.length;
  const head = `${count} ${count === 1 ? 'picklist' : 'picklists'} cancelled; its orders are eligible for waving again.`;
  const tail =
    priorStatus === 'released'
      ? ' Units already picked stay out of their bins — cancelling does not put them back.'
      : ' No reservation and no stock moved.';
  return { tone: 'accepted', word: 'Wave cancelled', reason: `${head}${tail}` };
}

/** The confirmation panel's warning, the same branch as the outcome above. */
export function cancelWaveWarning(status: WaveStatus): string {
  return status === 'released'
    ? 'Cancelling a released wave cancels its picklists and pick lines and frees its orders to be waved again. Units already picked stay out of their bins — this does not put them back.'
    : 'Cancelling this wave cancels its picklists and pick lines; its orders become eligible for waving again. No reservation and no stock moves.';
}

export function policyOutcome(policy: WavePolicyDto): Outcome {
  return {
    tone: 'accepted',
    word: 'Policy created',
    reason: `${policy.name} — ${policySummary(policy)}.`,
  };
}

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

/**
 * Generate failures.
 *
 * Every interesting one is rendered verbatim: the 409 names the wave that
 * already claims an order, and the two 422 arms — `no-eligible-orders` and
 * `wave-cap-exceeded` — are decided against warehouse state the client never
 * loaded (the cap itself is a server default when the policy's is null, so it
 * is not even knowable client-side).
 */
export function generateReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 409) return verbatim(error);
    switch (error.code) {
      case 'no-eligible-orders':
      case 'wave-cap-exceeded':
        return verbatim(error);
      case 'not-found':
        return error.detail ?? 'The warehouse, the policy or a named order no longer exists — refresh and try again.';
      case 'role-denied':
        return 'Your role cannot generate waves.';
      case 'permission-denied':
        return 'That warehouse belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the selection and try again.';
      default:
        return error.detail ?? `Wave not generated (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * Release failures. Every 409 is verbatim: `cutoff-passed` is the SERVER's
 * clock against the policy — the amber chip is an estimate from a different
 * clock and must never be restated as if it were the ruling — and the other
 * two arms (the wave was cancelled under us, a concurrent request) are races
 * the visible row could not have shown.
 */
export function releaseReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 409) return verbatim(error);
    switch (error.code) {
      case 'not-found':
        return 'This wave no longer exists — refresh the list.';
      case 'role-denied':
        return 'Your role cannot release waves.';
      case 'permission-denied':
        return 'That wave belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This release was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the request and try again.';
      default:
        return error.detail ?? `Not released (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * The expanded row's detail fetch — inline on that row only. Its own mapper
 * rather than the orders module's: `detailReason` names ORDERS, so a wave
 * whose detail 404s used to read "This order no longer exists".
 */
export function waveDetailReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'This wave no longer exists — refresh the list.';
      case 'permission-denied':
        return 'That wave belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Picklists unavailable (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** Cancel failures — a 409 is a race with a release or a concurrent request. */
export function cancelWaveReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 409) return verbatim(error);
    switch (error.code) {
      case 'not-found':
        return 'This wave no longer exists — refresh the list.';
      case 'role-denied':
        return 'Your role cannot cancel waves.';
      case 'permission-denied':
        return 'That wave belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This cancellation was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the request and try again.';
      default:
        return error.detail ?? `Not cancelled (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * Policy-creation failures. The 400 is rendered from the server's own detail
 * because it carries the rule the client cannot restate honestly — a `00:00`
 * cutoff is refused precisely because it would refuse release all day, and
 * the backend's sentence says so.
 */
export function policyReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 409) return verbatim(error);
    switch (error.code) {
      case 'not-found':
        return 'That warehouse no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot create wave policies.';
      case 'permission-denied':
        return 'That warehouse belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the policy and try again.';
      default:
        return error.detail ?? `Policy not created (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/* ------------------------------------------------------------------ */
/* The policy draft                                                    */
/* ------------------------------------------------------------------ */

export interface PolicyDraft {
  readonly name: string;
  readonly grouping: WaveGrouping;
  readonly priority: string;
  readonly maxOrders: string;
  readonly cutoffLocalTime: string;
}

export interface ParsedPolicy {
  /** The request body, or null when the draft cannot be sent. */
  readonly body: {
    name: string;
    grouping: WaveGrouping;
    priority?: number;
    maxOrders?: number;
    cutoffLocalTime?: string;
  } | null;
  readonly problem: string | null;
}

/** The backend's `@Length(1, 120)` on the policy name. */
export const MAX_POLICY_NAME_LENGTH = 120;
/** The backend's `@Min`/`@Max` on the policy's order cap (absent = its default). */
export const MAX_POLICY_ORDERS = 500;
/** The backend's `@Max` on policy priority; `@Min` is 0. */
export const MAX_POLICY_PRIORITY = 1000;

/**
 * The draft → request-body parse. Native form validation catches the empty
 * cases; this is the guard that stops a body the backend would only answer
 * 400 to from being sent at all, and it drops every optional field the viewer
 * left blank rather than sending an empty string the DTO does not accept.
 *
 * `00:00` is refused here with the backend's own reason, because a client
 * that sends it gets a 400 with nothing else to say: a midnight cutoff would
 * refuse release for the entire day.
 */
export function parsePolicyDraft(draft: PolicyDraft): ParsedPolicy {
  const name = draft.name.trim();
  if (name === '') return { body: null, problem: 'Name the policy — it is unique per warehouse.' };
  if (name.length > MAX_POLICY_NAME_LENGTH) {
    return { body: null, problem: `A policy name is at most ${MAX_POLICY_NAME_LENGTH} characters.` };
  }

  const body: {
    name: string;
    grouping: WaveGrouping;
    priority?: number;
    maxOrders?: number;
    cutoffLocalTime?: string;
  } = { name, grouping: draft.grouping };

  const priority = draft.priority.trim();
  if (priority !== '') {
    // The STRING shape, not `Number()`: the parser accepts `1e3` and `0x10`,
    // neither of which a number field can produce and both of which the
    // backend refuses.
    if (!/^\d+$/.test(priority)) {
      return { body: null, problem: 'Priority is a whole number of 0 or more.' };
    }
    if (Number(priority) > MAX_POLICY_PRIORITY) {
      return { body: null, problem: `Priority is at most ${MAX_POLICY_PRIORITY}.` };
    }
    body.priority = Number(priority);
  }

  const maxOrders = draft.maxOrders.trim();
  if (maxOrders !== '') {
    if (!/^\d+$/.test(maxOrders) || Number(maxOrders) < 1) {
      return { body: null, problem: 'The order cap is a whole number of 1 or more.' };
    }
    if (Number(maxOrders) > MAX_POLICY_ORDERS) {
      return { body: null, problem: `The order cap is at most ${MAX_POLICY_ORDERS}.` };
    }
    body.maxOrders = Number(maxOrders);
  }

  const cutoff = draft.cutoffLocalTime.trim();
  if (cutoff !== '') {
    if (parseCutoffMinutes(cutoff) === null) {
      return { body: null, problem: 'The cutoff is a 24-hour wall clock, as HH:MM.' };
    }
    if (cutoff === '00:00') {
      return {
        body: null,
        problem: 'A 00:00 cutoff would refuse release for the whole day — leave it blank for no cutoff.',
      };
    }
    body.cutoffLocalTime = cutoff;
  }

  return { body, problem: null };
}

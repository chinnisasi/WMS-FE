'use client';

import { useEffect, useRef, useState } from 'react';

import {
  fetchApiCancelWave,
  fetchApiCreateWavePolicy,
  fetchApiGenerateWave,
  fetchApiReleaseWave,
} from '@/lib/api/client';
import type { OrderEntryDto, PicklistDto, WaveEntryDto, WavePolicyDto } from '@/lib/api/generated';
import { notifyOutboundChanged, OUTBOUND_CHANGED_EVENT } from '@/lib/outbound';
import { filterPage, pageFilterCount, type Outcome } from '@/lib/outbound-orders';
import {
  cancelWaveOutcome,
  cancelWaveReason,
  cancelWaveWarning,
  canCancelWave,
  canReleaseWave,
  cutoffConfiguredLabel,
  cutoffLabel,
  cutoffStatus,
  generateOutcome,
  generateReason,
  isWaveAtRisk,
  MAX_POLICY_NAME_LENGTH,
  minutesRemainingLabel,
  parsePolicyDraft,
  pickLineQuantityLabel,
  pickLineStatusLabel,
  pickReasonLabel,
  picklistLabel,
  picklistStatusLabel,
  policyOutcome,
  policyReason,
  policySummary,
  releaseOutcome,
  releaseReason,
  stopBinLabel,
  waveStatusLabel,
  WAVE_STATUSES,
  waveTotals,
  waveTotalsLabel,
  type CutoffStatus,
  type PolicyDraft,
  type WaveStatus,
} from '@/lib/outbound-waves';
import { useOutboundOrders } from '@/lib/use-outbound-orders';
import { useOutboundWaves, useWaveDetail, useWavePolicies } from '@/lib/use-outbound-waves';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import type { OutboundSurfaceProps } from '@/components/outbound/outbound';
import {
  buttonClass,
  inputClass,
  labelClass,
  primaryClass,
  ReadFailure,
  rowButtonClass,
  Section,
  selectClass,
} from '@/components/outbound/shell';

/**
 * How often the browser re-reads its own clock for the at-risk derivation.
 *
 * The countdown is stated in whole minutes, so a 30-second tick is the
 * coarsest interval that can never show a stale minute for long. It is the
 * only place `Date.now()` is read — `cutoffStatus` takes the instant as an
 * argument precisely so the derivation itself stays testable.
 */
const CLOCK_TICK_MS = 30_000;

/**
 * The Outbound waves surface (story 4.2c) — the web consumer of story 4.2's
 * wave policies, wave generation, release, cancel and picklists.
 *
 * The session, the warehouse and the role are resolved once by `outbound.tsx`
 * and passed in.
 *
 * Gating hides, never blocks: the wave list and the expanded stops are
 * readable by every role, while the policy form, the generate form and the
 * release / cancel affordances render only for `waves.manage` (Owner + Ops
 * Manager — deliberately not Operator). The backend's per-command role read
 * is the authority either way.
 *
 * The amber at-risk indicator is derived here and is ADVISORY: `cutoff-passed`
 * is decided by the server's clock, so nothing in this file gates release on
 * the browser's reading of the cutoff.
 */
export function OutboundWaves({ tenantId, warehouseId, warehouseLabel, role }: OutboundSurfaceProps) {
  const canManageWaves = roleHasCapability(role, 'waves.manage');
  const policies = useWavePolicies(warehouseId);
  const policyList = policies.state === 'ready' ? policies.data.items : [];
  // Rebuilt each render rather than memoised: a warehouse holds tens of
  // policies, and every consumer of the map is itself recreated per render,
  // so a stable identity would buy nothing.
  const policyMap: Readonly<Record<string, WavePolicyDto>> = Object.fromEntries(
    policyList.map((policy) => [policy.id, policy]),
  );

  return (
    <Section title="Waves">
      <div className="text-(--muted-foreground)">
        {warehouseLabel === null
          ? 'Outbound waves'
          : `${warehouseLabel} — newest first. A wave groups accepted orders into picklists; releasing it sends the walk to the floor.`}
      </div>
      {/* Reported, never swallowed: without policies a row cannot show its
          cutoff and the generate form has nothing honest to offer. The wave
          list below still renders — it is the read this surface exists for. */}
      {policies.state === 'failed' && (
        <ReadFailure
          word="Wave policies unavailable"
          reason={policies.reason}
          onRetry={policies.reload}
        />
      )}
      {/* The cursor chain hit its hop cap: some policies were not loaded, so
          a row whose policy is missing must not be read as "no cutoff". */}
      {policies.state === 'ready' && policies.data.truncated && (
        <div role="alert" className="rounded-sm border border-(--warning) bg-(--warning)/10 px-3 py-2 text-xs">
          More wave policies exist than were loaded. A wave whose policy is missing shows its cutoff
          as unknown rather than as none.
        </div>
      )}
      {canManageWaves && (
        <>
          <WavePolicyForm tenantId={tenantId} warehouseId={warehouseId} />
          <WaveGenerateForm
            tenantId={tenantId}
            warehouseId={warehouseId}
            policies={policyList}
            policiesLoading={policies.state === 'loading'}
            policiesFailed={policies.state === 'failed'}
          />
        </>
      )}
      <WavesTable
        tenantId={tenantId}
        warehouseId={warehouseId}
        canManageWaves={canManageWaves}
        policyMap={policyMap}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* The policy form                                                     */
/* ------------------------------------------------------------------ */

const EMPTY_POLICY: PolicyDraft = {
  name: '',
  grouping: 'single',
  priority: '',
  maxOrders: '',
  cutoffLocalTime: '',
};

/**
 * Wave-policy creation (capability `waves.manage`). A policy IS the wave
 * rule: how orders group into picklists, which policy wins when two could
 * claim the same order, how many orders one wave draws, and the carrier
 * cutoff that gates release.
 *
 * The `Idempotency-Key` is minted once per DRAFT, not per attempt: a create
 * that times out after the server committed is then safe to retry, because
 * the replay returns the original response instead of raising a second
 * policy. Editing the draft mints a fresh key — the same key with a changed
 * body is what the backend answers 422 `idempotency-key-reuse` to.
 */
function WavePolicyForm({ tenantId, warehouseId }: { tenantId: string; warehouseId: string }) {
  const [draft, setDraft] = useState<PolicyDraft>(EMPTY_POLICY);
  const [open, setOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  function editDraft(patch: Partial<PolicyDraft>) {
    setIdempotencyKey(null);
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parsePolicyDraft(draft);
    if (parsed.body === null) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: parsed.problem ?? '' });
      return;
    }
    const key = idempotencyKey ?? ulid();
    setIdempotencyKey(key);
    setPending(true);
    setOutcome(null);
    try {
      const { policy } = await fetchApiCreateWavePolicy(
        tenantId,
        { warehouseId, ...parsed.body },
        key,
      );
      setDraft(EMPTY_POLICY);
      setIdempotencyKey(null);
      setOutcome(policyOutcome(policy));
      notifyOutboundChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: policyReason(error) });
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => setOpen(true)} className={buttonClass}>
          New wave policy
        </button>
        {outcome !== null && (
          <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-sm border border-(--border) p-3">
      <div className="text-xs text-(--muted-foreground)">
        A policy is the wave rule. The cutoff gates release, never generation — planning ahead of a
        cutoff is the point — and it is compared in the warehouse&rsquo;s own timezone.
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-[2] flex-col gap-1">
          <span className={labelClass}>Name</span>
          <input
            className={inputClass}
            value={draft.name}
            onChange={(e) => editDraft({ name: e.target.value })}
            required
            maxLength={MAX_POLICY_NAME_LENGTH}
            placeholder="Evening courier"
          />
        </label>
        <label className="flex flex-[2] flex-col gap-1">
          <span className={labelClass}>Grouping</span>
          <select
            className={selectClass}
            value={draft.grouping}
            onChange={(e) => editDraft({ grouping: e.target.value === 'batch' ? 'batch' : 'single' })}
          >
            <option value="single">One picklist per order</option>
            <option value="batch">One picklist across the wave</option>
          </select>
        </label>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Priority</span>
          <input
            className={inputClass}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={draft.priority}
            onChange={(e) => editDraft({ priority: e.target.value })}
            placeholder="0"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Order cap</span>
          <input
            className={inputClass}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={draft.maxOrders}
            onChange={(e) => editDraft({ maxOrders: e.target.value })}
            placeholder="server default"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Carrier cutoff</span>
          <input
            className={inputClass}
            type="time"
            value={draft.cutoffLocalTime}
            onChange={(e) => editDraft({ cutoffLocalTime: e.target.value })}
            placeholder="18:00"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={primaryClass}>
          {pending ? 'Creating…' : 'Create policy'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setDraft(EMPTY_POLICY);
            setIdempotencyKey(null);
          }}
          className={buttonClass}
        >
          Close
        </button>
      </div>
      {outcome !== null && (
        <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Generate                                                            */
/* ------------------------------------------------------------------ */

/**
 * Wave generation (capability `waves.manage`). One endpoint drives both
 * selection paths: omitting `orderIds` sweeps every eligible accepted order
 * in the warehouse (oldest first, capped by the policy), and naming them
 * waves exactly those.
 *
 * The explicit picker lists the accepted orders on the LOADED page of the
 * order list and says so — the order endpoint offers `cursor` + `limit` and
 * nothing else, so a picker that implied it had searched the warehouse would
 * be lying.
 */
function WaveGenerateForm({
  tenantId,
  warehouseId,
  policies,
  policiesLoading,
  policiesFailed,
}: {
  tenantId: string;
  warehouseId: string;
  policies: readonly WavePolicyDto[];
  policiesLoading: boolean;
  policiesFailed: boolean;
}) {
  const [policyId, setPolicyId] = useState('');
  const [explicit, setExplicit] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const orders = useOutboundOrders(explicit ? warehouseId : null);
  const acceptedOnPage: readonly OrderEntryDto[] =
    orders.state === 'ready' ? orders.data.items.filter((order) => order.status === 'accepted') : [];

  const chosen = policies.find((policy) => policy.id === policyId) ?? null;

  // The order page refetches (an outbound change) and pages (Prev/Next), and
  // a selection carried across either would count orders that are no longer
  // on screen — "3 of 1 chosen" — and submit stale ids. Pruned at RENDER
  // against what is visible, so there is no window in which the counter and
  // the body disagree with the list beside them.
  const visibleIds = new Set(acceptedOnPage.map((order) => order.id));
  const chosenIds = selected.filter((id) => visibleIds.has(id));

  function editSelection(next: (current: readonly string[]) => readonly string[]) {
    setIdempotencyKey(null);
    setSelected(next);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (chosen === null) {
      setOutcome({ tone: 'rejected', word: 'Not generated', reason: 'Pick a wave policy first.' });
      return;
    }
    if (explicit && chosenIds.length === 0) {
      setOutcome({
        tone: 'rejected',
        word: 'Not generated',
        reason: 'Choose at least one order, or sweep every eligible order instead.',
      });
      return;
    }
    const key = idempotencyKey ?? ulid();
    setIdempotencyKey(key);
    setPending(true);
    setOutcome(null);
    try {
      const { wave } = await fetchApiGenerateWave(
        tenantId,
        {
          warehouseId,
          policyId: chosen.id,
          // Absent is the auto-sweep; present is the explicit selection. One
          // call, two paths — never two request shapes.
          ...(explicit ? { orderIds: chosenIds } : {}),
        },
        key,
      );
      setSelected([]);
      setIdempotencyKey(null);
      setOutcome(generateOutcome(wave));
      notifyOutboundChanged();
    } catch (error) {
      // `no-eligible-orders`, `wave-cap-exceeded` and the open-wave claim are
      // all decided against warehouse state this client never loaded, so the
      // server's own words are what gets rendered.
      setOutcome({ tone: 'rejected', word: 'Not generated', reason: generateReason(error) });
    } finally {
      setPending(false);
    }
  }

  if (policiesLoading) {
    return (
      <div className="rounded-sm border border-(--border) p-3 text-xs text-(--muted-foreground)">
        Loading wave policies…
      </div>
    );
  }
  if (policiesFailed) {
    // Checked BEFORE the length test: a failed read also yields an empty
    // list, and telling an Ops Manager to create a policy that already
    // exists is worse than saying the read failed.
    return (
      <div className="rounded-sm border border-(--border) p-3 text-xs text-(--muted-foreground)">
        Wave policies could not be loaded, so there is nothing to generate under. Retry the policy
        read above.
      </div>
    );
  }
  if (policies.length === 0) {
    // No policy, no honest generate form — a wave is generated UNDER a rule.
    return (
      <div className="rounded-sm border border-(--border) p-3 text-xs text-(--muted-foreground)">
        Create a wave policy first — a wave is generated under one.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-sm border border-(--border) p-3">
      <div className="text-xs text-(--muted-foreground)">
        Generating gathers accepted orders into picklists with the pick path in bin order. It does
        not send anything to the floor — releasing does.
      </div>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Wave policy</span>
        <select
          className={selectClass}
          value={policyId}
          onChange={(e) => {
            setIdempotencyKey(null);
            setPolicyId(e.target.value);
          }}
          required
        >
          <option value="" disabled>
            Pick a policy…
          </option>
          {policies.map((policy) => (
            <option key={policy.id} value={policy.id}>
              {policy.name}
            </option>
          ))}
        </select>
      </label>
      {chosen !== null && (
        <div className="text-xs text-(--muted-foreground)">{policySummary(chosen)}</div>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Which orders</legend>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="radio"
            name="wave-selection"
            checked={!explicit}
            onChange={() => {
              setIdempotencyKey(null);
              setExplicit(false);
            }}
          />
          Every eligible accepted order, oldest first, capped by the policy
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="radio"
            name="wave-selection"
            checked={explicit}
            onChange={() => {
              setIdempotencyKey(null);
              setExplicit(true);
            }}
          />
          Choose orders
        </label>
      </fieldset>
      {explicit && (
        <div className="flex flex-col gap-2 rounded-sm border border-(--border) p-2">
          {orders.state === 'failed' ? (
            <ReadFailure word="Orders unavailable" reason={orders.reason} onRetry={orders.reload} />
          ) : orders.state === 'loading' ? (
            <div className="text-xs text-(--muted-foreground)">Loading orders…</div>
          ) : acceptedOnPage.length === 0 ? (
            <div className="text-xs text-(--muted-foreground)">
              No accepted order on the loaded page. Sweep every eligible order instead.
            </div>
          ) : (
            <>
              <div className="text-xs text-(--muted-foreground)">
                {/* The order list offers cursor + limit and nothing else, so
                    this picker is page-scoped and names its own scope. */}
                Accepted orders on the loaded page — {chosenIds.length} of{' '}
                {acceptedOnPage.length} chosen.
              </div>
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {acceptedOnPage.map((order) => (
                  <li key={order.id}>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={chosenIds.includes(order.id)}
                        onChange={(e) =>
                          editSelection((current) =>
                            e.target.checked
                              ? [...current, order.id]
                              : current.filter((id) => id !== order.id),
                          )
                        }
                      />
                      <span className="font-mono">{order.id}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <div>
        <button type="submit" disabled={pending} className={primaryClass}>
          {pending ? 'Generating…' : 'Generate wave'}
        </button>
      </div>
      {outcome !== null && (
        <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

/**
 * The amber at-risk chip. Rendered only when `isWaveAtRisk` says so — a
 * planned wave inside the threshold — and it carries the minutes in words, so
 * the warning is never colour alone.
 */
function AtRiskChip({ minutesRemaining }: { minutesRemaining: number }) {
  return (
    <span className="rounded-full border border-(--warning) bg-(--warning)/10 px-2 py-0.5 text-xs font-medium text-(--foreground)">
      At risk — {minutesRemainingLabel(minutesRemaining)}
    </span>
  );
}

/**
 * The browser's clock, ticking only while something on screen counts down.
 *
 * `enabled` is false when no PLANNED wave on the page has a readable policy
 * cutoff — with nothing to recompute, an unconditional 30-second interval
 * would re-render the whole table forever on a page of released waves.
 */
function useNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

function WavesTable({
  tenantId,
  warehouseId,
  canManageWaves,
  policyMap,
}: {
  tenantId: string;
  warehouseId: string;
  canManageWaves: boolean;
  policyMap: Readonly<Record<string, WavePolicyDto>>;
}) {
  const waves = useOutboundWaves(warehouseId);
  const [statusFilter, setStatusFilter] = useState<WaveStatus | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /**
   * The open confirmation, carrying the `Idempotency-Key` the submit will
   * send. The key is minted when the confirmation opens and REUSED across
   * retries of it, so a retry after a lost response replays the original
   * command rather than issuing a second one; it is cleared with the
   * confirmation on success. The forms above already hold one key per draft
   * — this is the same discipline for a row action.
   */
  const [confirm, setConfirm] = useState<{
    id: string;
    verb: 'release' | 'cancel';
    status: WaveStatus;
    idempotencyKey: string;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Bumped to remount DataTable, whose Prev/Next cursor is internal state —
  // without it the table would still offer Prev on what is now page one.
  const [pageEpoch, setPageEpoch] = useState(0);

  // Switching warehouse remounts this table (the page keys both surfaces on
  // it), so a mutation still in flight would otherwise settle into a tree
  // that is gone.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const { onCursor } = waves;
  useEffect(() => {
    // A generate lands a new wave at the top of page one, so any outbound
    // change returns the list to page one before it refetches. Otherwise the
    // banner reports a wave the page on screen demonstrably cannot show.
    const onChange = () => {
      onCursor(null);
      setPageEpoch((epoch) => epoch + 1);
    };
    window.addEventListener(OUTBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OUTBOUND_CHANGED_EVENT, onChange);
  }, [onCursor]);

  const loaded = waves.state === 'ready' ? waves.data.items : [];
  const rows = filterPage(loaded, statusFilter);

  // The clock only needs to tick while a PLANNED wave on this page actually
  // has a cutoff to count down to.
  const hasLiveCountdown = loaded.some(
    (wave) =>
      wave.status === 'planned' && (policyMap[wave.policyId]?.cutoffLocalTime ?? null) !== null,
  );
  const now = useNow(hasLiveCountdown);

  /**
   * A wave's cutoff standing. `null` when its POLICY is not in hand — which
   * is not the same claim as "this policy has no cutoff", and the row says
   * so rather than quietly dropping the amber.
   */
  function cutoffFor(wave: WaveEntryDto): CutoffStatus | null {
    const policy = policyMap[wave.policyId];
    if (policy === undefined) return null;
    return cutoffStatus(policy, now);
  }

  async function submit(waveId: string, verb: 'release' | 'cancel', idempotencyKey: string) {
    setBusyId(waveId);
    setOutcome(null);
    const priorStatus = loaded.find((w) => w.id === waveId)?.status ?? 'planned';
    try {
      const { wave } =
        verb === 'release'
          ? await fetchApiReleaseWave(tenantId, waveId, idempotencyKey)
          : await fetchApiCancelWave(tenantId, waveId, idempotencyKey);
      if (!mounted.current) return;
      setOutcome(
        verb === 'release' ? releaseOutcome(wave) : cancelWaveOutcome(wave, priorStatus),
      );
      setConfirm(null);
      notifyOutboundChanged();
    } catch (error) {
      if (!mounted.current) return;
      // The refusal stays on screen with the confirmation still open. A 409
      // `cutoff-passed` is the SERVER's clock against the policy — the amber
      // chip is an estimate from a different clock and never the ruling — so
      // the server's own words are what gets rendered.
      setOutcome({
        tone: 'rejected',
        word: verb === 'release' ? 'Not released' : 'Not cancelled',
        reason: verb === 'release' ? releaseReason(error) : cancelWaveReason(error),
      });
    } finally {
      if (mounted.current) setBusyId(null);
    }
  }

  const columns: readonly DataTableColumn<WaveEntryDto>[] = [
    {
      key: 'id',
      header: 'Wave',
      render: (wave) => (
        <button
          type="button"
          aria-expanded={expandedId === wave.id}
          aria-controls={expandedId === wave.id ? expandedRowId(wave.id) : undefined}
          onClick={() => setExpandedId((id) => (id === wave.id ? null : wave.id))}
          className="flex items-center gap-2 text-left underline-offset-2 hover:underline"
        >
          <span aria-hidden className="text-(--muted-foreground)">
            {expandedId === wave.id ? '▾' : '▸'}
          </span>
          <span className="font-mono text-xs">{wave.id}</span>
        </button>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (wave) => {
        const cutoff = cutoffFor(wave);
        return (
          <div className="flex flex-wrap items-center gap-1">
            <span className="rounded-full border border-(--border) bg-(--muted) px-2 py-0.5 text-xs text-(--muted-foreground)">
              {waveStatusLabel(wave.status)}
            </span>
            {/* Amber is for a PLANNED wave only: a released wave already made
                it, and a cancelled one is not going anywhere. */}
            {cutoff !== null && isWaveAtRisk(wave.status, cutoff) && cutoff.kind === 'at-risk' && (
              <AtRiskChip minutesRemaining={cutoff.minutesRemaining} />
            )}
          </div>
        );
      },
    },
    {
      key: 'policy',
      header: 'Policy',
      render: (wave) => policyMap[wave.policyId]?.name ?? <span className="font-mono text-xs">{wave.policyId}</span>,
    },
    {
      key: 'cutoff',
      header: 'Cutoff',
      render: (wave) => {
        const policy = policyMap[wave.policyId];
        // Not the same claim as "no cutoff": the policy read failed or was
        // truncated, and this row genuinely does not know.
        if (policy === undefined) {
          return <span className="text-xs text-(--muted-foreground)">Policy not loaded</span>;
        }
        // The SAME status gate the amber chip uses. A released or cancelled
        // wave counting down to a deadline it can no longer miss is noise,
        // and a "passed" reading on it is meaningless.
        if (wave.status !== 'planned') {
          return (
            <span className="text-xs text-(--muted-foreground)">{cutoffConfiguredLabel(policy)}</span>
          );
        }
        const cutoff = cutoffFor(wave);
        if (cutoff === null) {
          return <span className="text-xs text-(--muted-foreground)">Policy not loaded</span>;
        }
        return (
          <span
            className={
              isWaveAtRisk(wave.status, cutoff)
                ? 'text-xs font-medium text-(--warning)'
                : 'text-xs text-(--muted-foreground)'
            }
          >
            {cutoffLabel(policy, cutoff)}
          </span>
        );
      },
    },
    {
      key: 'picklistCount',
      header: 'Picklists',
      numeric: true,
      render: (wave) => wave.picklistCount,
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (wave) => <time dateTime={wave.createdAt}>{new Date(wave.createdAt).toLocaleString()}</time>,
    },
    {
      key: 'settledAt',
      // "When did this go to the floor?" is the question asked about a
      // released wave, and both timestamps were fetched and thrown away.
      header: 'Released / cancelled',
      render: (wave) => {
        const at = wave.status === 'released' ? wave.releasedAt : wave.status === 'cancelled' ? wave.cancelledAt : null;
        if (at === null) return <span className="text-(--muted-foreground)">—</span>;
        return (
          <time dateTime={at}>
            {waveStatusLabel(wave.status)} {new Date(at).toLocaleString()}
          </time>
        );
      },
    },
    ...(canManageWaves
      ? [
          {
            key: 'actions',
            header: '',
            render: (wave: WaveEntryDto) => (
              <div className="flex justify-end gap-1">
                {/* No release affordance on a cancelled wave — the backend
                    refuses it for a state the row already shows. Nothing here
                    consults the cutoff: amber warns, the server decides. */}
                {canReleaseWave(wave.status) && (
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() =>
                      setConfirm({
                        id: wave.id,
                        verb: 'release',
                        status: wave.status,
                        idempotencyKey: ulid(),
                      })
                    }
                    className={rowButtonClass}
                  >
                    Release
                  </button>
                )}
                {canCancelWave() && (
                  <button
                    type="button"
                    // Any mutation in flight disables every row: `busyId` and
                    // the outcome banner are single, so two concurrent
                    // submits would leave one of them unreported.
                    disabled={busyId !== null}
                    onClick={() =>
                      setConfirm({
                        id: wave.id,
                        verb: 'cancel',
                        status: wave.status,
                        idempotencyKey: ulid(),
                      })
                    }
                    className={rowButtonClass}
                  >
                    Cancel
                  </button>
                )}
              </div>
            ),
          } satisfies DataTableColumn<WaveEntryDto>,
        ]
      : []),
  ];

  const target = confirm === null ? null : (loaded.find((w) => w.id === confirm.id) ?? null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="flex flex-col gap-1">
          {/* The list API offers cursor + limit and nothing else — no status
              filter, no sort, no search. Naming the scope in the control is
              what keeps it from implying it searched the whole warehouse. */}
          <span className="text-xs text-(--muted-foreground)">Filter this page</span>
          <select
            className={`${selectClass} w-auto py-1`}
            value={statusFilter ?? ''}
            onChange={(e) => setStatusFilter(e.target.value === '' ? null : (e.target.value as WaveStatus))}
          >
            <option value="">All statuses</option>
            {WAVE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {waveStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-(--muted-foreground)">
          {pageFilterCount(rows.length, loaded.length)}
        </span>
      </div>

      {target !== null && confirm !== null && (
        <div className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3">
          <div className="text-xs text-(--muted-foreground)">
            {confirm.verb === 'release' ? (
              <>
                Releasing wave <span className="font-mono">{target.id}</span> makes its picklists
                ready to pick on the floor. The server compares its own clock to the policy cutoff
                and refuses a release that is too late.
              </>
            ) : (
              <>
                {/* Branching on the wave's OWN status: "no stock moves" is
                    true of a planned wave and false of a released one, whose
                    picked units have physically left their bins. */}
                Cancelling wave <span className="font-mono">{target.id}</span>.{' '}
                {cancelWaveWarning(target.status)}
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => submit(target.id, confirm.verb, confirm.idempotencyKey)}
              className={primaryClass}
            >
              {busyId === target.id
                ? confirm.verb === 'release'
                  ? 'Releasing…'
                  : 'Cancelling…'
                : confirm.verb === 'release'
                  ? 'Release this wave'
                  : 'Cancel this wave'}
            </button>
            <button type="button" onClick={() => setConfirm(null)} className={buttonClass}>
              Keep it as it is
            </button>
          </div>
        </div>
      )}

      {waves.state === 'failed' ? (
        <ReadFailure word="Waves unavailable" reason={waves.reason} onRetry={waves.reload} />
      ) : (
        <DataTable<WaveEntryDto>
          key={pageEpoch}
          columns={columns}
          rows={rows}
          nextCursor={waves.state === 'ready' ? waves.data.nextCursor : null}
          onCursor={waves.onCursor}
          renderExpanded={(wave) =>
            expandedId === wave.id ? <WaveDetailPanel waveId={wave.id} /> : null
          }
          emptyMessage={
            waves.state === 'loading'
              ? 'Loading waves…'
              : loaded.length === 0
                ? 'No waves in this warehouse yet.'
                : 'No waves on this page match that status.'
          }
        />
      )}
      {outcome !== null && (
        <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      )}
    </div>
  );
}

/**
 * One wave's picklists and the stops on their walks, fetched when the row
 * expands. There is no picklist endpoint at all — the stops come free with
 * the wave detail read — and no `[id]` route in this app, so this is where
 * the walk is readable.
 *
 * A failure belongs to this row alone: the list around it is untouched, and
 * an empty picklist list would read as "this wave has no walk", which is
 * never true.
 */
function WaveDetailPanel({ waveId }: { waveId: string }) {
  const detail = useWaveDetail(waveId);

  if (detail.state === 'loading') {
    return <div className="text-xs text-(--muted-foreground)">Loading picklists…</div>;
  }
  if (detail.state === 'failed') {
    return (
      <div className="flex flex-col items-start gap-2">
        <div role="alert" className="text-xs text-(--destructive)">
          {detail.reason}
        </div>
        <button type="button" onClick={detail.reload} className={`${buttonClass} text-xs`}>
          Retry
        </button>
      </div>
    );
  }

  const picklists = detail.data.picklists;
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-(--muted-foreground)">
        {waveTotalsLabel(waveTotals(picklists))}
      </div>
      {picklists.length === 0 ? (
        <div className="text-xs text-(--muted-foreground)">This wave has no picklists.</div>
      ) : (
        picklists.map((picklist) => <PicklistPanel key={picklist.id} picklist={picklist} />)
      )}
    </div>
  );
}

/** One picklist: its heading, and every stop on the walk in walk order. */
function PicklistPanel({ picklist }: { picklist: PicklistDto }) {
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-(--border) p-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{picklistLabel(picklist)}</span>
        <span className="rounded-full border border-(--border) px-2 py-0.5 text-(--muted-foreground)">
          {picklistStatusLabel(picklist.status)}
        </span>
      </div>
      <ol className="flex flex-col gap-1">
        {/* Walk order is the server's (bins.code ascending) — never re-sorted
            here, because the batching guarantee is about that exact path. */}
        {picklist.lines.map((line) => {
          const reason = pickReasonLabel(line.reasonCode);
          return (
            <li key={line.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="data w-6 text-(--muted-foreground)">{line.walkSeq + 1}.</span>
              <span className="font-mono">{stopBinLabel(line)}</span>
              <span className="font-mono text-(--muted-foreground)">{line.skuId}</span>
              <span className="data">{pickLineQuantityLabel(line)}</span>
              <span
                className={
                  line.status === 'unfulfillable' || line.status === 'short'
                    ? 'rounded-full border border-(--destructive) px-2 py-0.5 text-(--destructive)'
                    : 'rounded-full border border-(--border) px-2 py-0.5 text-(--muted-foreground)'
                }
              >
                {pickLineStatusLabel(line.status)}
              </span>
              {reason !== null && <span className="text-(--muted-foreground)">{reason}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

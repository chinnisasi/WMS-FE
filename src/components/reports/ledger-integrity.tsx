'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiAcknowledgeChainBreak, fetchApiLedgerAnchors, fetchApiLedgerProof } from '@/lib/api/client';
import type { ChainBreakDto, LedgerAnchorDto, LedgerAnchorListResponse, WarehouseLedgerIntegrityDto } from '@/lib/api/generated';
import { istDateLabel, istDateTimeLabel } from '@/lib/audit-exports';
import { readSession, subscribeSession } from '@/lib/auth';
import { downloadBlob } from '@/lib/csv';
import {
  LEDGER_INTEGRITY_ANCHOR,
  LEDGER_INTEGRITY_REFRESH_EVENT,
  PROOF_MISMATCH,
  breakLabel,
  integrityReason,
  integrityStatus,
  isAlreadyAcknowledged,
  lastAnchorLabel,
  ledgerProofFilename,
  legacyLabel,
  wormLabel,
  type WormStoreMode,
} from '@/lib/ledger-integrity';
import type { ResourceState } from '@/lib/resource-state';
import { ulid } from '@/lib/ulid';
import { useLedgerIntegrity } from '@/lib/use-ledger-integrity';
import { roleHasCapability } from '@/lib/users';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { ReadFailure, Section, rowButtonClass } from '@/components/shared/surface';

function useSessionValue<T>(read: () => T, fallback: T): T {
  return useSyncExternalStore(subscribeSession, read, () => fallback);
}

const ANCHOR_PAGE_SIZE = 20;

/**
 * Story 9-3c — the `/reports` "Ledger integrity" section (AD-16), after
 * Audit. Owner-only: it renders only for a role holding `audit.view` (the
 * mirror), and the backend's guard is the authority — a `role-denied`
 * answer hides the section.
 *
 * Per warehouse (labelled by its code): the status in priority order
 * ("Broken at #N" in red AND the word, "· acknowledged" once every break
 * is; "Verified through #N · <IST>"; "Not yet checked"), the pre-0026 count
 * when the baseline found any, the last anchor, the WORM line, the breaks
 * (Acknowledge only with `ledger.acknowledge`), and an expandable anchors
 * list whose rows download a verifiable proof file.
 *
 * The wrapper carrying `id="ledger-integrity"` is ALWAYS rendered — loading
 * and failed states included — so the bell's link always has a target. On
 * mount with that hash, on every `hashchange` to it and on the bell's
 * refresh event (`LEDGER_INTEGRITY_REFRESH_EVENT`) the section reloads and
 * scrolls into view once read. Refresh is manual; there is no polling.
 */
export function LedgerIntegrity() {
  const role = useSessionValue(() => readSession()?.user.role, undefined);
  if (!roleHasCapability(role, 'audit.view')) return null;
  return <LedgerIntegritySection />;
}

function LedgerIntegritySection() {
  const integrity = useLedgerIntegrity();
  const role = useSessionValue(() => readSession()?.user.role, undefined);
  const canAcknowledge = roleHasCapability(role, 'ledger.acknowledge');
  const anchor = useRef<HTMLDivElement>(null);
  const scrollPending = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { reload } = integrity;

  useEffect(() => {
    if (window.location.hash === `#${LEDGER_INTEGRITY_ANCHOR}`) scrollPending.current = true;
    const refresh = () => {
      scrollPending.current = true;
      reload();
    };
    const onHash = () => {
      if (window.location.hash === `#${LEDGER_INTEGRITY_ANCHOR}`) refresh();
    };
    window.addEventListener('hashchange', onHash);
    // The bell's entry click (a pushState navigation fires no hashchange).
    window.addEventListener(LEDGER_INTEGRITY_REFRESH_EVENT, refresh);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener(LEDGER_INTEGRITY_REFRESH_EVENT, refresh);
    };
  }, [reload]);

  useEffect(() => {
    if (!scrollPending.current || integrity.state === 'loading') return;
    scrollPending.current = false;
    anchor.current?.scrollIntoView?.({ block: 'start' });
  }, [integrity.state]);

  if (integrity.denied) return null;

  return (
    <div id={LEDGER_INTEGRITY_ANCHOR} ref={anchor}>
      <Section
        title="Ledger integrity"
        action={
          <button type="button" className={rowButtonClass} onClick={reload}>
            Refresh
          </button>
        }
      >
        <p className="max-w-prose text-xs text-(--muted-foreground)">
          The stock ledger is hash-chained. Each warehouse&rsquo;s chain is verified and anchored on a schedule; a break is
          never repaired automatically.
        </p>
        {problem !== null && (
          <div role="alert" className="text-xs text-(--destructive)">
            {problem}
          </div>
        )}
        {integrity.state === 'failed' ? (
          <ReadFailure word="Ledger integrity unavailable" reason={integrity.reason} onRetry={reload} />
        ) : integrity.state === 'loading' ? (
          <p className="text-xs text-(--muted-foreground)">Loading the ledger integrity status…</p>
        ) : integrity.data.warehouses.length === 0 ? (
          <p className="text-xs text-(--muted-foreground)">No warehouses yet</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {integrity.data.warehouses.map((row) => (
              <li key={row.warehouseId}>
                <WarehouseIntegrity
                  row={row}
                  mode={integrity.data.wormStore}
                  canAcknowledge={canAcknowledge}
                  onChanged={reload}
                  onProblem={setProblem}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export function WarehouseIntegrity({
  row,
  mode,
  canAcknowledge,
  onChanged,
  onProblem,
}: {
  row: WarehouseLedgerIntegrityDto;
  mode: WormStoreMode;
  canAcknowledge: boolean;
  onChanged: () => void;
  onProblem: (problem: string | null) => void;
}) {
  const tenantId = useSessionValue(() => readSession()?.tenant.id ?? null, null);
  const [showAnchors, setShowAnchors] = useState(false);
  // The synchronous double-click guard: a second click inside the same tick
  // reads the ref before any state update has rendered.
  const acking = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const status = integrityStatus(row);
  const legacy = legacyLabel(row.legacyThroughSeq);
  const worm = wormLabel(row, mode);

  const acknowledge = async (entry: ChainBreakDto) => {
    if (tenantId === null || acking.current) return;
    acking.current = true;
    setBusy(entry.id);
    onProblem(null);
    try {
      // A NEW key per click: a key kept across clicks would replay a stale answer.
      await fetchApiAcknowledgeChainBreak(tenantId, row.warehouseId, entry.id, ulid());
    } catch (error) {
      // Someone already acknowledged it: nothing to say — the reload shows it.
      if (!isAlreadyAcknowledged(error)) onProblem(integrityReason(error));
    } finally {
      acking.current = false;
      setBusy(null);
      onChanged();
    }
  };

  return (
    <div className="flex flex-col gap-1 rounded-sm border border-(--border) p-2" data-warehouse={row.warehouseCode}>
      <h3 className="font-medium">{row.warehouseCode}</h3>
      <p data-status={status.tone} className={status.tone === 'broken' ? 'font-medium text-(--destructive)' : 'text-xs'}>
        {status.text}
      </p>
      {legacy !== null && <p className="text-xs">{legacy}</p>}
      <p className="text-xs">{lastAnchorLabel(row.lastAnchor)}</p>
      {worm !== null && <p className="text-xs">{worm}</p>}
      {row.breaks.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={`Breaks in ${row.warehouseCode}`}>
          {row.breaks.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-2 text-xs" data-break={entry.id}>
              <span className="font-medium">{breakLabel(entry)}</span>
              <span className="text-(--muted-foreground)">{entry.reason}</span>
              {entry.acknowledgedAt !== null ? (
                <span>Acknowledged {istDateTimeLabel(entry.acknowledgedAt)}</span>
              ) : canAcknowledge ? (
                <button
                  type="button"
                  className={rowButtonClass}
                  disabled={busy !== null}
                  aria-label={`Acknowledge the break at #${entry.firstSeq} in ${row.warehouseCode}`}
                  onClick={() => void acknowledge(entry)}
                >
                  {busy === entry.id ? 'Acknowledging…' : 'Acknowledge'}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div>
        <button
          type="button"
          className={rowButtonClass}
          aria-expanded={showAnchors}
          onClick={() => setShowAnchors((open) => !open)}
        >
          {showAnchors ? 'Hide anchors' : 'Show anchors'}
        </button>
      </div>
      {showAnchors && tenantId !== null && (
        <AnchorList tenantId={tenantId} warehouseId={row.warehouseId} warehouseCode={row.warehouseCode} mode={mode} />
      )}
    </div>
  );
}

/** One warehouse's anchors, newest range first, cursor-paged; each row downloads its proof. */
function AnchorList({
  tenantId,
  warehouseId,
  warehouseCode,
  mode,
}: {
  tenantId: string;
  warehouseId: string;
  warehouseCode: string;
  mode: WormStoreMode;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{ key: string; state: ResourceState<LedgerAnchorListResponse> } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Anchors whose downloaded proof says `matches: false`.
  const [mismatched, setMismatched] = useState<ReadonlySet<string>>(new Set());
  const key = `${cursor ?? ''}#${revision}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchApiLedgerAnchors(tenantId, warehouseId, {
          limit: ANCHOR_PAGE_SIZE,
          ...(cursor === null ? {} : { cursor }),
        });
        if (!cancelled) setPage({ key, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled) setPage({ key, state: { state: 'failed', reason: integrityReason(error) } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, cursor, revision, key]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const state: ResourceState<LedgerAnchorListResponse> = page === null || page.key !== key ? { state: 'loading' } : page.state;

  const download = async (anchor: LedgerAnchorDto) => {
    setDownloading(anchor.id);
    setProblem(null);
    try {
      const blob = await fetchApiLedgerProof(tenantId, warehouseId, anchor.id);
      downloadBlob(ledgerProofFilename(warehouseCode, anchor), blob);
      let matches = true;
      try {
        matches = (JSON.parse(await blob.text()) as { matches?: unknown }).matches !== false;
      } catch {
        matches = true; // not a proof body we can read — the file is still saved
      }
      if (!matches) setMismatched((current) => new Set(current).add(anchor.id));
    } catch (error) {
      setProblem(integrityReason(error));
      reload();
    } finally {
      setDownloading(null);
    }
  };

  const columns: readonly DataTableColumn<LedgerAnchorDto>[] = [
    { key: 'range', header: 'Range', render: (row) => <span className="data">{`#${row.fromSeq}–#${row.toSeq}`}</span> },
    { key: 'kind', header: 'Verified', render: (row) => <span className="text-xs">{row.kind === 'legacy' ? 'Pre-0026 form' : 'Current form'}</span> },
    { key: 'at', header: 'Anchored (IST)', render: (row) => <time dateTime={row.anchoredAt}>{istDateTimeLabel(row.anchoredAt)}</time> },
    {
      key: 'worm',
      header: 'WORM',
      render: (row) => (
        <span className="text-xs">
          {row.worm !== null ? `Until ${istDateLabel(row.worm.retainUntil)}` : mode === 'none' ? '—' : 'Waiting'}
        </span>
      ),
    },
    {
      key: 'proof',
      header: '',
      render: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={rowButtonClass}
            disabled={downloading !== null}
            aria-label={`Download the proof of #${row.fromSeq}–#${row.toSeq} in ${warehouseCode}`}
            onClick={() => void download(row)}
          >
            {downloading === row.id ? 'Downloading…' : 'Download proof'}
          </button>
          {mismatched.has(row.id) && (
            <span role="alert" data-proof-mismatch={row.id} className="text-xs font-medium text-(--destructive)">
              {PROOF_MISMATCH}
            </span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-2" aria-label={`Anchors of ${warehouseCode}`}>
      {problem !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      )}
      {state.state === 'failed' ? (
        <ReadFailure word="Anchors unavailable" reason={state.reason} onRetry={() => (cursor === null ? reload() : setCursor(null))} />
      ) : (
        <DataTable<LedgerAnchorDto>
          columns={columns}
          rows={state.state === 'ready' ? state.data.items : []}
          nextCursor={state.state === 'ready' ? state.data.nextCursor : null}
          onCursor={setCursor}
          emptyMessage={state.state === 'loading' ? 'Loading anchors…' : 'No anchors yet'}
        />
      )}
    </div>
  );
}

'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import {
  fetchApiAppendEwayStateThreshold,
  fetchApiDismissEwayBill,
  fetchApiExportEwayBills,
  fetchApiGenerateEwayBill,
  fetchApiPutEwayGstinSetting,
  fetchApiRecordEwayBill,
  fetchApiUpdateEwayTransport,
} from '@/lib/api/client';
import type { EwayBillDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { downloadText } from '@/lib/csv';
import {
  EWAY_TABS,
  EWAY_TAB_LABEL,
  OVERRIDE_COPY,
  QUEUE_COPY,
  TRANS_MODE_LABEL,
  blockerHint,
  blockerLabel,
  canSelect,
  configureReason,
  dismissReason,
  downloadLabel,
  draftFromTransport,
  ewayJsonFilename,
  exportReason,
  generateEwayReason,
  istDateTimeLabel,
  notifyEwayChanged,
  overrideStateCodes,
  parseDismissReason,
  parseRecordDraft,
  parseThresholdDraft,
  parseTransportDraft,
  recordReason,
  selectionGstin,
  skippedLabel,
  splitSelection,
  thresholdAmountLabel,
  thresholdRuleLabel,
  transportReason,
  transportSummary,
  type EwayTab,
  type RecordDraft,
  type ThresholdDraft,
  type TransportDraft,
} from '@/lib/eway';
import { GST_STATE_NAMES, formatRupees, invoiceDateLabel, placeOfSupplyLabel, type Outcome } from '@/lib/invoices';
import { useEwayBills, useEwayGstinSettings, useEwayStateThresholds } from '@/lib/use-eway';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import {
  ReadFailure,
  Section,
  buttonClass,
  inputClass,
  labelClass,
  primaryClass,
  rowButtonClass,
  selectClass,
} from '@/components/outbound/shell';

/**
 * The /compliance E-way bills section (story 8-2b). Bills queue on the
 * backend shortly after an invoice issues over the threshold; finance enters
 * Part B, downloads the NIC bulk JSON per supplier GSTIN, uploads it on the
 * portal and records each returned EWB number here. Generate (through a
 * configured gateway) is offered only on a bill that reads `gatewayAvailable`.
 *
 * Pessimistic throughout (frontend guide §2): every figure and blocker is the
 * server's, re-read after a mutation. Mutating affordances are HIDDEN without
 * `eway.manage`; the settings panel without `eway.configure` (owner).
 */

export function EwayBills() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <Section title="E-way bills">
        <div className="text-(--muted-foreground)">Sign in to read the tenant&apos;s e-way bills.</div>
      </Section>
    );
  }
  return <EwayBillsSessioned />;
}

function EwayBillsSessioned() {
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canManage = roleHasCapability(role, 'eway.manage');
  const canConfigure = roleHasCapability(role, 'eway.configure');

  const [tab, setTab] = useState<EwayTab>('pending');
  const [gstinFilter, setGstinFilter] = useState('');
  const settings = useEwayGstinSettings();
  const list = useEwayBills(tab, gstinFilter === '' ? null : gstinFilter);
  const [pageEpoch, setPageEpoch] = useState(0);

  // The selection belongs to ONE scope (tab + filter): a switch invalidates it
  // in the same render (keyed derivation — guide §1.5).
  const scope = `${tab}|${gstinFilter}`;
  const [selection, setSelection] = useState<{ scope: string; ids: ReadonlySet<string> }>({ scope, ids: new Set() });
  const selectedIds = selection.scope === scope ? selection.ids : new Set<string>();
  const rows = list.state === 'ready' ? list.data.items : [];
  // Resolved against the page on screen: what is ticked is what posts.
  const selected = rows.filter((bill) => selectedIds.has(bill.id));
  const selectedGstin = selectionGstin(selected);
  const { ready, blocked } = splitSelection(selected);

  const [openId, setOpenId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ scope: string; outcome: Outcome } | null>(null);
  const shownOutcome = outcome !== null && outcome.scope === scope ? outcome.outcome : null;
  const [exporting, setExporting] = useState(false);
  const exportInFlight = useRef(false);

  function toggle(bill: EwayBillDto) {
    const next = new Set(selectedIds);
    if (next.has(bill.id)) next.delete(bill.id);
    else next.add(bill.id);
    setSelection({ scope, ids: next });
  }

  /** After any mutation: re-read from page one (the row may have left this tab). */
  function settled(next: Outcome) {
    setOutcome({ scope, outcome: next });
    setSelection({ scope, ids: new Set() });
    setOpenId(null);
    list.onCursor(null);
    setPageEpoch((e) => e + 1);
    notifyEwayChanged();
  }

  const labelOf = (id: string): string => rows.find((bill) => bill.id === id)?.invoiceNo ?? id.slice(0, 8);

  async function download() {
    const session = readSession();
    if (session === null || exportInFlight.current || ready.length === 0 || selectedGstin === null) return;
    exportInFlight.current = true;
    setExporting(true);
    try {
      const { file } = await fetchApiExportEwayBills(
        session.tenant.id,
        ready.map((bill) => bill.id),
        ulid(),
      );
      downloadText(ewayJsonFilename(selectedGstin), `${JSON.stringify(file, null, 2)}\n`, 'application/json');
      settled({
        tone: 'accepted',
        word: 'NIC JSON downloaded',
        reason: `${ready.length} bill${ready.length === 1 ? '' : 's'} for ${selectedGstin}. Upload the file on the e-way portal, then record each returned EWB number here.`,
      });
    } catch (error) {
      setOutcome({ scope, outcome: { tone: 'rejected', word: 'Not exported', reason: exportReason(error, labelOf) } });
    } finally {
      exportInFlight.current = false;
      setExporting(false);
    }
  }

  const columns: DataTableColumn<EwayBillDto>[] = [];
  if (tab === 'pending' && canManage) {
    columns.push({
      key: 'select',
      header: '',
      render: (bill) => (
        <input
          type="checkbox"
          aria-label={`Select ${bill.invoiceNo ?? bill.id}`}
          checked={selectedIds.has(bill.id)}
          disabled={!selectedIds.has(bill.id) && !canSelect(bill, selectedGstin)}
          title={canSelect(bill, selectedGstin) ? undefined : 'One NIC file holds one supplier GSTIN — clear the selection to pick another.'}
          onChange={() => toggle(bill)}
        />
      ),
    });
  }
  columns.push({
    key: 'invoice',
    header: 'Invoice',
    render: (bill) => (
      <span className="flex flex-col">
        <span className="font-mono text-xs">{bill.invoiceNo ?? '—'}</span>
        <span className="font-mono text-xs text-(--muted-foreground)">GSTIN {bill.originGstin}</span>
        {bill.invoiceIssuedAt !== null && (
          <span className="text-xs text-(--muted-foreground)">{invoiceDateLabel(bill.invoiceIssuedAt)}</span>
        )}
      </span>
    ),
  });
  columns.push({ key: 'buyer', header: 'Buyer', render: (bill) => (bill.b2b ? `B2B ${bill.consigneeGstin ?? ''}` : 'B2C') });
  columns.push({ key: 'value', header: 'Value', numeric: true, render: (bill) => formatRupees(bill.consignmentValuePaise) });
  if (tab === 'pending') {
    columns.push({
      key: 'rule',
      header: 'Threshold',
      render: (bill) => (
        <span className="text-xs">
          {thresholdRuleLabel(bill.thresholdRule)} · {formatRupees(bill.thresholdPaise)}
        </span>
      ),
    });
    columns.push({ key: 'transport', header: 'Transport', render: (bill) => <span className="text-xs">{transportSummary(bill.transport)}</span> });
    columns.push({
      key: 'blockers',
      header: 'Blockers',
      render: (bill) => <BlockerBadges bill={bill} canConfigure={canConfigure} />,
    });
    columns.push({
      key: 'exported',
      header: 'Last export',
      render: (bill) => <span className="text-xs">{bill.lastExportedAt === null ? 'Never' : istDateTimeLabel(bill.lastExportedAt)}</span>,
    });
    if (canManage) {
      columns.push({
        key: 'act',
        header: '',
        render: (bill) => (
          <button
            type="button"
            className={rowButtonClass}
            aria-expanded={openId === bill.id}
            aria-controls={expandedRowId(bill.id)}
            onClick={() => setOpenId(openId === bill.id ? null : bill.id)}
          >
            {openId === bill.id ? 'Close' : 'Act'}
          </button>
        ),
      });
    }
  } else if (tab === 'generated') {
    columns.push({ key: 'ewbNo', header: 'EWB number', render: (bill) => <span className="font-mono text-xs">{bill.ewbNo ?? '—'}</span> });
    columns.push({ key: 'generatedAt', header: 'Generated', render: (bill) => istDateTimeLabel(bill.ewbGeneratedAt) });
    columns.push({ key: 'validUntil', header: 'Valid until', render: (bill) => istDateTimeLabel(bill.ewbValidUntil) });
    columns.push({ key: 'source', header: 'Source', render: (bill) => (bill.source === 'gateway' ? 'Gateway' : 'Recorded') });
  } else {
    columns.push({ key: 'reason', header: 'Reason', render: (bill) => bill.dismissedReason ?? '—' });
    columns.push({ key: 'dismissedAt', header: 'Dismissed', render: (bill) => istDateTimeLabel(bill.updatedAt) });
  }

  const gstins = settings.state === 'ready' ? settings.data.map((s) => s.gstin) : [];
  const skipped = skippedLabel(blocked.length);

  return (
    <Section
      title="E-way bills"
      action={
        <button type="button" className={buttonClass} onClick={list.reload}>
          Refresh
        </button>
      }
    >
      <div className="text-(--muted-foreground)">{QUEUE_COPY}</div>

      <div className="flex flex-wrap items-end gap-3">
        <div role="tablist" aria-label="E-way bill status" className="flex gap-1">
          {EWAY_TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? primaryClass : buttonClass}
              onClick={() => {
                setTab(t);
                setOpenId(null);
              }}
            >
              {EWAY_TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Supplier GSTIN</span>
          <select className={selectClass} value={gstinFilter} onChange={(e) => setGstinFilter(e.target.value)} aria-label="Supplier GSTIN">
            <option value="">All GSTINs</option>
            {gstins.map((gstin) => (
              <option key={gstin} value={gstin}>
                {gstin}
              </option>
            ))}
          </select>
        </label>
        {tab === 'pending' && canManage && (
          <div className="flex items-center gap-2">
            <button type="button" className={primaryClass} disabled={ready.length === 0 || exporting} onClick={download}>
              {exporting ? 'Downloading…' : downloadLabel(ready.length)}
            </button>
            {skipped !== null && <span className="text-xs text-(--muted-foreground)">{skipped}</span>}
          </div>
        )}
      </div>

      {shownOutcome !== null && <FeedbackBanner tone={shownOutcome.tone} word={shownOutcome.word} reason={shownOutcome.reason} />}

      {list.state === 'failed' ? (
        <ReadFailure word="E-way bills unavailable" reason={list.reason} onRetry={list.reload} />
      ) : (
        // Mounted while a page loads: its Prev/Next cursor is internal state.
        <DataTable
          key={`${pageEpoch}-${scope}`}
          columns={columns}
          rows={rows}
          nextCursor={list.state === 'ready' ? list.data.nextCursor : null}
          onCursor={list.onCursor}
          emptyMessage={list.state === 'loading' ? 'Loading e-way bills…' : `No ${EWAY_TAB_LABEL[tab].toLowerCase()} e-way bills.`}
          renderExpanded={(bill) =>
            canManage && tab === 'pending' && bill.id === openId ? <BillActions bill={bill} onSettled={settled} labelOf={labelOf} canConfigure={canConfigure} /> : null
          }
        />
      )}

      {canConfigure && <EwaySettings />}
    </Section>
  );
}

function BlockerBadges({ bill, canConfigure }: { bill: EwayBillDto; canConfigure: boolean }) {
  if (bill.blockers.length === 0) {
    return <span className="text-xs text-(--accent)">Ready</span>;
  }
  const terminal = bill.blockers.some((b) => b.terminal);
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap gap-1">
        {bill.blockers.map((blocker) => (
          <span
            key={blocker.code}
            data-blocker={blocker.code}
            title={blockerHint(blocker, canConfigure)}
            className={`rounded-sm border px-1.5 py-0.5 text-xs ${
              blocker.terminal ? 'border-(--destructive) text-(--destructive)' : 'border-(--warning) text-(--warning)'
            }`}
          >
            {blockerLabel(blocker.code)}
          </span>
        ))}
      </span>
      {terminal && <span className="text-xs text-(--muted-foreground)">Generate on the NIC portal, then record the number here.</span>}
      {bill.lastError !== null && <span className="text-xs text-(--destructive)">Gateway: {bill.lastError}</span>}
    </span>
  );
}

/** The row's action panel: Part B, record, dismiss, and Generate when a gateway is available. */
function BillActions({
  bill,
  onSettled,
  labelOf,
  canConfigure,
}: {
  bill: EwayBillDto;
  onSettled: (outcome: Outcome) => void;
  labelOf: (id: string) => string;
  /** Whether the viewer may change the e-invoicing flag (`eway.configure`) — the hints follow it. */
  canConfigure: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 py-1">
      {bill.blockers.some((b) => b.terminal) && (
        <div className="text-xs text-(--muted-foreground)">
          {bill.blockers
            .filter((b) => b.terminal)
            .map((b) => `${blockerLabel(b.code)}: ${blockerHint(b, canConfigure)}`)
            .join(' ')}
        </div>
      )}
      <TransportForm bill={bill} onSettled={onSettled} />
      <RecordForm bill={bill} onSettled={onSettled} />
      <DismissForm bill={bill} onSettled={onSettled} />
      {bill.gatewayAvailable && <GenerateButton bill={bill} onSettled={onSettled} labelOf={labelOf} />}
    </div>
  );
}

/** Part B: the key is per DRAFT — reused across retries, cleared on any edit. */
function TransportForm({ bill, onSettled }: { bill: EwayBillDto; onSettled: (outcome: Outcome) => void }) {
  const [draft, setDraft] = useState<TransportDraft>(() => draftFromTransport(bill.transport));
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inFlight = useRef(false);

  function edit(patch: Partial<TransportDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setKey(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null || inFlight.current) return;
    const parsed = parseTransportDraft(draft);
    if ('problem' in parsed) {
      setProblem(parsed.problem);
      return;
    }
    const idempotencyKey = key ?? ulid();
    setKey(idempotencyKey);
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await fetchApiUpdateEwayTransport(session.tenant.id, bill.id, parsed.body, idempotencyKey);
      onSettled({ tone: 'accepted', word: 'Transport saved', reason: `Part B saved for ${bill.invoiceNo ?? 'the bill'}.` });
    } catch (error) {
      setProblem(transportReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const road = draft.transMode === '1' || draft.transMode === '';
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" aria-label="Transport details">
      <span className={labelClass}>Transport (Part B)</span>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs">
          Mode
          <select className={selectClass} value={draft.transMode} onChange={(e) => edit({ transMode: e.target.value as TransportDraft['transMode'] })} aria-label="Mode">
            <option value="">—</option>
            {[1, 2, 3, 4].map((mode) => (
              <option key={mode} value={String(mode)}>
                {TRANS_MODE_LABEL[mode]}
              </option>
            ))}
          </select>
        </label>
        {road && (
          <>
            <label className="flex flex-col gap-1 text-xs">
              Vehicle no.
              <input className={inputClass} value={draft.vehicleNo} onChange={(e) => edit({ vehicleNo: e.target.value })} aria-label="Vehicle no." maxLength={20} />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Vehicle type
              <select className={selectClass} value={draft.vehicleType} onChange={(e) => edit({ vehicleType: e.target.value as TransportDraft['vehicleType'] })} aria-label="Vehicle type">
                <option value="">—</option>
                <option value="R">Regular</option>
                <option value="O">Over-dimensional</option>
              </select>
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-xs">
          Transporter id
          <input className={inputClass} value={draft.transporterId} onChange={(e) => edit({ transporterId: e.target.value })} aria-label="Transporter id" maxLength={15} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Transporter name
          <input className={inputClass} value={draft.transporterName} onChange={(e) => edit({ transporterName: e.target.value })} aria-label="Transporter name" maxLength={25} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Transport doc no.
          <input className={inputClass} value={draft.transDocNo} onChange={(e) => edit({ transDocNo: e.target.value })} aria-label="Transport doc no." maxLength={15} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Transport doc date
          <input type="date" className={inputClass} value={draft.transDocDate} onChange={(e) => edit({ transDocDate: e.target.value })} aria-label="Transport doc date" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Distance (km)
          <input className={`${inputClass} data`} inputMode="numeric" value={draft.distanceKm} onChange={(e) => edit({ distanceKm: e.target.value })} aria-label="Distance (km)" />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" className={buttonClass} disabled={busy}>
          {busy ? 'Saving…' : 'Save transport'}
        </button>
        <span className="text-xs text-(--muted-foreground)">Blank fields are cleared. A transporter id alone makes a Part-A-only bill.</span>
      </div>
      {problem !== null && <FeedbackBanner tone="rejected" word="Not saved" reason={problem} />}
    </form>
  );
}

function RecordForm({ bill, onSettled }: { bill: EwayBillDto; onSettled: (outcome: Outcome) => void }) {
  const [draft, setDraft] = useState<RecordDraft>({ ewbNo: '', generatedAt: '', validUntil: '' });
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inFlight = useRef(false);

  function edit(patch: Partial<RecordDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setKey(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null || inFlight.current) return;
    const parsed = parseRecordDraft(draft);
    if ('problem' in parsed) {
      setProblem(parsed.problem);
      return;
    }
    const idempotencyKey = key ?? ulid();
    setKey(idempotencyKey);
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const { bill: recorded } = await fetchApiRecordEwayBill(session.tenant.id, bill.id, parsed.body, idempotencyKey);
      onSettled({ tone: 'accepted', word: 'EWB recorded', reason: `${recorded.ewbNo ?? parsed.body.ewbNo} recorded for ${bill.invoiceNo ?? 'the bill'} — it is final.` });
    } catch (error) {
      setProblem(recordReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" aria-label="Record EWB number">
      <span className={labelClass}>Record the EWB number the portal returned</span>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs">
          EWB number
          <input className={`${inputClass} data`} inputMode="numeric" value={draft.ewbNo} onChange={(e) => edit({ ewbNo: e.target.value })} aria-label="EWB number" maxLength={16} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Generated at (IST)
          <input type="datetime-local" className={inputClass} value={draft.generatedAt} onChange={(e) => edit({ generatedAt: e.target.value })} aria-label="Generated at" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Valid until (IST, optional)
          <input type="datetime-local" className={inputClass} value={draft.validUntil} onChange={(e) => edit({ validUntil: e.target.value })} aria-label="Valid until" />
        </label>
      </div>
      <div>
        <button type="submit" className={buttonClass} disabled={busy}>
          {busy ? 'Recording…' : 'Record'}
        </button>
      </div>
      {problem !== null && <FeedbackBanner tone="rejected" word="Not recorded" reason={problem} />}
    </form>
  );
}

function DismissForm({ bill, onSettled }: { bill: EwayBillDto; onSettled: (outcome: Outcome) => void }) {
  const [reason, setReason] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null || inFlight.current) return;
    const parsed = parseDismissReason(reason);
    if ('problem' in parsed) {
      setProblem(parsed.problem);
      return;
    }
    const idempotencyKey = key ?? ulid();
    setKey(idempotencyKey);
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await fetchApiDismissEwayBill(session.tenant.id, bill.id, parsed.reason, idempotencyKey);
      onSettled({ tone: 'accepted', word: 'Dismissed', reason: `${bill.invoiceNo ?? 'The bill'} needs no e-way bill: ${parsed.reason}` });
    } catch (error) {
      setProblem(dismissReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1" aria-label="Dismiss">
      <span className={labelClass}>Dismiss (no e-way bill needed)</span>
      <div className="flex gap-2">
        <input
          className={inputClass}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setKey(null);
          }}
          placeholder="Why no e-way bill is needed"
          aria-label="Dismiss reason"
          maxLength={200}
        />
        <button type="submit" className={`${buttonClass} shrink-0`} disabled={busy}>
          {busy ? 'Dismissing…' : 'Dismiss'}
        </button>
      </div>
      {problem !== null && <FeedbackBanner tone="rejected" word="Not dismissed" reason={problem} />}
    </form>
  );
}

/** Generate through the gateway — a per-click key behind a synchronous re-entry guard. */
function GenerateButton({
  bill,
  onSettled,
  labelOf,
}: {
  bill: EwayBillDto;
  onSettled: (outcome: Outcome) => void;
  labelOf: (id: string) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inFlight = useRef(false);
  async function generate() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const { bill: generated } = await fetchApiGenerateEwayBill(session.tenant.id, bill.id, ulid());
      onSettled({ tone: 'accepted', word: 'EWB generated', reason: `${generated.ewbNo ?? ''} generated through the gateway for ${bill.invoiceNo ?? 'the bill'}.` });
    } catch (error) {
      setProblem(generateEwayReason(error, labelOf));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <div>
        <button type="button" className={primaryClass} disabled={busy} onClick={generate}>
          {busy ? 'Generating…' : 'Generate'}
        </button>
      </div>
      {problem !== null && <FeedbackBanner tone="rejected" word="Not generated" reason={problem} />}
    </div>
  );
}

// ── owner settings ───────────────────────────────────────────────────────────

function EwaySettings() {
  const thresholds = useEwayStateThresholds();
  const settings = useEwayGstinSettings();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [togglingGstin, setTogglingGstin] = useState<string | null>(null);
  const toggleInFlight = useRef(false);

  async function toggle(gstin: string, next: boolean) {
    const session = readSession();
    if (session === null || toggleInFlight.current) return;
    toggleInFlight.current = true;
    setTogglingGstin(gstin);
    try {
      await fetchApiPutEwayGstinSetting(session.tenant.id, gstin, next, ulid());
      setOutcome({ tone: 'accepted', word: 'Setting saved', reason: `E-invoicing ${next ? 'applies' : 'does not apply'} to ${gstin}.` });
      notifyEwayChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not saved', reason: configureReason(error) });
    } finally {
      toggleInFlight.current = false;
      setTogglingGstin(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-(--border) pt-3" aria-label="E-way settings">
      <h3 className="font-medium">E-way settings (owner)</h3>
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}

      <div className="flex flex-col gap-1">
        <span className={labelClass}>E-invoicing per GSTIN</span>
        <span className="text-xs text-(--muted-foreground)">When e-invoicing applies, the GSTIN&apos;s B2B bills are held: NIC refuses them without an IRN.</span>
        {settings.state === 'failed' ? (
          <ReadFailure word="Settings unavailable" reason={settings.reason} onRetry={settings.reload} />
        ) : settings.state === 'loading' ? (
          <span className="text-(--muted-foreground)">Loading…</span>
        ) : settings.data.length === 0 ? (
          <span className="text-(--muted-foreground)">No GSTIN on the tenant or its warehouses.</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {settings.data.map((setting) => (
              <li key={setting.gstin} className="flex items-center gap-2">
                <span className="font-mono text-xs">{setting.gstin}</span>
                <span className="text-xs">{setting.eInvoiceApplies ? 'E-invoicing applies' : 'No e-invoicing'}</span>
                <button
                  type="button"
                  className={rowButtonClass}
                  disabled={togglingGstin !== null}
                  onClick={() => toggle(setting.gstin, !setting.eInvoiceApplies)}
                >
                  {setting.eInvoiceApplies ? 'Turn off' : 'Turn on'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className={labelClass}>Intra-state threshold overrides</span>
        <span className="text-xs text-(--muted-foreground)">{OVERRIDE_COPY}</span>
        {thresholds.state === 'failed' ? (
          <ReadFailure word="Overrides unavailable" reason={thresholds.reason} onRetry={thresholds.reload} />
        ) : thresholds.state === 'loading' ? (
          <span className="text-(--muted-foreground)">Loading…</span>
        ) : thresholds.data.length === 0 ? (
          <span className="text-(--muted-foreground)">No overrides — the national threshold applies everywhere.</span>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs" aria-label="Threshold override history">
              <thead>
                <tr className="text-left">
                  <th className="pr-3">State</th>
                  <th className="pr-3 text-right">Threshold</th>
                  <th className="pr-3">Effective from</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {thresholds.data.map((row) => (
                  <tr key={row.id}>
                    <td className="pr-3">{placeOfSupplyLabel(row.stateCode)}</td>
                    <td className="data pr-3 text-right">{thresholdAmountLabel(row.thresholdPaise)}</td>
                    <td className="pr-3">{row.effectiveFrom}</td>
                    <td>{istDateTimeLabel(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ThresholdForm onSaved={(o) => setOutcome(o)} />
      </div>
    </div>
  );
}

function ThresholdForm({ onSaved }: { onSaved: (outcome: Outcome) => void }) {
  const [draft, setDraft] = useState<ThresholdDraft>({ stateCode: '', amount: '', noneRequired: false, effectiveFrom: '' });
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inFlight = useRef(false);

  function edit(patch: Partial<ThresholdDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setKey(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null || inFlight.current) return;
    const parsed = parseThresholdDraft(draft);
    if ('problem' in parsed) {
      setProblem(parsed.problem);
      return;
    }
    const idempotencyKey = key ?? ulid();
    setKey(idempotencyKey);
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await fetchApiAppendEwayStateThreshold(session.tenant.id, parsed.body, idempotencyKey);
      onSaved({
        tone: 'accepted',
        word: 'Override added',
        reason: `${placeOfSupplyLabel(parsed.body.stateCode)}: ${thresholdAmountLabel(parsed.body.thresholdPaise)} from ${parsed.body.effectiveFrom}. Bills already queued are not re-evaluated.`,
      });
      setDraft({ stateCode: '', amount: '', noneRequired: false, effectiveFrom: '' });
      setKey(null);
      notifyEwayChanged();
    } catch (error) {
      setProblem(configureReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" aria-label="Add threshold override">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs">
          State
          <select className={selectClass} value={draft.stateCode} onChange={(e) => edit({ stateCode: e.target.value })} aria-label="State">
            <option value="">—</option>
            {overrideStateCodes(GST_STATE_NAMES).map((code) => (
              <option key={code} value={code}>
                {placeOfSupplyLabel(code)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Threshold (₹)
          <input
            className={`${inputClass} data`}
            inputMode="decimal"
            value={draft.amount}
            disabled={draft.noneRequired}
            onChange={(e) => edit({ amount: e.target.value })}
            aria-label="Threshold amount"
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={draft.noneRequired} onChange={(e) => edit({ noneRequired: e.target.checked })} aria-label="None required" />
          None required
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Effective from
          <input type="date" className={inputClass} value={draft.effectiveFrom} onChange={(e) => edit({ effectiveFrom: e.target.value })} aria-label="Effective from" />
        </label>
      </div>
      <div>
        <button type="submit" className={buttonClass} disabled={busy}>
          {busy ? 'Adding…' : 'Add override'}
        </button>
      </div>
      {problem !== null && <FeedbackBanner tone="rejected" word="Not added" reason={problem} />}
    </form>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';

import {
  fetchApiCartonLabels,
  fetchApiParcelTag,
  fetchApiRecordAwbAdvice,
  fetchApiRecordClientLabel,
  fetchApiRemoveShippingFile,
  fetchApiUploadOrderDocument,
  fetchApiVerifyClientLabel,
  fetchApiVoidClientShipment,
} from '@/lib/api/client';
import type { ClientShipmentViewDto, FileViewDto } from '@/lib/api/generated';
import type { OrderStatus } from '@/lib/outbound-orders';
import { istDateTimeLabel } from '@/lib/audit-exports';
import { downloadBlob } from '@/lib/csv';
import { notifyOutboundChanged } from '@/lib/outbound';
import {
  clientShipmentLine,
  DOC_KIND_WORD,
  DOCUMENT_ACCEPT,
  fileLine,
  LABEL_ACCEPT,
  normalizeAwb,
  parcelTagFilename,
  parseLabelDraft,
  parseShippingReason,
  prepareShippingFile,
  shippingFileProblem,
  shippingReason,
  STAFF_DOC_KINDS,
  SHIPMENT_STATUS_WORD,
  verifiedLine,
  type StaffUploadDocKind,
} from '@/lib/shipping';
import { useTransporterOptions } from '@/lib/use-gate-ins';
import { useOrderShipping } from '@/lib/use-shipping';
import { useOrderCartons } from '@/lib/use-outbound-pack-dispatch';
import { cartonLabelsFilename, cartonReason, clientLabelPagesWarning } from '@/lib/cartons';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { buttonClass, inputClass, labelClass, primaryClass, ReadFailure, rowButtonClass, selectClass } from '@/components/outbound/shell';
import { StatusChip } from '@/components/shared/status-chip';

/**
 * Story 4-4a (A20) — the order's Shipping panel in the Pack & Dispatch row
 * expansion: the client-arranged shipment (label or pre-advised AWB), the
 * label print and its verification scan, the parcel tag, the staff upload and
 * AWB forms, the void, the order's shipping documents and the handover that
 * dispatched it.
 *
 * Every read is ungated; each affordance is hidden (never disabled) without
 * its capability — the label forms and the void `labels.execute`, the verify
 * `pack.execute`, a document upload `dispatch.execute`, a removal
 * `orders.manage`. Each mutation is pessimistic and keyed by its intent.
 */
export function ShippingPanel({
  tenantId,
  orderId,
  orderLabel,
  status,
  canLabel,
  canPack,
  canDispatch,
  canRemove,
}: {
  tenantId: string;
  orderId: string;
  orderLabel: string;
  status: OrderStatus;
  canLabel: boolean;
  canPack: boolean;
  canDispatch: boolean;
  canRemove: boolean;
}) {
  const read = useOrderShipping(orderId);
  // Story 4-5a (A26, A40) — once packed, the cartons: the carton-label print and the client label's page check.
  const cartons = useOrderCartons(tenantId, status === 'ready_to_dispatch' || status === 'dispatched' ? orderId : null);
  const cartonCount = cartons.state === 'ready' && cartons.data !== null ? cartons.data.pack.cartonCount : null;
  // FB15 — the verify's result outlives the form (the re-read unmounts it); it clears on the next action.
  const [verifiedNotice, setVerifiedNotice] = useState(false);
  const clearNotice = () => setVerifiedNotice(false);

  if (read.state === 'loading') return <div className="text-xs text-(--muted-foreground)">Loading shipping…</div>;
  if (read.state === 'failed') return <ReadFailure word="Shipping unavailable" reason={read.reason} onRetry={read.reload} />;
  // An API without the route (guide §1.13): nothing to say.
  if (read.data === null) return null;

  const data = read.data;
  const live = data.shipment;
  const open = status === 'accepted' || status === 'ready_to_dispatch';
  const clientArranged = live !== null && live.kind !== 'carrier';
  const liveOpen = clientArranged && live.status === 'labelled';

  return (
    <section aria-label="Shipping" className="flex flex-col gap-2 rounded-sm border border-(--border) p-3 text-xs" data-testid="shipping-panel">
      <div className="font-medium">Shipping</div>

      {live === null ? (
        <div className="text-(--muted-foreground)" data-testid="shipping-none">
          No courier record yet{open ? ' — the client can upload its label or send the AWB in the portal, or record it here.' : '.'}
        </div>
      ) : (
        <LiveShipment shipment={live} />
      )}

      {data.label !== null && liveOpen && <LabelLink file={data.label} onExpired={read.refresh} />}

      {/* A40 — warn, never refuse: one page can serve a multi-piece consignment. */}
      {data.label !== null && liveOpen && clientLabelPagesWarning(data.label.pageCount, cartonCount) !== null && (
        <div className="text-(--warning)" data-testid="client-label-pages-warning">
          {clientLabelPagesWarning(data.label.pageCount, cartonCount)}
        </div>
      )}

      {verifiedNotice && (
        <FeedbackBanner tone="accepted" word="Label verified" reason="The label on the parcel carries this order’s AWB." />
      )}

      {canPack && open && live !== null && live.kind === 'client-label' && live.status === 'labelled' && live.labelVerifiedAt === null && (
        <VerifyLabelForm tenantId={tenantId} orderId={orderId} onVerified={() => setVerifiedNotice(true)} />
      )}

      {/* Story 4-5a (A26) — the parcel tag before the pack; the carton labels once packed. */}
      {status === 'accepted' && <ParcelTagButtons tenantId={tenantId} orderId={orderId} orderLabel={orderLabel} />}
      {status === 'ready_to_dispatch' && canLabel && (
        <CartonLabelButtons tenantId={tenantId} orderId={orderId} orderLabel={orderLabel} />
      )}

      {canLabel && open && (live === null || liveOpen) && data.storageEnabled !== false && (
        <ShipmentForms tenantId={tenantId} orderId={orderId} replacing={liveOpen ? live : null} onAction={clearNotice} />
      )}

      {canLabel && open && liveOpen && <VoidShipment tenantId={tenantId} orderId={orderId} />}

      {data.handover !== null && (
        <div className="flex flex-col gap-1 rounded-sm border border-(--border) bg-(--muted) p-2" data-testid="shipping-handover">
          <div>
            <span className="font-mono">{data.handover.code}</span> · handed over to {data.handover.courierName} ·{' '}
            {istDateTimeLabel(data.handover.handedOverAt)} IST
          </div>
          <div className="text-(--muted-foreground)">
            Collected by {data.handover.pickupPersonName}
            {data.handover.pickupPersonPhoneMasked === null ? '' : ` (${data.handover.pickupPersonPhoneMasked})`}
            {data.handover.vehicleNumber === null ? '' : ` · vehicle ${data.handover.vehicleNumber}`}
          </div>
          {data.handover.sheet.length === 0 ? (
            <div className="text-(--warning)">Signed sheet not uploaded yet — upload it on the Handovers tab.</div>
          ) : (
            <FileList files={data.handover.sheet} tenantId={tenantId} canRemove={canRemove} onExpired={read.refresh} />
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="font-medium">Documents</div>
        {data.documents.length === 0 ? (
          <div className="text-(--muted-foreground)">No invoice, challan, e-way bill or POD attached yet.</div>
        ) : (
          <FileList files={data.documents} tenantId={tenantId} canRemove={canRemove} onExpired={read.refresh} />
        )}
        {canDispatch && status !== 'cancelled' && data.storageEnabled !== false && (
          <DocumentUpload tenantId={tenantId} orderId={orderId} dispatched={status === 'dispatched'} onAction={clearNotice} />
        )}
        {data.storageEnabled === false && (
          <div className="text-(--muted-foreground)">This server has no file storage configured, so files cannot be added.</div>
        )}
      </div>

      {data.history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-(--muted-foreground)">Earlier labels ({data.history.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {data.history.map((old) => (
              <li key={old.id} className="text-(--muted-foreground)">
                {clientShipmentLine(old)} · voided{old.voidedAt === null ? '' : ` ${istDateTimeLabel(old.voidedAt)} IST`}
                {old.voidReason === null ? '' : ` — ${old.voidReason}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function LiveShipment({ shipment }: { shipment: ClientShipmentViewDto }) {
  const verified = verifiedLine(shipment);
  return (
    <div className="flex flex-col gap-1" data-testid="shipping-live">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={shipment.status === 'handed_over' ? 'success' : 'info'}>{SHIPMENT_STATUS_WORD[shipment.status]}</StatusChip>
        <span>{clientShipmentLine(shipment)}</span>
      </div>
      {verified !== null && (
        <div className={shipment.labelVerifiedAt === null ? 'text-(--warning)' : 'text-(--muted-foreground)'} data-testid="shipping-verified">
          {verified}
        </div>
      )}
    </div>
  );
}

/** "Print client label" — the presigned PDF in a new tab; the browser's viewer prints it at its own size. */
function LabelLink({ file, onExpired }: { file: FileViewDto; onExpired: () => Promise<void> }) {
  if (file.url === null) {
    return <div className="text-(--muted-foreground)">The client label is stored, but its link could not be signed — refresh to try again.</div>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={file.url}
        target="_blank"
        rel="noopener noreferrer"
        className={rowButtonClass}
        data-testid="print-client-label"
        onClick={(event) => {
          // FB16 — an expired presigned link re-reads the record instead of opening a 403.
          if (file.urlExpiresAt !== null && Date.parse(file.urlExpiresAt) < Date.now() + 5_000) {
            event.preventDefault();
            void onExpired();
          }
        }}
      >
        Print client label
      </a>
      <span className="text-(--muted-foreground)">{fileLine(file)} — print at 100 %, stick it on the parcel, then scan it.</span>
    </div>
  );
}

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/**
 * Verify label (A11): a keyboard-wedge scan field — Enter submits — or
 * "Type the AWB" (method `typed`). The key is bound to the body (code +
 * method): a retry of the same scan replays, a new scan mints a new key.
 */
function VerifyLabelForm({ tenantId, orderId, onVerified }: { tenantId: string; orderId: string; onVerified: () => void }) {
  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [method, setMethod] = useState<'scan' | 'typed'>('scan');
  const [bound, setBound] = useState<{ key: string; body: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useMounted();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const scanned = normalizeAwb(code);
    // FB2 — the field clears and keeps focus after every submit, so the next wedge scan is never appended.
    setCode('');
    inputRef.current?.focus();
    if (scanned === '') {
      setError('Scan the printed label’s barcode, or type its AWB.');
      return;
    }
    const body = JSON.stringify({ scanned, method });
    const next = bound !== null && bound.body === body ? bound : { key: ulid(), body };
    setBound(next);
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await fetchApiVerifyClientLabel(tenantId, orderId, { scannedCode: scanned, method }, next.key);
      notifyOutboundChanged();
      if (!mounted.current) return;
      onVerified();
      setBound(null);
    } catch (caught) {
      if (mounted.current) setError(shippingReason(caught, 'verify'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-sm border border-(--border) p-2" data-testid="verify-label">
      <label className="flex flex-col gap-1 sm:w-80">
        <span className={labelClass}>{method === 'scan' ? 'Scan the printed client label' : 'Type the AWB on the label'}</span>
        <input
          ref={inputRef}
          autoFocus
          className={inputClass}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          aria-describedby="verify-label-hint"
          data-testid="verify-label-input"
        />
      </label>
      <span id="verify-label-hint" className="text-(--muted-foreground)">
        {method === 'scan' ? 'A scanner types the code and presses Enter.' : 'The whole AWB must match the client’s.'}
      </span>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primaryClass}>
          {pending ? 'Verifying…' : 'Verify label'}
        </button>
        <button type="button" className={buttonClass} onClick={() => setMethod((m) => (m === 'scan' ? 'typed' : 'scan'))}>
          {method === 'scan' ? 'Type the AWB instead' : 'Scan instead'}
        </button>
      </div>
      {error !== null && <FeedbackBanner tone="rejected" word="Not verified" reason={error} />}
    </form>
  );
}

/** Story 4-5a (A26) — Print carton labels (4×6): ZPL for the pack station's thermal printer (D7), or the PDF. */
function CartonLabelButtons({ tenantId, orderId, orderLabel }: { tenantId: string; orderId: string; orderLabel: string }) {
  const [pending, setPending] = useState<'zpl' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();

  async function print(format: 'zpl' | 'pdf') {
    if (pending !== null) return;
    setPending(format);
    setError(null);
    try {
      const blob = await fetchApiCartonLabels(tenantId, orderId, { format, layout: 'label' });
      downloadBlob(cartonLabelsFilename(orderLabel, format), blob);
    } catch (caught) {
      if (mounted.current) setError(cartonReason(caught, 'carton-labels'));
    } finally {
      if (mounted.current) setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-(--muted-foreground)">Carton labels (4×6):</span>
        <button type="button" className={rowButtonClass} disabled={pending !== null} onClick={() => void print('zpl')} data-testid="carton-labels-zpl">
          {pending === 'zpl' ? 'Preparing…' : 'Print carton labels'}
        </button>
        <button type="button" className={rowButtonClass} disabled={pending !== null} onClick={() => void print('pdf')} data-testid="carton-labels-pdf">
          {pending === 'pdf' ? 'Preparing…' : 'Carton labels PDF'}
        </button>
      </div>
      {error !== null && <FeedbackBanner tone="rejected" word="Not printed" reason={error} />}
    </div>
  );
}

/** Print parcel tag (4×2): ZPL as a download for a thermal printer, or the PDF. */
function ParcelTagButtons({ tenantId, orderId, orderLabel }: { tenantId: string; orderId: string; orderLabel: string }) {
  const [pending, setPending] = useState<'zpl' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();

  async function print(format: 'zpl' | 'pdf') {
    if (pending !== null) return;
    setPending(format);
    setError(null);
    try {
      const blob = await fetchApiParcelTag(tenantId, orderId, format);
      downloadBlob(parcelTagFilename(orderLabel, format), blob);
    } catch (caught) {
      if (mounted.current) setError(shippingReason(caught, 'parcel-tag'));
    } finally {
      if (mounted.current) setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-(--muted-foreground)">Parcel tag (4×2):</span>
        <button type="button" className={rowButtonClass} disabled={pending !== null} onClick={() => void print('zpl')} data-testid="parcel-tag-zpl">
          {pending === 'zpl' ? 'Preparing…' : 'Print parcel tag (ZPL)'}
        </button>
        <button type="button" className={rowButtonClass} disabled={pending !== null} onClick={() => void print('pdf')} data-testid="parcel-tag-pdf">
          {pending === 'pdf' ? 'Preparing…' : 'Parcel tag PDF'}
        </button>
      </div>
      {error !== null && <FeedbackBanner tone="rejected" word="Not printed" reason={error} />}
    </div>
  );
}

/**
 * Upload client label / Record AWB, for staff on the client's behalf (A8,
 * A9). The courier is a transporter partner or a typed name. The key is
 * bound to the prepared request (file bytes + fields): a retry of the same
 * request replays, any edit or another file mints a new one. With a live
 * label the forms replace it (`replace: true`).
 */
function ShipmentForms({
  tenantId,
  orderId,
  replacing,
  onAction,
}: {
  tenantId: string;
  orderId: string;
  replacing: ClientShipmentViewDto | null;
  onAction: () => void;
}) {
  const [mode, setModeState] = useState<'closed' | 'label' | 'awb'>('closed');
  const transporters = useTransporterOptions();
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState({ awb: '', transporterId: '', courierName: '', packageCount: '' });
  const [bound, setBound] = useState<{ key: string; body: string; file: File | null } | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useMounted();

  function edit(patch: Partial<typeof fields>) {
    setFields((current) => ({ ...current, ...patch }));
  }

  /** FB1 — every mode change starts a clean draft: no invisible stale PDF, fields, problem or key. */
  function setMode(next: 'closed' | 'label' | 'awb') {
    setModeState(next);
    setFile(null);
    setFields({ awb: '', transporterId: '', courierName: '', packageCount: '' });
    setProblem(null);
    setBound(null);
    if (next !== 'closed') {
      setOutcome(null);
      onAction();
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    // FE5 — set before the first await (the file check), so a double submit cannot mint two keys.
    inFlight.current = true;
    const parsed = parseLabelDraft(fields);
    if (parsed.problem !== null) {
      inFlight.current = false;
      setProblem(parsed.problem);
      return;
    }
    if (mode === 'label') {
      const fileIssue = file === null ? 'Choose the client’s label PDF.' : await shippingFileProblem(file, 'label');
      if (fileIssue !== null) {
        inFlight.current = false;
        if (mounted.current) setProblem(fileIssue);
        return;
      }
    }
    const replace = replacing !== null;
    const body = JSON.stringify({ mode, awb: parsed.awb, courier: parsed.courier, packageCount: parsed.packageCount ?? null, replace });
    const fileNow = mode === 'label' ? file : null;
    const next = bound !== null && bound.body === body && bound.file === fileNow ? bound : { key: ulid(), body, file: fileNow };
    setBound(next);
    setPending(true);
    setProblem(null);
    try {
      const shared = {
        awb: parsed.awb,
        ...parsed.courier,
        ...(parsed.packageCount === undefined ? {} : { packageCount: parsed.packageCount }),
        ...(replace ? { replace: true } : {}),
      };
      const { shipment } =
        mode === 'label'
          ? await fetchApiRecordClientLabel(tenantId, orderId, { file: fileNow!, ...shared }, next.key)
          : await fetchApiRecordAwbAdvice(tenantId, orderId, shared, next.key);
      notifyOutboundChanged();
      if (!mounted.current) return;
      setMode('closed');
      setOutcome(`${mode === 'label' ? 'Client label recorded' : 'AWB recorded'} — ${clientShipmentLine(shipment)}.`);
    } catch (caught) {
      if (mounted.current) setProblem(shippingReason(caught, mode === 'label' ? 'label' : 'awb'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  if (mode === 'closed') {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={rowButtonClass} onClick={() => setMode('label')} data-testid="open-client-label">
            {replacing === null ? 'Upload client label' : 'Replace client label'}
          </button>
          <button type="button" className={rowButtonClass} onClick={() => setMode('awb')} data-testid="open-record-awb">
            {replacing === null ? 'Record AWB' : 'Replace with an AWB only'}
          </button>
        </div>
        {outcome !== null && <FeedbackBanner tone="accepted" word="Recorded" reason={outcome} />}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-sm border border-(--border) p-2" data-testid="shipment-form">
      <div className="text-(--muted-foreground)">
        {mode === 'label'
          ? 'The client’s label PDF (the courier’s 4×6 label) with its AWB — the bench prints it and the operator scans it onto the parcel.'
          : 'The courier brings its own label: record the AWB the client pre-advised; the handover scans it.'}
        {replacing !== null && ` This replaces ${clientShipmentLine(replacing)} — the old one is voided.`}
      </div>
      {mode === 'label' && (
        <label className="flex flex-col gap-1 sm:w-80">
          <span className={labelClass}>Label PDF</span>
          <input
            type="file"
            accept={LABEL_ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            data-testid="client-label-file"
          />
        </label>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>AWB / LR number</span>
          <input className={inputClass} value={fields.awb} onChange={(e) => edit({ awb: e.target.value })} autoComplete="off" />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Transporter</span>
          <select className={selectClass} value={fields.transporterId} onChange={(e) => edit({ transporterId: e.target.value })}>
            <option value="">Type the courier’s name instead</option>
            {transporters.state === 'ready' &&
              transporters.data.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.code} — {partner.name}
                </option>
              ))}
          </select>
        </label>
        {fields.transporterId === '' && (
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Courier</span>
            <input className={inputClass} value={fields.courierName} onChange={(e) => edit({ courierName: e.target.value })} placeholder="Delhivery" />
          </label>
        )}
        <label className="flex flex-col gap-1 sm:w-24">
          <span className={labelClass}>Parcels</span>
          <input className={inputClass} inputMode="numeric" value={fields.packageCount} onChange={(e) => edit({ packageCount: e.target.value })} placeholder="1" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primaryClass}>
          {pending ? 'Recording…' : mode === 'label' ? 'Record client label' : 'Record AWB'}
        </button>
        <button type="button" disabled={pending} className={buttonClass} onClick={() => setMode('closed')}>
          Discard
        </button>
      </div>
      {problem !== null && <FeedbackBanner tone="rejected" word="Not recorded" reason={problem} />}
    </form>
  );
}

/** Void (A10) — an inline confirmation with a reason; the key per confirmation, bound to the reason. */
function VoidShipment({ tenantId, orderId }: { tenantId: string; orderId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [bound, setBound] = useState<{ key: string; reason: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useMounted();

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseShippingReason(text);
    if (parsed.reason === null) {
      setProblem(parsed.problem);
      return;
    }
    const next = bound !== null && bound.reason === parsed.reason ? bound : { key: ulid(), reason: parsed.reason };
    setBound(next);
    inFlight.current = true;
    setPending(true);
    setProblem(null);
    try {
      await fetchApiVoidClientShipment(tenantId, orderId, parsed.reason, next.key);
      notifyOutboundChanged();
      if (!mounted.current) return;
      setOpen(false);
      setText('');
      setBound(null);
    } catch (caught) {
      if (mounted.current) setProblem(shippingReason(caught, 'void'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  if (!open) {
    return (
      <div>
        <button type="button" className={rowButtonClass} onClick={() => setOpen(true)} data-testid="open-void-shipment">
          Void label
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={confirm} className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-2" data-testid="void-shipment">
      <label className="flex flex-col gap-1 sm:w-96">
        <span className={labelClass}>Why void this label? The order goes back to having no courier record.</span>
        <input className={inputClass} value={text} onChange={(e) => setText(e.target.value)} maxLength={200} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primaryClass}>
          {pending ? 'Voiding…' : 'Void label'}
        </button>
        <button type="button" disabled={pending} className={buttonClass} onClick={() => setOpen(false)}>
          Keep it
        </button>
      </div>
      {problem !== null && <FeedbackBanner tone="rejected" word="Not voided" reason={problem} />}
    </form>
  );
}

/** A file list with download links and, for `orders.manage`, Remove (an inline reason). */
export function FileList({
  files,
  tenantId,
  canRemove,
  onExpired,
}: {
  files: readonly FileViewDto[];
  tenantId: string;
  canRemove: boolean;
  onExpired: () => Promise<void>;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  return (
    <ul className="flex flex-col gap-1" data-testid="shipping-files">
      {files.map((file) => (
        <li key={file.id} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {file.url === null ? (
              <span>{fileLine(file)}</span>
            ) : (
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-(--primary) underline underline-offset-2"
                onClick={(event) => {
                  // A presigned URL expires (≈ 300 s): an expired one refetches the record instead of opening a 403.
                  if (file.urlExpiresAt !== null && Date.parse(file.urlExpiresAt) < Date.now() + 5_000) {
                    event.preventDefault();
                    void onExpired();
                  }
                }}
              >
                {fileLine(file)}
              </a>
            )}
            {file.uploadedAt !== null && <span className="text-(--muted-foreground)">{istDateTimeLabel(file.uploadedAt)} IST</span>}
            {canRemove && removing === null && (
              <button type="button" className={rowButtonClass} onClick={() => setRemoving(file.id)} data-testid="open-remove-file">
                Remove
              </button>
            )}
          </div>
          {removing === file.id && <RemoveFile tenantId={tenantId} file={file} onClose={() => setRemoving(null)} />}
        </li>
      ))}
    </ul>
  );
}

function RemoveFile({ tenantId, file, onClose }: { tenantId: string; file: FileViewDto; onClose: () => void }) {
  const [text, setText] = useState('');
  const [bound, setBound] = useState<{ key: string; reason: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useMounted();

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseShippingReason(text);
    if (parsed.reason === null) {
      setProblem(parsed.problem);
      return;
    }
    const next = bound !== null && bound.reason === parsed.reason ? bound : { key: ulid(), reason: parsed.reason };
    setBound(next);
    inFlight.current = true;
    setPending(true);
    setProblem(null);
    try {
      await fetchApiRemoveShippingFile(tenantId, file.id, parsed.reason, next.key);
      notifyOutboundChanged();
      if (mounted.current) onClose();
    } catch (caught) {
      if (mounted.current) setProblem(shippingReason(caught, 'remove'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <form onSubmit={confirm} className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-2" data-testid="remove-file">
      <label className="flex flex-col gap-1 sm:w-96">
        <span className={labelClass}>Why remove {file.fileName}? The record keeps who and why.</span>
        <input className={inputClass} value={text} onChange={(e) => setText(e.target.value)} maxLength={200} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primaryClass}>
          {pending ? 'Removing…' : 'Remove file'}
        </button>
        <button type="button" disabled={pending} className={buttonClass} onClick={onClose}>
          Keep it
        </button>
      </div>
      {problem !== null && <FeedbackBanner tone="rejected" word="Not removed" reason={problem} />}
    </form>
  );
}

/** Upload document (A14): a kind and a file; the key per prepared file and kind. */
function DocumentUpload({ tenantId, orderId, dispatched, onAction }: { tenantId: string; orderId: string; dispatched: boolean; onAction: () => void }) {
  const [kind, setKind] = useState<StaffUploadDocKind>(dispatched ? 'pod' : 'invoice');
  const [prepared, setPrepared] = useState<{ file: File; key: string; kind: StaffUploadDocKind } | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useMounted();
  const inputRef = useRef<HTMLInputElement>(null);

  // FE9 — only the newest pick may land.
  const pickSeq = useRef(0);

  async function onPick(picked: File | null) {
    const mine = ++pickSeq.current;
    setProblem(null);
    setOutcome(null);
    onAction();
    if (picked === null) {
      setPrepared(null);
      return;
    }
    const result = await prepareShippingFile(picked);
    if (!mounted.current || mine !== pickSeq.current) return;
    if (!result.ok) {
      setPrepared(null);
      setProblem(result.problem);
      return;
    }
    setPrepared({ file: result.file, key: ulid(), kind });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (prepared === null) {
      setProblem('Choose the file to attach.');
      return;
    }
    // The kind is in the request hash: a kind changed after picking mints a new key.
    const next = prepared.kind === kind ? prepared : { ...prepared, key: ulid(), kind };
    setPrepared(next);
    inFlight.current = true;
    setPending(true);
    setProblem(null);
    try {
      await fetchApiUploadOrderDocument(tenantId, orderId, next.file, next.kind, next.key);
      notifyOutboundChanged();
      if (!mounted.current) return;
      setOutcome(
        `${DOC_KIND_WORD[next.kind]} attached${dispatched ? ' — opted-in client contacts are emailed the file' : ' — the client is emailed it when the order is dispatched'}.`,
      );
      setPrepared(null);
      if (inputRef.current !== null) inputRef.current.value = '';
    } catch (caught) {
      // The prepared file and its key stay: Retry posts the same bytes under the same key.
      if (mounted.current) setProblem(shippingReason(caught, 'document'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" data-testid="document-upload">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Document</span>
          <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as StaffUploadDocKind)}>
            {STAFF_DOC_KINDS.map((k) => (
              <option key={k} value={k}>
                {DOC_KIND_WORD[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>File (PDF or photo, ≤ 10 MB)</span>
          <input ref={inputRef} type="file" accept={DOCUMENT_ACCEPT} onChange={(e) => void onPick(e.target.files?.[0] ?? null)} data-testid="document-file" />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Uploading…' : 'Upload document'}
        </button>
      </div>
      {outcome !== null && <FeedbackBanner tone="accepted" word="Attached" reason={outcome} />}
      {problem !== null && <FeedbackBanner tone="rejected" word="Not attached" reason={problem} />}
    </form>
  );
}


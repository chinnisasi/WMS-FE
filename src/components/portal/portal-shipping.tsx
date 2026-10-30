'use client';

import { useEffect, useRef, useState } from 'react';

import {
  fetchApiPortalAdviseAwb,
  fetchApiPortalUploadClientLabel,
  fetchApiPortalUploadOrderDocument,
} from '@/lib/api/client';
import type { PortalFileDto } from '@/lib/api/generated';
import {
  PORTAL_DOC_KIND_LABEL,
  PORTAL_SHIPPING_STATUS_TONE,
  portalCartonRow,
  portalCartonsSummary,
  portalFileLine,
  type PortalCarton,
  portalShippingLine,
  portalShippingReason,
} from '@/lib/portal';
import {
  DOCUMENT_ACCEPT,
  LABEL_ACCEPT,
  parseLabelDraft,
  PORTAL_DOC_KINDS,
  prepareShippingFile,
  shippingFileProblem,
} from '@/lib/shipping';
import { ulid } from '@/lib/ulid';
import { usePortalOrderShipping, usePortalPackingSlipDownload, usePortalTenantId } from '@/lib/use-portal';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure, buttonClass, inputClass, labelClass, primaryClass, rowButtonClass, selectClass } from '@/components/shared/surface';
import { StatusChip } from '@/components/shared/status-chip';

type PortalDocKind = (typeof PORTAL_DOC_KINDS)[number];

/**
 * Story 4-4a (A21) — the portal order's Shipping section: the status line in
 * the client's words, its label (Upload label / Replace label before the
 * handover), "Send AWB only" (the courier brings its labels), and Documents
 * (download links; upload an invoice, challan, e-way bill or other). Explicit
 * downloads only — never a print fallback. The forms mirror the server's AWB
 * and file rules before a key is minted; each key is bound to its request.
 */
export function PortalShipping({ orderId, orderLabel, canWrite }: { orderId: string; orderLabel: string; canWrite: boolean }) {
  const shipping = usePortalOrderShipping(orderId);
  const [form, setForm] = useState<'closed' | 'label' | 'awb'>('closed');
  const [notice, setNotice] = useState<{ word: string; reason: string } | null>(null);

  if (shipping.state === 'loading') return <div className="text-(--muted-foreground)">Loading shipping…</div>;
  if (shipping.state === 'failed') {
    // An API without the route (the web deployed first): the section says nothing.
    if (shipping.notFound) return null;
    return <ReadFailure word="Shipping not loaded" reason={shipping.reason} onRetry={shipping.reload} />;
  }
  const data = shipping.data;
  // FB9 — the server decides whether the label / AWB may still change (`canRecord`).
  const recordable = canWrite && data.canRecord;
  const hasShipment = data.awb !== null && data.status !== 'no-label-yet';
  const onDone = (word: string, message: string) => {
    setForm('closed');
    setNotice({ word, reason: message });
    void shipping.refresh();
  };
  // FB15 — a success banner clears on the next action.
  const openForm = (mode: 'label' | 'awb') => {
    setNotice(null);
    setForm(mode);
  };

  return (
    <section aria-label="Shipping" className="flex flex-col gap-2 text-xs" data-testid="portal-shipping">
      <h4 className="text-sm font-medium">Shipping</h4>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={PORTAL_SHIPPING_STATUS_TONE[data.status]}>{portalShippingLine(data)}</StatusChip>
        {data.packageCount !== null && <span className="data">{data.packageCount} {data.packageCount === 1 ? 'parcel' : 'parcels'}</span>}
      </div>
      {(data.handoverCode !== null || data.vehicleNumber !== null || data.pickupPersonName !== null) && (
        <div className="text-(--muted-foreground)" data-testid="portal-shipping-handover">
          {[
            data.handoverCode === null ? null : `Handover ${data.handoverCode}`,
            data.pickupPersonName === null ? null : `collected by ${data.pickupPersonName}`,
            data.vehicleNumber === null ? null : `vehicle ${data.vehicleNumber}`,
          ]
            .filter((part): part is string => part !== null)
            .join(' · ')}
        </div>
      )}
      {notice !== null && <FeedbackBanner tone="accepted" word={notice.word} reason={notice.reason} />}

      {/* Story 4-5a (A28) — the cartons and the packing slip. */}
      {/* An API from before 4-5a omits both keys: read absent as none. */}
      {((data.cartons ?? null) !== null || data.packingSlipAvailable === true) && (
        <PortalCartons orderId={orderId} orderLabel={orderLabel} cartons={data.cartons ?? null} slipAvailable={data.packingSlipAvailable === true} />
      )}

      {data.label !== null && <PortalFiles title="Your label" files={[data.label]} onExpired={shipping.refresh} />}

      {recordable && form === 'closed' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={rowButtonClass} onClick={() => openForm('label')} data-testid="portal-open-label">
            {hasShipment ? 'Replace label' : 'Upload label'}
          </button>
          <button type="button" className={rowButtonClass} onClick={() => openForm('awb')} data-testid="portal-open-awb">
            Send AWB only
          </button>
        </div>
      )}
      {recordable && form !== 'closed' && (
        <PortalShipmentForm orderId={orderId} mode={form} replace={hasShipment} onCancel={() => setForm('closed')} onDone={onDone} />
      )}

      {data.handoverSheet.length > 0 && <PortalFiles title="Signed handover sheet" files={data.handoverSheet} onExpired={shipping.refresh} />}
      <PortalFiles title="Documents" files={data.documents} onExpired={shipping.refresh} empty="No invoice, e-way bill or proof of delivery yet." />
      {canWrite && data.status !== 'cancelled' && <PortalDocumentUpload orderId={orderId} onDone={onDone} onStart={() => setNotice(null)} />}
    </section>
  );
}

/**
 * Story 4-5a (A28) — "3 cartons · 12.4 kg", the carton rows (number, weight,
 * totals per unit) and Download packing slip (PDF): an explicit download,
 * never a print fallback. Never a carton code, a case id or who packed (A19).
 */
function PortalCartons({
  orderId,
  orderLabel,
  cartons,
  slipAvailable,
}: {
  orderId: string;
  orderLabel: string;
  cartons: readonly PortalCarton[] | null;
  slipAvailable: boolean;
}) {
  const slip = usePortalPackingSlipDownload(orderId, orderLabel);
  return (
    <div className="flex flex-col gap-1" data-testid="portal-cartons">
      {cartons !== null && cartons.length > 0 && (
        <>
          <div className="font-medium" data-testid="portal-cartons-summary">
            {portalCartonsSummary(cartons)}
          </div>
          <ul className="flex flex-col gap-0.5">
            {cartons.map((carton) => (
              <li key={carton.seq} className="data">
                {portalCartonRow(carton, cartons.length)}
              </li>
            ))}
          </ul>
        </>
      )}
      {slipAvailable && (
        <div>
          <button type="button" className={buttonClass} disabled={slip.busy} onClick={() => void slip.download()} data-testid="portal-packing-slip">
            {slip.busy ? 'Preparing…' : 'Download packing slip (PDF)'}
          </button>
        </div>
      )}
      {slip.refused !== null && <FeedbackBanner tone="rejected" word="Not downloaded" reason={slip.refused} />}
    </div>
  );
}

function PortalFiles({
  title,
  files,
  onExpired,
  empty,
}: {
  title: string;
  files: readonly PortalFileDto[];
  onExpired: () => Promise<void>;
  empty?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{title}</span>
      {files.length === 0 ? (
        <span className="text-(--muted-foreground)">{empty ?? 'None yet.'}</span>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="portal-shipping-files">
          {files.map((file) => (
            <li key={file.id}>
              {file.url === null ? (
                <span>{portalFileLine(file)} — download unavailable, refresh to try again</span>
              ) : (
                <a
                  href={file.url}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-(--primary) underline underline-offset-2"
                  onClick={(event) => {
                    // A presigned link expires: an expired one re-reads the section instead of opening a 403.
                    if (file.urlExpiresAt !== null && Date.parse(file.urlExpiresAt) < Date.now() + 5_000) {
                      event.preventDefault();
                      void onExpired();
                    }
                  }}
                >
                  Download {portalFileLine(file)}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
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

/** Upload label (PDF + AWB + courier + parcels) or Send AWB only; `replace` before the handover. */
function PortalShipmentForm({
  orderId,
  mode,
  replace,
  onCancel,
  onDone,
}: {
  orderId: string;
  mode: 'label' | 'awb';
  replace: boolean;
  onCancel: () => void;
  onDone: (word: string, message: string) => void;
}) {
  const tenantId = usePortalTenantId();
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState({ awb: '', courierName: '', packageCount: '' });
  const [bound, setBound] = useState<{ key: string; body: string; file: File | null } | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useMounted();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || tenantId === null) return;
    // FE6 — the in-flight flag is set before the first await (the file check), so a double submit sends once.
    inFlight.current = true;
    const parsed = parseLabelDraft({ ...fields, transporterId: '' });
    if (parsed.problem !== null) {
      inFlight.current = false;
      setProblem(parsed.problem);
      return;
    }
    const courierName = 'courierName' in parsed.courier ? parsed.courier.courierName : '';
    if (mode === 'label') {
      const issue = file === null ? 'Choose your label PDF.' : await shippingFileProblem(file, 'label');
      if (issue !== null) {
        inFlight.current = false;
        if (mounted.current) setProblem(issue);
        return;
      }
    }
    const body = JSON.stringify({ mode, awb: parsed.awb, courierName, packageCount: parsed.packageCount ?? null, replace });
    const fileNow = mode === 'label' ? file : null;
    const next = bound !== null && bound.body === body && bound.file === fileNow ? bound : { key: ulid(), body, file: fileNow };
    setBound(next);
    setPending(true);
    setProblem(null);
    try {
      const shared = {
        awb: parsed.awb,
        courierName,
        ...(parsed.packageCount === undefined ? {} : { packageCount: parsed.packageCount }),
        ...(replace ? { replace: true } : {}),
      };
      if (mode === 'label') await fetchApiPortalUploadClientLabel(tenantId, orderId, { file: fileNow!, ...shared }, next.key);
      else await fetchApiPortalAdviseAwb(tenantId, orderId, shared, next.key);
      if (mounted.current) onDone('Sent', mode === 'label' ? `Label received — AWB ${parsed.awb}.` : `AWB ${parsed.awb} received — your courier brings its labels.`);
    } catch (caught) {
      if (mounted.current) setProblem(portalShippingReason(caught, mode === 'label' ? 'label' : 'awb'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-2 rounded-sm border border-(--border) p-2" data-testid="portal-shipment-form">
      <span className="text-(--muted-foreground)">
        {mode === 'label'
          ? 'Your courier’s label as a PDF (4×6), with its AWB — the warehouse prints it and scans it onto the parcel.'
          : 'Your courier brings its own labels — send the AWB so the warehouse can match the parcel at pickup.'}
        {replace && ' This replaces the label or AWB you sent before.'}
      </span>
      {mode === 'label' && (
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Label PDF (≤ 10 MB)</span>
          <input type="file" accept={LABEL_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="portal-label-file" />
        </label>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>AWB / LR number</span>
          <input className={inputClass} value={fields.awb} onChange={(e) => setFields((f) => ({ ...f, awb: e.target.value }))} autoComplete="off" />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Courier</span>
          <input className={inputClass} value={fields.courierName} onChange={(e) => setFields((f) => ({ ...f, courierName: e.target.value }))} placeholder="Delhivery" />
        </label>
        <label className="flex flex-col gap-1 sm:w-24">
          <span className={labelClass}>Parcels</span>
          <input className={inputClass} inputMode="numeric" value={fields.packageCount} onChange={(e) => setFields((f) => ({ ...f, packageCount: e.target.value }))} placeholder="1" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primaryClass}>
          {pending ? 'Sending…' : mode === 'label' ? (replace ? 'Replace label' : 'Upload label') : 'Send AWB'}
        </button>
        <button type="button" disabled={pending} className={buttonClass} onClick={onCancel}>
          Discard
        </button>
      </div>
      {problem !== null && <FeedbackBanner tone="rejected" word="Not sent" reason={problem} />}
    </form>
  );
}

/** Upload invoice / challan / e-way bill / other (never a POD); the key per prepared file and kind. */
function PortalDocumentUpload({ orderId, onDone, onStart }: { orderId: string; onDone: (word: string, message: string) => void; onStart: () => void }) {
  const tenantId = usePortalTenantId();
  const [kind, setKind] = useState<PortalDocKind>('invoice');
  const [prepared, setPrepared] = useState<{ file: File; key: string; kind: PortalDocKind } | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useMounted();
  // FE9 — only the newest pick may land: a slower earlier preparation never overwrites a later one.
  const pickSeq = useRef(0);

  async function onPick(picked: File | null) {
    const mine = ++pickSeq.current;
    setProblem(null);
    onStart();
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
    if (inFlight.current || tenantId === null) return;
    if (prepared === null) {
      setProblem('Choose the file to upload.');
      return;
    }
    const next = prepared.kind === kind ? prepared : { ...prepared, key: ulid(), kind };
    setPrepared(next);
    inFlight.current = true;
    setPending(true);
    setProblem(null);
    try {
      await fetchApiPortalUploadOrderDocument(tenantId, orderId, next.file, next.kind, next.key);
      if (!mounted.current) return;
      setPrepared(null);
      if (inputRef.current !== null) inputRef.current.value = '';
      onDone('Uploaded', `${PORTAL_DOC_KIND_LABEL[next.kind]} uploaded.`);
    } catch (caught) {
      if (mounted.current) setProblem(portalShippingReason(caught, 'document'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" data-testid="portal-document-upload">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Document</span>
          <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as PortalDocKind)}>
            {PORTAL_DOC_KINDS.map((k) => (
              <option key={k} value={k}>
                {PORTAL_DOC_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>File (PDF or photo, ≤ 10 MB)</span>
          <input ref={inputRef} type="file" accept={DOCUMENT_ACCEPT} onChange={(e) => void onPick(e.target.files?.[0] ?? null)} data-testid="portal-document-file" />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Uploading…' : 'Upload document'}
        </button>
      </div>
      {problem !== null && <FeedbackBanner tone="rejected" word="Not uploaded" reason={problem} />}
    </form>
  );
}

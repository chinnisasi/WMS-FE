'use client';

import { useRef, useState } from 'react';

import { fetchApiLpnLabels, fetchApiMintLpns, fetchApiVoidLpn } from '@/lib/api/client';
import type { GoodsReceiptLineEntryDto, LpnDto, SkuResponse, VoidLpnRequestDto } from '@/lib/api/generated';
import { notifyInboundChanged } from '@/lib/asns';
import type { LabelFormat, LabelPaper } from '@/lib/bin-labels';
import { downloadBlob } from '@/lib/csv';
import {
  LPN_VOID_REASONS,
  MAX_LABELS_PER_MINT,
  chunkIds,
  defaultUnitsPerLabel,
  lpnLabelsBody,
  lpnLabelsFilename,
  lpnRefusal,
  mintedButNotDownloaded,
  lpnStatusLabel,
  mintBody,
  splitLabelQuantities,
  splitPreview,
  voidBody,
  type LpnRefusal,
} from '@/lib/lpn-labels';
import { ulid } from '@/lib/ulid';

const selectClass =
  'w-full appearance-none rounded-sm border border-(--input) bg-(--background) px-2 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-(--ring)';
const buttonClass =
  'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-60';
const primaryClass =
  'rounded-md bg-(--primary) px-2.5 py-1.5 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60';

const PAPER_LABEL: Readonly<Record<LabelPaper, string>> = {
  '4x2': '4 × 2 in label',
  '2x1': '2 × 1 in label',
  a4: 'A4 sheet (24 per page)',
};

/** The format and paper choices (2-10a's dialog choices): ZPL takes a thermal size; PDF also the A4 sheet. */
function PaperPicker({
  format,
  paper,
  onFormat,
  onPaper,
}: {
  format: LabelFormat;
  paper: LabelPaper;
  onFormat: (format: LabelFormat) => void;
  onPaper: (paper: LabelPaper) => void;
}) {
  const papers: readonly LabelPaper[] = format === 'pdf' ? ['4x2', '2x1', 'a4'] : ['4x2', '2x1'];
  return (
    <div className="flex gap-2">
      <label className="flex flex-col gap-0.5">
        <span className="text-xs font-medium">Format</span>
        <select className={selectClass} value={format} onChange={(e) => onFormat(e.target.value as LabelFormat)}>
          <option value="zpl">ZPL — Zebra thermal (203 dpi)</option>
          <option value="pdf">PDF</option>
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-xs font-medium">{format === 'pdf' ? 'Size or sheet' : 'Label size'}</span>
        <select className={selectClass} value={effectivePaper(format, paper)} onChange={(e) => onPaper(e.target.value as LabelPaper)}>
          {papers.map((p) => (
            <option key={p} value={p}>
              {PAPER_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function effectivePaper(format: LabelFormat, paper: LabelPaper): LabelPaper {
  return format === 'zpl' && paper === 'a4' ? '4x2' : paper;
}

/**
 * A5 — downloads `ids` (code order) in chunks of 1000, one file per chunk
 * (`…-part<n>of<m>` when there is more than one). Returns the file names.
 */
async function downloadLpnLabels(
  tenantId: string,
  grnId: string,
  grnCode: string,
  ids: readonly string[],
  format: LabelFormat,
  paper: LabelPaper,
): Promise<string[]> {
  const chunks = chunkIds(ids);
  const names: string[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const body = lpnLabelsBody({ lpnIds: chunk }, format, effectivePaper(format, paper));
    const blob = await fetchApiLpnLabels(tenantId, grnId, body);
    const name = lpnLabelsFilename(grnCode, body.format, Date.now(), { n: index + 1, of: chunks.length });
    downloadBlob(name, blob);
    names.push(name);
  }
  return names;
}

/** A mint that committed, whose download then failed (its message is the full sentence). */
class MintedNotDownloaded extends Error {}

function RefusalView({ refusal }: { refusal: LpnRefusal }) {
  return (
    <div role="alert" className="flex flex-col gap-1 text-xs text-(--destructive)">
      <span>{refusal.reason}</span>
      {refusal.lpnCodes.length > 0 && (
        <ul className="flex flex-wrap gap-1 font-mono">
          {refusal.lpnCodes.map((code) => (
            <li key={code} className="rounded-sm border border-(--destructive) px-1.5 py-0.5">
              {code}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Story 2-10b — "Download all LPN labels" for a receipt: every LPN that is not
 * voided, in code order, chunked by 1000 (A5). Shown only with
 * `labels.execute` (the caller gates it).
 */
export function LpnDownloadAll({ tenantId, grnId, grnCode, lpns }: { tenantId: string; grnId: string; grnCode: string; lpns: readonly LpnDto[] }) {
  const [format, setFormat] = useState<LabelFormat>('zpl');
  const [paper, setPaper] = useState<LabelPaper>('4x2');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<LpnRefusal | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const inFlight = useRef(false);
  const ids = lpns.filter((lpn) => lpn.status !== 'voided').map((lpn) => lpn.id);
  if (ids.length === 0) return null;

  async function download() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setRefusal(null);
    setDone(null);
    try {
      const names = await downloadLpnLabels(tenantId, grnId, grnCode, ids, format, paper);
      setDone(`${names.length === 1 ? names[0] : `${names.length} files`} downloaded`);
    } catch (error) {
      setRefusal(lpnRefusal(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 rounded-sm border border-(--border) p-2" data-testid="lpn-download-all">
      <div className="flex flex-wrap items-end gap-2">
        <PaperPicker format={format} paper={paper} onFormat={setFormat} onPaper={setPaper} />
        <button type="button" className={primaryClass} disabled={busy} onClick={() => download()}>
          {busy ? 'Downloading…' : `Download all LPN labels (${ids.length})`}
        </button>
      </div>
      {done !== null && <span className="text-xs text-(--muted-foreground)">{done}</span>}
      {refusal !== null && <RefusalView refusal={refusal} />}
    </div>
  );
}

/**
 * Story 2-10b — one GRN line's labels: its LPNs (code, quantity, status) with
 * reprint checkboxes and Void on an active row, and the mint form ("Units per
 * pallet/carton", defaulting to the SKU's pallet, carton or case level, with
 * a preview such as "3 labels: 40, 40, 20"). "Create and download" mints
 * under a per-draft key (reused across retries of an unchanged request,
 * fresh after any edit — guide §2.1), then downloads the new labels.
 */
export function LpnLabelsPanel({
  tenantId,
  grnId,
  grnCode,
  line,
  sku,
  lpns,
  unlabelled,
  onClose,
}: {
  tenantId: string;
  grnId: string;
  grnCode: string;
  line: Pick<GoodsReceiptLineEntryDto, 'id' | 'skuCode'>;
  sku: SkuResponse | null;
  /** This line's LPNs, code order. */
  lpns: readonly LpnDto[];
  /** What may still go on labels — the server's figure (the list read's `lines[].unlabelledQty`). */
  unlabelled: number;
  onClose: () => void;
}) {
  const precision = sku?.uomPrecision ?? 0;
  const [perLabel, setPerLabel] = useState(() => String(defaultUnitsPerLabel(sku, unlabelled) || ''));
  const [format, setFormat] = useState<LabelFormat>('zpl');
  const [paper, setPaper] = useState<LabelPaper>('4x2');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<LpnRefusal | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<{ lpnId: string; code: string; reason: VoidLpnRequestDto['reasonCode']; note: string; key: string } | null>(null);
  const inFlight = useRef(false);
  // The per-draft key: reused while the body is unchanged, re-minted after any edit.
  const mintKey = useRef<{ key: string; body: string } | null>(null);

  const quantities = splitLabelQuantities(unlabelled, Number(perLabel), precision);
  const tooMany = quantities.length > MAX_LABELS_PER_MINT;

  async function run(work: () => Promise<string>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setRefusal(null);
    setDone(null);
    try {
      setDone(await work());
    } catch (error) {
      setRefusal(error instanceof MintedNotDownloaded ? { reason: error.message, lpnCodes: [] } : lpnRefusal(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function createAndDownload() {
    return run(async () => {
      const body = mintBody(line.id, quantities);
      const fingerprint = JSON.stringify(body);
      if (mintKey.current === null || mintKey.current.body !== fingerprint) mintKey.current = { key: ulid(), body: fingerprint };
      const minted = await fetchApiMintLpns(tenantId, grnId, body, mintKey.current.key);
      mintKey.current = null;
      notifyInboundChanged();
      let names: string[];
      try {
        names = await downloadLpnLabels(tenantId, grnId, grnCode, minted.lpns.map((lpn) => lpn.id), format, paper);
      } catch (error) {
        // The labels EXIST: say which, and point at the reprint — never invite a second create.
        throw new MintedNotDownloaded(mintedButNotDownloaded(minted.lpns.map((lpn) => lpn.code), lpnRefusal(error).reason));
      }
      return `${minted.lpns.length} ${minted.lpns.length === 1 ? 'label' : 'labels'} created (${minted.lpns[0]!.code}${minted.lpns.length > 1 ? `–${minted.lpns[minted.lpns.length - 1]!.code}` : ''}); ${names.join(', ')} downloaded`;
    });
  }

  function reprint() {
    return run(async () => {
      const ids = lpns.filter((lpn) => selected.has(lpn.id)).map((lpn) => lpn.id);
      const names = await downloadLpnLabels(tenantId, grnId, grnCode, ids, format, paper);
      return `${names.join(', ')} downloaded`;
    });
  }

  function confirmVoid() {
    if (voiding === null) return;
    const target = voiding;
    return run(async () => {
      const { lpn } = await fetchApiVoidLpn(tenantId, grnId, target.lpnId, voidBody(target.reason, target.note), target.key);
      setVoiding(null);
      setSelected((s) => {
        const next = new Set(s);
        next.delete(lpn.id);
        return next;
      });
      notifyInboundChanged();
      return `${lpn.code} voided — its ${lpn.qty} can go on a new label`;
    });
  }

  const noteMissing = voiding !== null && voiding.reason === 'other' && voiding.note.trim() === '';

  return (
    <div role="dialog" aria-label={`Labels for ${line.skuCode}`} className="my-1 flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-2" data-testid="lpn-labels-panel">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">
          Pallet / carton labels (LPNs) for <span className="font-mono">{line.skuCode}</span>
        </span>
        <button type="button" className={buttonClass} disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>

      {lpns.length > 0 && (
        <table className="text-xs">
          <thead>
            <tr className="text-left text-(--muted-foreground)">
              <th className="w-6" />
              <th>LPN</th>
              <th className="text-right">Qty</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lpns.map((lpn) => (
              <tr key={lpn.id} data-testid="lpn-row">
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Reprint ${lpn.code}`}
                    disabled={lpn.status === 'voided' || busy}
                    checked={selected.has(lpn.id)}
                    onChange={(e) =>
                      setSelected((s) => {
                        const next = new Set(s);
                        if (e.target.checked) next.add(lpn.id);
                        else next.delete(lpn.id);
                        return next;
                      })
                    }
                  />
                </td>
                <td className="font-mono">{lpn.code}</td>
                <td className="data text-right">{lpn.qty}</td>
                <td>{lpnStatusLabel(lpn.status)}</td>
                <td>
                  {lpn.status === 'active' && voiding?.lpnId !== lpn.id && (
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy || voiding !== null}
                      onClick={() => setVoiding({ lpnId: lpn.id, code: lpn.code, reason: 'misprint', note: '', key: ulid() })}
                    >
                      Void
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {voiding !== null && (
        <div className="flex flex-wrap items-end gap-2" data-testid="lpn-void">
          <span className="text-xs">
            Void <span className="font-mono">{voiding.code}</span>?
          </span>
          <label className="flex flex-col gap-0.5">
            <span className="text-xs font-medium">Reason</span>
            <select
              className={selectClass}
              value={voiding.reason}
              disabled={busy}
              onChange={(e) => setVoiding({ ...voiding, reason: e.target.value as VoidLpnRequestDto['reasonCode'], key: ulid() })}
            >
              {LPN_VOID_REASONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-xs font-medium">Note{voiding.reason === 'other' ? '' : ' (optional)'}</span>
            <input
              className={selectClass}
              maxLength={200}
              value={voiding.note}
              disabled={busy}
              onChange={(e) => setVoiding({ ...voiding, note: e.target.value, key: ulid() })}
            />
          </label>
          <button type="button" className={primaryClass} disabled={busy || noteMissing} onClick={() => confirmVoid()}>
            Void label
          </button>
          <button type="button" className={buttonClass} disabled={busy} onClick={() => setVoiding(null)}>
            Keep
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <PaperPicker format={format} paper={paper} onFormat={setFormat} onPaper={setPaper} />
        <button type="button" className={buttonClass} disabled={busy || selected.size === 0} onClick={() => reprint()}>
          Download selected ({selected.size})
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-xs font-medium">Units per pallet/carton</span>
          <input
            className={selectClass}
            inputMode="decimal"
            value={perLabel}
            disabled={busy}
            onChange={(e) => {
              setPerLabel(e.target.value);
              mintKey.current = null;
            }}
          />
        </label>
        <button type="button" className={primaryClass} disabled={busy || quantities.length === 0 || tooMany} onClick={() => createAndDownload()}>
          {busy ? 'Working…' : 'Create and download'}
        </button>
      </div>
      <div className="text-xs text-(--muted-foreground)" data-testid="lpn-preview">
        {unlabelled === 0
          ? 'Every applied unit of this line is on a label.'
          : quantities.length === 0
            ? `Enter the units on each pallet or carton (${unlabelled} unlabelled).`
            : `${splitPreview(quantities)} — ${unlabelled} unlabelled.`}
        {tooMany && ` One creation takes at most ${MAX_LABELS_PER_MINT} labels — use a larger pallet or carton.`}
      </div>
      {done !== null && <span className="text-xs">{done}</span>}
      {refusal !== null && <RefusalView refusal={refusal} />}
    </div>
  );
}

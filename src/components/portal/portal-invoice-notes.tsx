'use client';

import { useState } from 'react';

import type { PortalNoteDetailResponse, PortalNoteRowDto } from '@/lib/api/generated';
import { NOTE_KIND_LABEL, NOTE_REASON_LABEL, noteHeading, notePlaceOfSupplyLabel, signedNoteAmount } from '@/lib/client-invoice-notes';
import { lineDescription, stateLabel } from '@/lib/client-invoices';
import { formatRupees, gstRateLabel } from '@/lib/invoices';
import { portalDate, portalRecipientAddress, portalSupplierAddress } from '@/lib/portal';
import { usePortalInvoiceNote, usePortalInvoiceNotes } from '@/lib/use-portal';

import { ReadFailure, rowButtonClass } from '@/components/shared/surface';

/**
 * Story 5-6a — the portal's credit and debit notes, under an open invoice:
 * the issued and void notes (never a draft), the "Document value after
 * notes", and one note's document (the client's copy, Rule 53(1A)) — built
 * from the portal DTOs only (the operator's printable is an operator
 * component). The note view holds the only `data-print-root` on the page.
 */
export function PortalInvoiceNotes({ invoiceId }: { invoiceId: string }) {
  const notes = usePortalInvoiceNotes(invoiceId);
  const [openId, setOpenId] = useState<string | null>(null);
  if (notes.state === 'loading') return <div className="text-(--muted-foreground)">Loading credit and debit notes…</div>;
  if (notes.state === 'failed') return <ReadFailure word="Notes not loaded" reason={notes.reason} onRetry={notes.reload} />;
  if (openId !== null) return <PortalNoteView noteId={openId} onBack={() => setOpenId(null)} />;
  const rows = notes.data.notes;
  return (
    <section aria-label="Credit and debit notes" className="flex flex-col gap-2 border-t border-(--border) pt-3">
      <h4 className="font-medium">Credit and debit notes</h4>
      {rows.length === 0 ? (
        <div className="text-(--muted-foreground)">No credit or debit notes on this invoice.</div>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-(--muted-foreground)">
                <th className="py-1">Note</th>
                <th className="py-1">Type</th>
                <th className="py-1">Date</th>
                <th className="py-1">Status</th>
                <th className="py-1 text-right">Amount</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row: PortalNoteRowDto) => (
                <tr key={row.id} className="border-t border-(--border)">
                  <td className="py-1 font-mono">{row.noteNo}</td>
                  <td className="py-1">{NOTE_KIND_LABEL[row.kind]}</td>
                  <td className="py-1">{portalDate(row.issuedAt)}</td>
                  <td className="py-1">{row.status === 'void' ? 'Void' : 'Issued'}</td>
                  <td className="data py-1 text-right">{row.status === 'void' ? <s>{signedNoteAmount(row)}</s> : signedNoteAmount(row)}</td>
                  <td className="py-1 text-right">
                    <button type="button" className={rowButtonClass} onClick={() => setOpenId(row.id)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="data ml-auto grid grid-cols-2 gap-x-4 text-right">
            <dt className="font-medium">Document value after notes</dt>
            <dd className="font-medium">{formatRupees(notes.data.netDocumentPayable)}</dd>
          </dl>
        </>
      )}
    </section>
  );
}

function PortalNoteView({ noteId, onBack }: { noteId: string; onBack: () => void }) {
  const note = usePortalInvoiceNote(noteId);
  const back = (
    <button type="button" className={rowButtonClass} onClick={onBack}>
      ← Back to the notes
    </button>
  );
  if (note.state === 'loading') return <div className="text-(--muted-foreground)">Loading the note…</div>;
  if (note.state === 'failed') {
    return (
      <div className="flex flex-col gap-2">
        {back}
        <ReadFailure word="Note not loaded" reason={note.reason} onRetry={note.reload} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="print:hidden">{back}</div>
      <PortalNoteDocument note={note.data} />
    </div>
  );
}

/** The client's copy of a note: every Rule 53(1A) item, from the portal DTO. */
export function PortalNoteDocument({ note }: { note: PortalNoteDetailResponse }) {
  const heading = noteHeading(note.kind, note.status);
  const { supplier, recipient } = note.party;
  return (
    <article data-print-root aria-label="Note" className="flex flex-col gap-3" data-testid="portal-note">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-base font-semibold">{heading.title}</h4>
          {heading.notice !== null ? <div className="text-xs text-(--muted-foreground)">{heading.notice}</div> : null}
        </div>
        <div className="text-right text-xs">
          <div className="font-mono">Note no. {note.noteNo}</div>
          <div>Date: {portalDate(note.issuedAt)}</div>
          <div>
            Against invoice <span className="font-mono">{note.invoiceNo}</span> dated {portalDate(note.invoiceIssuedAt)}
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs text-(--muted-foreground)">From</div>
          <div className="font-medium">{supplier.name}</div>
          {portalSupplierAddress(note.party).map((line, index) => (
            <div key={index}>{line}</div>
          ))}
          <div>
            GSTIN {supplier.gstin ?? '—'} · {stateLabel(supplier.stateName, supplier.stateCode)}
          </div>
        </div>
        <div>
          <div className="text-xs text-(--muted-foreground)">To</div>
          <div className="font-medium">{recipient.legalName ?? recipient.name}</div>
          {portalRecipientAddress(note.party).map((line, index) => (
            <div key={index}>{line}</div>
          ))}
          <div>
            GSTIN {recipient.gstin ?? 'Unregistered'} · {stateLabel(recipient.stateName, recipient.stateCode)}
          </div>
        </div>
      </div>
      <div className="text-xs">
        <div>Place of supply: {notePlaceOfSupplyLabel(note.placeOfSupply)}</div>
        <div>Reverse charge: No</div>
        <div>
          Reason: {NOTE_REASON_LABEL[note.reason] ?? note.reason} — {note.reasonNote}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-(--muted-foreground)">
            <th className="py-1">Service</th>
            <th className="py-1">SAC</th>
            <th className="py-1 text-right">Taxable</th>
            <th className="py-1 text-right">GST</th>
            <th className="py-1 text-right">CGST</th>
            <th className="py-1 text-right">SGST/UTGST</th>
            <th className="py-1 text-right">IGST</th>
          </tr>
        </thead>
        <tbody>
          {note.lines.map((line, index) => (
            <tr key={index} className="border-t border-(--border)">
              <td className="py-1">{lineDescription(line)}</td>
              <td className="py-1 font-mono">{line.sac}</td>
              <td className="data py-1 text-right">{formatRupees(line.amountPaise)}</td>
              <td className="data py-1 text-right">{gstRateLabel(line.gstBps)}</td>
              <td className="data py-1 text-right">{formatRupees(line.cgstPaise)}</td>
              <td className="data py-1 text-right">{formatRupees(line.sgstPaise)}</td>
              <td className="data py-1 text-right">{formatRupees(line.igstPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="data ml-auto grid grid-cols-2 gap-x-4 text-right">
        <dt>Taxable value</dt>
        <dd>{formatRupees(note.totals.subtotal)}</dd>
        <dt>Tax</dt>
        <dd>{formatRupees(note.totals.tax)}</dd>
        <dt className="font-medium">{note.kind === 'credit' ? 'Credit value' : 'Debit value'}</dt>
        <dd className="font-medium">{formatRupees(note.totals.payable)}</dd>
      </dl>
      <div className="flex flex-col items-end text-xs">
        <span>For {supplier.name}</span>
        <span className="mt-6 border-t border-(--border) pt-1">Authorised signatory</span>
      </div>
    </article>
  );
}

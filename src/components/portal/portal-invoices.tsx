'use client';

import { useState } from 'react';

import type { PortalInvoiceDetailResponse, PortalInvoiceRowDto } from '@/lib/api/generated';
import { lineDescription, lineQuantityLabel, lineRateLabel, lineTaxableLabel, monthLabel, stateLabel } from '@/lib/client-invoices';
import { formatRupees } from '@/lib/invoices';
import {
  invoiceStatusLabel,
  portalDate,
  portalRecipientAddress,
  portalSupplierAddress,
} from '@/lib/portal';
import { usePortalInvoice, usePortalInvoices } from '@/lib/use-portal';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { ReadFailure, Section, rowButtonClass } from '@/components/outbound/shell';

/**
 * Story 21-7 — the portal's Invoices surface: this company's issued
 * invoices (never a draft); a row expands to the invoice — the frozen party
 * and its lines (decision 3: no drill-down, no rate card). The operator's
 * printable layout renders from the OPERATOR DTO, so this is a
 * portal-specific detail built from the portal DTO only.
 */
export function PortalInvoices() {
  const invoices = usePortalInvoices();
  const [openId, setOpenId] = useState<string | null>(null);
  const columns: readonly DataTableColumn<PortalInvoiceRowDto>[] = [
    {
      key: 'toggle',
      header: '',
      render: (row) => (
        <button
          type="button"
          className={rowButtonClass}
          aria-expanded={openId === row.id}
          aria-controls={expandedRowId(row.id)}
          onClick={() => setOpenId(openId === row.id ? null : row.id)}
        >
          {openId === row.id ? 'Hide' : 'Open'}
        </button>
      ),
    },
    { key: 'number', header: 'Invoice', render: (row) => <span className="font-mono">{row.invoiceNo}</span> },
    { key: 'period', header: 'Period', render: (row) => monthLabel(row.periodStart) },
    { key: 'status', header: 'Status', render: (row) => invoiceStatusLabel(row.status) },
    { key: 'issued', header: 'Issued', render: (row) => portalDate(row.issuedAt) },
    { key: 'payable', header: 'Payable', numeric: true, render: (row) => formatRupees(row.totals.payable) },
  ];
  return (
    <Section title="Invoices">
      {invoices.state === 'loading' && <div className="text-(--muted-foreground)">Loading your invoices…</div>}
      {invoices.state === 'failed' && <ReadFailure word="Invoices not loaded" reason={invoices.reason} onRetry={invoices.reload} />}
      {invoices.state === 'ready' && (
        <DataTable<PortalInvoiceRowDto>
          columns={columns}
          rows={invoices.data.items}
          nextCursor={invoices.data.nextCursor}
          onCursor={invoices.onCursor}
          emptyMessage="No invoices issued to your company yet."
          renderExpanded={(row) => (row.id === openId ? <InvoiceDetail invoiceId={row.id} /> : null)}
        />
      )}
    </Section>
  );
}

function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const invoice = usePortalInvoice(invoiceId);
  if (invoice.state === 'loading') return <div className="text-(--muted-foreground)">Loading the invoice…</div>;
  if (invoice.state === 'failed') return <ReadFailure word="Invoice not loaded" reason={invoice.reason} onRetry={invoice.reload} />;
  return <InvoiceDocument invoice={invoice.data} />;
}

function InvoiceDocument({ invoice }: { invoice: PortalInvoiceDetailResponse }) {
  const { supplier, recipient } = invoice.party;
  return (
    <article className="flex flex-col gap-3" data-testid="portal-invoice">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs text-(--muted-foreground)">From</div>
          <div className="font-medium">{supplier.name}</div>
          {portalSupplierAddress(invoice.party).map((line, index) => (
            <div key={index}>{line}</div>
          ))}
          <div>GSTIN {supplier.gstin ?? '—'} · {stateLabel(supplier.stateName, supplier.stateCode)}</div>
        </div>
        <div>
          <div className="text-xs text-(--muted-foreground)">Billed to</div>
          <div className="font-medium">{recipient.legalName ?? recipient.name}</div>
          {portalRecipientAddress(invoice.party).map((line, index) => (
            <div key={index}>{line}</div>
          ))}
          <div>GSTIN {recipient.gstin ?? '—'} · {stateLabel(recipient.stateName, recipient.stateCode)}</div>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-(--muted-foreground)">
            <th className="py-1">Service</th>
            <th className="py-1">SAC</th>
            <th className="py-1 text-right">Quantity</th>
            <th className="py-1 text-right">Rate</th>
            <th className="py-1 text-right">Taxable</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line, index) => (
            <tr key={index} className="border-t border-(--border)">
              <td className="py-1">{lineDescription(line)}</td>
              <td className="py-1 font-mono">{line.sac}</td>
              <td className="data py-1 text-right">{lineQuantityLabel(line)}</td>
              <td className="data py-1 text-right">{lineRateLabel(line)}</td>
              <td className="data py-1 text-right">{lineTaxableLabel(line)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="data ml-auto grid grid-cols-2 gap-x-4 text-right">
        <dt>Subtotal</dt>
        <dd>{formatRupees(invoice.totals.subtotal)}</dd>
        <dt>Tax</dt>
        <dd>{formatRupees(invoice.totals.tax)}</dd>
        <dt className="font-medium">Payable</dt>
        <dd className="font-medium">{formatRupees(invoice.totals.payable)}</dd>
      </dl>
    </article>
  );
}

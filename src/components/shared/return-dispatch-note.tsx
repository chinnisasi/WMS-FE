import { Fragment } from 'react';

import type { DispatchNoteModel, NoteParty } from '@/lib/consignment-capture';

/**
 * Story 2-8b (4-7c reuses it) — the printable dispatch note of a goods-out
 * document, from a kind-neutral model (`vendorReturnNoteModel` builds the
 * RTV's): the title, the code and date, three parties (consignor, dispatched
 * from, consignee), the lines, the capture (the consignor's document, the
 * e-way bill, the carrier, the AWB, the packages), the footer sentence and
 * the signature blocks.
 *
 * Inside `<article data-print-root>`, so the print stylesheet (`globals.css`)
 * prints this note alone, light whatever the theme. The first copy shows on
 * screen; the others print only, each after a page break (the 21-5
 * client-invoice precedent). Before dispatch the model carries one "Pick
 * list" copy and the draft watermark. Hook-free (portal-allowed).
 */
export function ReturnDispatchNote({ model, ariaLabel }: { readonly model: DispatchNoteModel; readonly ariaLabel: string }) {
  return (
    <article
      data-print-root
      aria-label={ariaLabel}
      data-dispatched={model.dispatched ? 'true' : 'false'}
      className="flex flex-col gap-3 rounded-md border border-(--border) bg-(--background) p-4 text-(--foreground)"
    >
      {model.copies.map((copy, index) => (
        <section
          key={copy}
          aria-label={copy}
          data-copy={copy}
          className={
            index === 0 ? 'relative flex flex-col gap-4' : 'relative hidden flex-col gap-4 print:flex print:break-before-page'
          }
        >
          <NoteCopy model={model} copy={copy} />
        </section>
      ))}
    </article>
  );
}

function PartyBlock({ party, label }: { readonly party: NoteParty; readonly label: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-(--border) p-2 text-xs" aria-label={label}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-(--muted-foreground)">{party.heading}</span>
      <span className="text-sm font-medium">{party.name}</span>
      {party.lines.map((line, i) => (
        <span key={`${i}-${line}`}>{line}</span>
      ))}
      {party.facts.map((fact) => (
        <span key={fact.label}>
          {fact.label}: <span className="font-mono">{fact.value}</span>
        </span>
      ))}
    </div>
  );
}

function NoteCopy({ model, copy }: { readonly model: DispatchNoteModel; readonly copy: string }) {
  return (
    <>
      {model.watermark !== null && (
        <div
          aria-hidden
          data-testid="note-watermark-art"
          className="pointer-events-none absolute inset-0 flex select-none items-center justify-center overflow-hidden"
        >
          <span className="-rotate-[24deg] whitespace-nowrap text-4xl font-bold tracking-widest text-(--muted-foreground) opacity-20">
            {model.watermark}
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <h3 className="text-base font-semibold">{model.title}</h3>
          {model.watermark !== null && (
            <span data-testid="note-watermark" className="text-xs font-semibold tracking-wide text-(--destructive)">
              {model.watermark}
            </span>
          )}
        </div>
        <div className="flex flex-col text-right text-xs">
          <span className="font-semibold tracking-wide">{copy}</span>
          <span className="font-mono text-sm">{model.code}</span>
          <span>Date: {model.dateLabel}</span>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3 print:grid-cols-3">
        <PartyBlock party={model.consignor} label="Consignor" />
        <PartyBlock party={model.dispatchedFrom} label="Dispatched from" />
        <PartyBlock party={model.consignee} label="Consignee" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-(--border) text-left">
              <th className="py-1 pr-2 font-medium">#</th>
              <th className="py-1 pr-2 font-medium">SKU</th>
              <th className="py-1 pr-2 font-medium">Description</th>
              <th className="py-1 pr-2 font-medium">HSN</th>
              <th className="py-1 pr-2 font-medium">Batch</th>
              <th className="py-1 pr-2 font-medium">Reason</th>
              <th className="data py-1 pr-2 text-right font-medium">{model.dispatched ? 'Quantity' : 'To pick'}</th>
              <th className="py-1 pr-2 font-medium">UoM</th>
              {!model.dispatched && <th className="py-1 font-medium">Picked ✓</th>}
            </tr>
          </thead>
          <tbody>
            {model.lines.map((line, index) => (
              <Fragment key={line.key}>
                {line.group !== undefined && line.group !== model.lines[index - 1]?.group && (
                  <tr className="border-b border-(--border)" data-testid="note-group">
                    <td colSpan={model.dispatched ? 8 : 9} className="pt-2 pb-1 font-semibold">
                      {line.group}
                    </td>
                  </tr>
                )}
                <tr className="border-b border-(--border)" data-testid="note-line">
                  <td className="data py-1 pr-2">{line.lineNo}</td>
                  <td className="py-1 pr-2 font-mono">{line.skuCode}</td>
                  <td className="py-1 pr-2">
                    {line.skuName}
                    {line.detail !== undefined && (
                      <span className="block text-[11px] text-(--muted-foreground)" data-testid="note-line-detail">
                        {line.detail}
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-2 font-mono">{line.hsn}</td>
                  <td className="py-1 pr-2 font-mono">{line.batch}</td>
                  <td className="py-1 pr-2">{line.reason}</td>
                  <td className="data py-1 pr-2 text-right">{line.quantity}</td>
                  <td className="py-1 pr-2">{line.uom}</td>
                  {!model.dispatched && <td className="py-1">&nbsp;</td>}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {model.capture.length > 0 && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-xs" aria-label="Consignment">
          {model.capture.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-(--muted-foreground)">{row.label}</dt>
              <dd className="font-mono">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {model.note !== null && <div className="text-xs">Note: {model.note}</div>}

      <div className="text-xs font-medium" data-testid="note-footer">
        {model.footer}
      </div>

      <div className="mt-6 grid gap-6 text-xs sm:grid-cols-2 print:grid-cols-2">
        {model.signatures.map((signature) => (
          <div key={signature} className="flex flex-col gap-1">
            <span className="mt-8 border-t border-(--border) pt-1">{signature}</span>
            <span className="text-(--muted-foreground)">Name, signature and date</span>
          </div>
        ))}
      </div>
    </>
  );
}

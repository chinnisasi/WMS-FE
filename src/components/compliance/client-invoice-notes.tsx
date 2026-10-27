'use client';

import { useMemo, useRef, useState } from 'react';

import {
  fetchApiClientInvoiceNoteRegister,
  fetchApiCreateClientInvoiceNote,
  fetchApiDiscardClientInvoiceNote,
  fetchApiIssueClientInvoiceNote,
  fetchApiVoidClientInvoiceNote,
} from '@/lib/api/client';
import type { ClientInvoiceDto, NoteDto, NoteEntryDto, NoteRegisterRowDto } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import {
  NOTE_KIND_LABEL,
  NOTE_REASONS_BY_KIND,
  NOTE_REASON_LABEL,
  NOTE_STATUS_LABEL,
  NOTE_TEXT_MAX,
  REASON_NOTE_HINT,
  creditDeadlineLabel,
  needsOverride,
  noteActions,
  noteHeading,
  noteKindsFor,
  notePlaceOfSupplyLabel,
  noteNeedsReread,
  noteRefusalReason,
  noteRegisterCsv,
  noteRegisterFilename,
  parseNoteForm,
  signedNoteAmount,
  type NoteForm as NoteFormState,
  type NoteFormProblem,
  type NoteKind,
  type NoteReason,
} from '@/lib/client-invoice-notes';
import {
  lineDescription,
  notifyClientInvoicesChanged,
  recipientAddressLines,
  stateLabel,
  supplierAddressLines,
  type ClientInvoiceOutcome,
} from '@/lib/client-invoices';
import { downloadText } from '@/lib/csv';
import { amountInWords, formatRoundOff, formatRupees, gstRateLabel, invoiceDateLabel, taxRateLabels } from '@/lib/invoices';
import { istDateOf } from '@/lib/rate-cards';
import { ulid } from '@/lib/ulid';
import { useClientInvoiceNote, useInvoiceNotes, useNoteRegister, type NoteRegisterQuery } from '@/lib/use-client-invoice-notes';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure, Section, buttonClass, inputClass, labelClass, primaryClass, rowButtonClass, selectClass } from '@/components/outbound/shell';

/**
 * Story 5-6a — credit and debit notes (CGST Act s.34) on the /compliance
 * Client invoices surface.
 *
 * - `InvoiceNotesPanel` sits UNDER an open invoice (beside the line records),
 *   `print:hidden` and never inside `data-print-root`: the notes, the
 *   "Document value after notes", and — for `billing.invoice` — the draft form.
 * - Opening a note switches the invoice detail to `NoteView` (A22): the
 *   invoice's printable unmounts, so the note's `PrintableClientInvoiceNote`
 *   holds the only `data-print-root` on the page.
 * - `NotesRegister` is the Compliance "Credit/debit notes" tab: one GSTIN's
 *   notes over a month, with the CSV export (A15 — the web writes it).
 *
 * Pessimistic throughout: every figure is the server's (the tax, the exhaust
 * rule, the payable, the deadlines), re-read after each mutation.
 */

// ── the panel under an invoice ───────────────────────────────────────────────

/** A request to open the draft form: the kind, and (from "Credit this line") a preset line with settle ticked. */
export interface NoteDraftRequest {
  readonly kind: NoteKind;
  readonly presetLineId: string | null;
  readonly settles: boolean;
}

export function InvoiceNotesPanel({
  invoice,
  canInvoice,
  draft,
  onDraft,
  onOpenNote,
  onOutcome,
}: {
  invoice: ClientInvoiceDto;
  canInvoice: boolean;
  draft: NoteDraftRequest | null;
  onDraft: (draft: NoteDraftRequest | null) => void;
  onOpenNote: (noteId: string) => void;
  onOutcome: (outcome: ClientInvoiceOutcome) => void;
}) {
  const notes = useInvoiceNotes(invoice.id);
  const kinds = noteKindsFor(invoice.status);
  const headingId = `invoice-notes-${invoice.id}`;
  const columns: DataTableColumn<NoteEntryDto>[] = [
    {
      key: 'number',
      header: 'Note',
      render: (row) => (row.noteNo === null ? <span className="text-(--muted-foreground)">Draft</span> : <span className="font-mono text-xs">{row.noteNo}</span>),
    },
    { key: 'kind', header: 'Kind', render: (row) => NOTE_KIND_LABEL[row.kind] },
    { key: 'reason', header: 'Reason', render: (row) => NOTE_REASON_LABEL[row.reason] ?? row.reason },
    { key: 'status', header: 'Status', render: (row) => <NoteStatusWord status={row.status} settles={row.settlesDispute} /> },
    { key: 'date', header: 'Date', render: (row) => (row.issuedAt === null ? '—' : invoiceDateLabel(row.issuedAt)) },
    { key: 'amount', header: 'Amount', numeric: true, render: (row) => signedNoteAmount(row) },
    {
      key: 'open',
      header: '',
      render: (row) => (
        <button type="button" className={rowButtonClass} onClick={() => onOpenNote(row.id)}>
          Open
        </button>
      ),
    },
  ];
  return (
    <section aria-labelledby={headingId} data-invoice-notes className="flex flex-col gap-2 rounded-md border border-(--border) p-3 text-sm print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="font-medium">
          Credit and debit notes
        </h4>
        {canInvoice && draft === null ? (
          <div className="flex gap-2">
            {kinds.map((kind) => (
              <button key={kind} type="button" className={buttonClass} onClick={() => onDraft({ kind, presetLineId: null, settles: false })}>
                New {NOTE_KIND_LABEL[kind].toLowerCase()}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="text-xs text-(--muted-foreground)">
        A note corrects an issued invoice without voiding it — a credit reduces what the client owes, a debit adds to it. Each issues with its own number.
      </div>
      {canInvoice && draft !== null ? (
        <NoteForm
          key={`${draft.kind}-${draft.presetLineId ?? ''}-${draft.settles}`}
          invoice={invoice}
          request={draft}
          onClose={() => onDraft(null)}
          onCreated={(note) => {
            onDraft(null);
            onOutcome({ tone: 'accepted', word: `${NOTE_KIND_LABEL[note.kind]} drafted`, reason: `${signedNoteAmount(note)}. Open it to review and issue.` });
            notifyClientInvoicesChanged();
            onOpenNote(note.id);
          }}
        />
      ) : null}
      {notes.state === 'failed' ? (
        <ReadFailure word="Notes unavailable" reason={notes.reason} onRetry={notes.reload} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={notes.state === 'ready' ? notes.data.notes : []}
            nextCursor={null}
            onCursor={() => undefined}
            emptyMessage={notes.state === 'loading' ? 'Loading notes…' : 'No credit or debit notes on this invoice.'}
          />
          {notes.state === 'ready' && notes.data.notes.some((note) => note.status === 'issued') ? (
            <dl className="ml-auto grid grid-cols-2 gap-x-4 text-xs" aria-label="Document value after notes">
              <dt>Invoice payable</dt>
              <dd className="data text-right">{formatRupees(invoice.totals.payable)}</dd>
              <dt className="font-medium">Document value after notes</dt>
              <dd className="data text-right font-medium">{formatRupees(notes.data.netDocumentPayable)}</dd>
            </dl>
          ) : null}
        </>
      )}
    </section>
  );
}

function NoteStatusWord({ status, settles }: { status: NoteEntryDto['status']; settles: boolean }) {
  return (
    <span className="text-xs">
      {NOTE_STATUS_LABEL[status]}
      {settles ? <span className="text-(--muted-foreground)"> · settles the dispute</span> : null}
    </span>
  );
}

// ── the draft form ───────────────────────────────────────────────────────────

/**
 * Draft a note — per-draft Idempotency-Key: minted on the first submit,
 * reused by a retry of the unchanged draft, cleared on any edit.
 */
function NoteForm({
  invoice,
  request,
  onClose,
  onCreated,
}: {
  invoice: ClientInvoiceDto;
  request: NoteDraftRequest;
  onClose: () => void;
  onCreated: (note: NoteDto) => void;
}) {
  const kind = request.kind;
  const [form, setForm] = useState<NoteFormState>(() => ({
    kind,
    reason: NOTE_REASONS_BY_KIND[kind].length === 1 ? NOTE_REASONS_BY_KIND[kind][0]! : '',
    reasonNote: '',
    settlesDispute: request.settles && kind === 'credit' && invoice.status === 'disputed',
    lines: invoice.lines
      .filter((line) => request.presetLineId === null || line.id === request.presetLineId)
      .map((line) => ({ invoiceLineId: line.id, invoiceLinePaise: line.amountPaise ?? 0, amountText: '', overrideReason: '' })),
  }));
  const [problems, setProblems] = useState<NoteFormProblem[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const describe = (invoiceLineId: string): string => {
    const line = invoice.lines.find((candidate) => candidate.id === invoiceLineId);
    return line === undefined ? 'a line' : lineDescription(line);
  };
  const problemOf = (field: string): string | null => problems.find((p) => p.field === field)?.problem ?? null;

  function edit(change: Partial<NoteFormState>) {
    keyRef.current = null;
    setForm((current) => ({ ...current, ...change }));
  }
  function editLine(invoiceLineId: string, change: { amountText?: string; overrideReason?: string }) {
    keyRef.current = null;
    setForm((current) => ({ ...current, lines: current.lines.map((line) => (line.invoiceLineId === invoiceLineId ? { ...line, ...change } : line)) }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseNoteForm(form);
    if (parsed.body === null) {
      setProblems(parsed.problems);
      return;
    }
    const session = readSession();
    if (session === null) return;
    setProblems([]);
    setRefusal(null);
    inFlight.current = true;
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      onCreated(await fetchApiCreateClientInvoiceNote(session.tenant.id, invoice.id, parsed.body, keyRef.current));
    } catch (error) {
      setRefusal(noteRefusalReason(error, describe));
      if (noteNeedsReread(error)) notifyClientInvoicesChanged();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const title = `New ${NOTE_KIND_LABEL[kind].toLowerCase()} against ${invoice.invoiceNo ?? 'this invoice'}`;
  return (
    <form onSubmit={submit} aria-label={title} className="flex max-w-3xl flex-col gap-3 rounded-md border border-(--border) p-3">
      <div className="font-medium">{title}</div>
      <div className="text-xs text-(--muted-foreground)">
        {kind === 'credit'
          ? 'Enter the taxable amount to credit on each line. The tax is the line’s own (SAC, rate, place of supply); the server works out the figures.'
          : 'Enter the taxable amount to add on each line. The tax is the line’s own; a debit above the invoiced amount needs a reason.'}
      </div>
      <fieldset disabled={busy} className="flex flex-col gap-3">
        <legend className="sr-only">Note lines</legend>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-(--border) text-left">
                <th className="py-1 pr-2 font-medium">Invoice line</th>
                <th className="data py-1 pr-2 text-right font-medium">Invoiced (taxable)</th>
                <th className="py-1 font-medium">{kind === 'credit' ? 'Credit (₹, taxable)' : 'Debit (₹, taxable)'}</th>
              </tr>
            </thead>
            <tbody>
              {form.lines.map((line) => {
                const amountError = problemOf(`amount:${line.invoiceLineId}`);
                const overrideError = problemOf(`override:${line.invoiceLineId}`);
                const amountId = `note-amount-${line.invoiceLineId}`;
                return (
                  <tr key={line.invoiceLineId} className="border-b border-(--border) align-top">
                    <td className="py-1 pr-2">{describe(line.invoiceLineId)}</td>
                    <td className="data py-1 pr-2 text-right">{formatRupees(line.invoiceLinePaise)}</td>
                    <td className="flex flex-col gap-1 py-1">
                      <input
                        id={amountId}
                        className={inputClass}
                        inputMode="decimal"
                        placeholder="0.00"
                        aria-label={`Amount for ${describe(line.invoiceLineId)}`}
                        aria-invalid={amountError !== null}
                        aria-describedby={amountError !== null ? `${amountId}-error` : undefined}
                        value={line.amountText}
                        onChange={(event) => editLine(line.invoiceLineId, { amountText: event.target.value })}
                      />
                      {amountError !== null ? (
                        <span id={`${amountId}-error`} className="text-(--destructive)">
                          {amountError}
                        </span>
                      ) : null}
                      {needsOverride(kind, line) ? (
                        <label className="flex flex-col gap-1">
                          <span>Why is the debit above the invoiced amount? (required)</span>
                          <input
                            className={inputClass}
                            maxLength={NOTE_TEXT_MAX * 2}
                            aria-label={`Override reason for ${describe(line.invoiceLineId)}`}
                            aria-invalid={overrideError !== null}
                            value={line.overrideReason}
                            onChange={(event) => editLine(line.invoiceLineId, { overrideReason: event.target.value })}
                          />
                          {overrideError !== null ? <span className="text-(--destructive)">{overrideError}</span> : null}
                        </label>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {problemOf('lines') !== null ? <div className="text-xs text-(--destructive)">{problemOf('lines')}</div> : null}
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Reason</span>
          <select
            className={selectClass}
            aria-label="Reason"
            aria-invalid={problemOf('reason') !== null}
            value={form.reason}
            onChange={(event) => edit({ reason: event.target.value as NoteReason | '' })}
          >
            {NOTE_REASONS_BY_KIND[kind].length > 1 ? <option value="">Pick a reason…</option> : null}
            {NOTE_REASONS_BY_KIND[kind].map((reason) => (
              <option key={reason} value={reason}>
                {NOTE_REASON_LABEL[reason]}
              </option>
            ))}
          </select>
          {problemOf('reason') !== null ? <span className="text-xs text-(--destructive)">{problemOf('reason')}</span> : null}
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Reason note</span>
          <span className="text-xs text-(--muted-foreground)" id={`reason-note-hint-${invoice.id}`}>
            {REASON_NOTE_HINT}
          </span>
          <textarea
            className={inputClass}
            rows={2}
            aria-label="Reason note"
            aria-describedby={`reason-note-hint-${invoice.id}`}
            aria-invalid={problemOf('reasonNote') !== null}
            value={form.reasonNote}
            onChange={(event) => edit({ reasonNote: event.target.value })}
          />
          {problemOf('reasonNote') !== null ? <span className="text-xs text-(--destructive)">{problemOf('reasonNote')}</span> : null}
        </label>
        {kind === 'credit' && invoice.status === 'disputed' ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.settlesDispute} onChange={(event) => edit({ settlesDispute: event.target.checked })} aria-label="Settles the dispute" />
            <span>Settles the dispute — issuing this credit note marks the invoice settled</span>
          </label>
        ) : null}
      </fieldset>
      {refusal !== null ? <FeedbackBanner tone="rejected" word="Not drafted" reason={refusal} /> : null}
      <div className="flex gap-2">
        <button type="submit" className={primaryClass} disabled={busy}>
          {busy ? 'Drafting…' : `Draft ${NOTE_KIND_LABEL[kind].toLowerCase()}`}
        </button>
        <button type="button" className={rowButtonClass} onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── the note view (replaces the invoice view while open — A22) ───────────────

type NoteConfirm = { kind: 'discard' } | { kind: 'void' } | null;

export function NoteView({
  noteId,
  canInvoice,
  onBack,
  onOutcome,
}: {
  noteId: string;
  canInvoice: boolean;
  onBack: () => void;
  onOutcome: (outcome: ClientInvoiceOutcome) => void;
}) {
  const detail = useClientInvoiceNote(noteId);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<NoteConfirm>(null);
  const inFlight = useRef(false);

  const back = (
    <button type="button" className={rowButtonClass} onClick={onBack}>
      ← Back to the invoice
    </button>
  );
  if (detail.state === 'failed') {
    return (
      <div className="flex flex-col gap-2">
        {back}
        <ReadFailure word="Note unavailable" reason={detail.reason} onRetry={detail.reload} />
      </div>
    );
  }
  if (detail.state === 'loading') return <div className="text-(--muted-foreground)">Loading the note…</div>;
  const note = detail.data;
  const actions = noteActions(note);
  const describe = (invoiceLineId: string): string => {
    const line = note.lines.find((candidate) => candidate.invoiceLineId === invoiceLineId);
    return line === undefined ? 'a line' : lineDescription(line);
  };

  // A NEW key per Issue click: a refused issue stores nothing, and a retry after a re-read is a new decision.
  async function issue() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const issued = await fetchApiIssueClientInvoiceNote(session.tenant.id, note.id, ulid());
      onOutcome({
        tone: 'accepted',
        word: `Issued ${issued.note.noteNo ?? ''}`.trim(),
        reason:
          issued.invoice !== undefined
            ? `${signedNoteAmount(issued.note)} — and invoice ${issued.invoice.invoiceNo ?? ''} is now settled.`
            : `${signedNoteAmount(issued.note)}. The note is frozen from now on.`,
      });
      notifyClientInvoicesChanged();
    } catch (error) {
      onOutcome({ tone: 'rejected', word: 'Not issued', reason: noteRefusalReason(error, describe) });
      if (noteNeedsReread(error)) notifyClientInvoicesChanged();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 py-1" data-note-view>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {back}
        <button type="button" className={buttonClass} onClick={() => window.print()}>
          Print
        </button>
        {canInvoice && actions.issue ? (
          <button type="button" className={primaryClass} disabled={busy} onClick={issue}>
            Issue
          </button>
        ) : null}
        {canInvoice && actions.discard ? (
          <button type="button" className={buttonClass} disabled={busy} onClick={() => setConfirm({ kind: 'discard' })}>
            Discard
          </button>
        ) : null}
        {canInvoice && actions.void ? (
          <button type="button" className={buttonClass} disabled={busy} onClick={() => setConfirm({ kind: 'void' })}>
            Void
          </button>
        ) : null}
      </div>
      {note.status === 'draft' && note.kind === 'credit' && note.creditDeadline !== null ? (
        <div className="print:hidden">
          <FeedbackBanner tone="warning" word="Credit note deadline" reason={creditDeadlineLabel(note.creditDeadline)} />
        </div>
      ) : null}
      {note.status === 'draft' && note.kind === 'credit' ? (
        <div className="text-xs text-(--muted-foreground) print:hidden">A credit note is issued by a second person — not the one who drafted it — unless the owner has turned that off in Settings.</div>
      ) : null}
      {note.settlesDispute && note.status === 'draft' ? (
        <div className="text-xs print:hidden">Issuing this credit note settles the invoice’s dispute.</div>
      ) : null}
      {note.status === 'void' && note.voidNote !== null ? <div className="text-xs print:hidden">Void note: {note.voidNote}</div> : null}
      {canInvoice && confirm?.kind === 'discard' ? (
        <DiscardNoteConfirm
          note={note}
          onClose={() => setConfirm(null)}
          onDone={() => {
            setConfirm(null);
            onOutcome({ tone: 'accepted', word: 'Draft note discarded', reason: 'Nothing was issued from it.' });
            notifyClientInvoicesChanged();
            onBack();
          }}
          onRejected={(error) => onOutcome({ tone: 'rejected', word: 'Not discarded', reason: noteRefusalReason(error, describe) })}
        />
      ) : null}
      {canInvoice && confirm?.kind === 'void' ? (
        <VoidNoteForm
          note={note}
          onClose={() => setConfirm(null)}
          onDone={(voided) => {
            setConfirm(null);
            onOutcome({ tone: 'accepted', word: `${voided.noteNo ?? 'Note'} voided`, reason: 'Its number stays retired; the invoice’s value is restored.' });
            notifyClientInvoicesChanged();
          }}
          onRejected={(error) => {
            onOutcome({ tone: 'rejected', word: 'Not voided', reason: noteRefusalReason(error, describe) });
            if (noteNeedsReread(error)) notifyClientInvoicesChanged();
          }}
        />
      ) : null}
      <PrintableClientInvoiceNote note={note} />
    </div>
  );
}

function DiscardNoteConfirm({ note, onClose, onDone, onRejected }: { note: NoteDto; onClose: () => void; onDone: () => void; onRejected: (error: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  async function confirm() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      await fetchApiDiscardClientInvoiceNote(session.tenant.id, note.id, keyRef.current);
      onDone();
    } catch (error) {
      onRejected(error);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div role="group" aria-label="Confirm discard" className="flex flex-wrap items-center gap-2 print:hidden">
      <span>Discard this draft note?</span>
      <button type="button" className={primaryClass} disabled={busy} onClick={confirm}>
        Discard draft
      </button>
      <button type="button" className={rowButtonClass} onClick={onClose}>
        Keep
      </button>
    </div>
  );
}

function VoidNoteForm({ note, onClose, onDone, onRejected }: { note: NoteDto; onClose: () => void; onDone: (note: NoteDto) => void; onRejected: (error: unknown) => void }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const trimmed = text.trim();
    if (trimmed === '') return setProblem('Say why — a note is required to void.');
    if ([...trimmed].length > NOTE_TEXT_MAX) return setProblem(`At most ${NOTE_TEXT_MAX} characters.`);
    const session = readSession();
    if (session === null) return;
    setProblem(null);
    inFlight.current = true;
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      onDone(await fetchApiVoidClientInvoiceNote(session.tenant.id, note.id, trimmed, keyRef.current));
    } catch (error) {
      onRejected(error);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} aria-label="Void note" className="flex max-w-3xl flex-col gap-2 rounded-md border border-(--border) p-3 print:hidden">
      <FeedbackBanner
        tone="warning"
        word="Before you void"
        reason="A void is allowed only until the GSTR-1 due date of the note’s month (the 11th of the next month). After that, correct it with a further note."
      />
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Why (required)</span>
        <input
          className={inputClass}
          value={text}
          maxLength={NOTE_TEXT_MAX * 2}
          aria-label="Void note"
          onChange={(event) => {
            keyRef.current = null;
            setText(event.target.value);
          }}
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" className={primaryClass} disabled={busy}>
          Void note
        </button>
        <button type="button" className={rowButtonClass} onClick={onClose}>
          Close
        </button>
      </div>
      {problem !== null ? (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      ) : null}
    </form>
  );
}

// ── the printed note — Rule 53(1A)(a)–(i) ────────────────────────────────────

/**
 * The printable credit or debit note, from the note's own copied `party` —
 * never the live client or tenant. Rule 53(1A): (a) the supplier's name,
 * address and GSTIN; (b) the nature of the document; (c) its number; (d) its
 * date; (e)/(f) the recipient's name, address and GSTIN (or "Unregistered"),
 * with the state name and code; (g) the original invoice's number and date;
 * (h) per line the taxable value, rate and tax; (i) the signature line. One
 * copy (Rule 48(2)'s duplicate is for invoices only). `data-print-root`
 * scopes the print stylesheet; the note view holds the only one.
 */
export function PrintableClientInvoiceNote({ note }: { note: NoteDto }) {
  const heading = noteHeading(note.kind, note.status);
  const { supplier, recipient } = note.party;
  return (
    <article data-print-root aria-label="Printable note" className="flex flex-col gap-3 rounded-md border border-(--border) bg-(--background) p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <h3 className="text-base font-semibold">{heading.title}</h3>
          {heading.notice !== null ? <span className="text-xs text-(--muted-foreground)">{heading.notice}</span> : null}
          <span className="text-xs">Under section 34 of the CGST Act · services (SAC)</span>
        </div>
        <div className="flex flex-col text-right text-xs">
          <span className="font-mono">Note no. {note.noteNo ?? 'Unnumbered'}</span>
          <span>
            Date:{' '}
            {note.issuedAt === null ? '—' : <time dateTime={note.issuedAt}>{invoiceDateLabel(note.issuedAt)}</time>}
          </span>
          <span>
            Against invoice <span className="font-mono">{note.invoiceNo ?? '—'}</span>
            {note.invoiceIssuedAt === null ? null : (
              <>
                {' '}
                dated <time dateTime={note.invoiceIssuedAt}>{invoiceDateLabel(note.invoiceIssuedAt)}</time>
              </>
            )}
          </span>
        </div>
      </div>

      <div className="grid gap-3 text-xs sm:grid-cols-2">
        <div className="flex flex-col" aria-label="Supplier">
          <span className="font-medium">Supplier</span>
          <span>{supplier.name}</span>
          {supplierAddressLines(note.party).map((line) => (
            <span key={line}>{line}</span>
          ))}
          <span>GSTIN: {supplier.gstin ?? '—'}</span>
          <span>State: {stateLabel(supplier.stateName, supplier.stateCode)}</span>
        </div>
        <div className="flex flex-col" aria-label="Recipient">
          <span className="font-medium">Recipient</span>
          <span>{recipient.legalName ?? recipient.name}</span>
          {recipientAddressLines(note.party).map((line) => (
            <span key={line}>{line}</span>
          ))}
          <span>GSTIN: {recipient.gstin ?? 'Unregistered'}</span>
          <span>State: {stateLabel(recipient.stateName, recipient.stateCode)}</span>
        </div>
      </div>
      <div className="flex flex-col text-xs">
        <span>Place of supply: {notePlaceOfSupplyLabel(note.placeOfSupply)}</span>
        <span>Reverse charge: No</span>
        <span>
          Reason: {NOTE_REASON_LABEL[note.reason] ?? note.reason} — {note.reasonNote}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-(--border) text-left">
              <th className="py-1 pr-2 font-medium">Description</th>
              <th className="py-1 pr-2 font-medium">SAC</th>
              <th className="data py-1 pr-2 text-right font-medium">Taxable value</th>
              <th className="data py-1 pr-2 text-right font-medium">GST</th>
              <th className="data py-1 pr-2 text-right font-medium">CGST</th>
              <th className="data py-1 pr-2 text-right font-medium">SGST/UTGST</th>
              <th className="data py-1 text-right font-medium">IGST</th>
            </tr>
          </thead>
          <tbody>
            {note.lines.map((line) => {
              const rates = taxRateLabels(line.gstBps, line.supplyType);
              return (
                <tr key={line.id} className="border-b border-(--border)">
                  <td className="py-1 pr-2">{lineDescription(line)}</td>
                  <td className="py-1 pr-2 font-mono">{line.sac}</td>
                  <td className="data py-1 pr-2 text-right">{formatRupees(line.amountPaise)}</td>
                  <td className="data py-1 pr-2 text-right">{gstRateLabel(line.gstBps)}</td>
                  <td className="data py-1 pr-2 text-right">
                    {formatRupees(line.cgstPaise)} <span className="text-(--muted-foreground)">@ {rates.cgst}</span>
                  </td>
                  <td className="data py-1 pr-2 text-right">
                    {formatRupees(line.sgstPaise)} <span className="text-(--muted-foreground)">@ {rates.sgst}</span>
                  </td>
                  <td className="data py-1 text-right">
                    {formatRupees(line.igstPaise)} <span className="text-(--muted-foreground)">@ {rates.igst}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto grid grid-cols-2 gap-x-4 text-xs" aria-label="Note totals">
        <dt>Taxable value</dt>
        <dd className="data text-right">{formatRupees(note.totals.subtotal)}</dd>
        <dt>CGST</dt>
        <dd className="data text-right">{formatRupees(note.totals.cgst)}</dd>
        <dt>SGST/UTGST</dt>
        <dd className="data text-right">{formatRupees(note.totals.sgst)}</dd>
        <dt>IGST</dt>
        <dd className="data text-right">{formatRupees(note.totals.igst)}</dd>
        <dt>Total</dt>
        <dd className="data text-right">{formatRupees(note.totals.subtotal + note.totals.tax)}</dd>
        {note.totals.roundOff !== 0 ? (
          <>
            <dt>Round off (to the invoice’s payable)</dt>
            <dd className="data text-right">{formatRoundOff(note.totals.roundOff)}</dd>
          </>
        ) : null}
        <dt className="font-medium">{note.kind === 'credit' ? 'Credit value' : 'Debit value'}</dt>
        <dd className="data text-right font-medium">{formatRupees(note.totals.payable)}</dd>
      </dl>
      <div className="text-xs">Amount in words: {amountInWords(note.totals.payable)}</div>

      <div className="mt-4 flex flex-col items-end text-xs">
        <span>For {supplier.name}</span>
        <span className="mt-8 border-t border-(--border) pt-1">Authorised signatory</span>
      </div>
    </article>
  );
}

// ── the notes register (the Compliance tab) ──────────────────────────────────

/** The month picker's default: this IST month. */
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

const REGISTER_EXPORT_CAP = 20_000;

type RegisterRow = NoteRegisterRowDto & { readonly id: string };

export function NotesRegister() {
  const session = readSession();
  const [gstin, setGstin] = useState(session?.tenant.gstin ?? '');
  const [month, setMonth] = useState(() => istDateOf(Date.now()).slice(0, 7));
  const [kind, setKind] = useState<'credit' | 'debit' | ''>('');
  const [status, setStatus] = useState<'issued' | 'void' | ''>('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [outcome, setOutcome] = useState<ClientInvoiceOutcome | null>(null);
  const valid = /^[0-9]{2}[A-Z0-9]{13}$/.test(gstin) && /^\d{4}-\d{2}$/.test(month);
  const query: NoteRegisterQuery | null = useMemo(
    () => (valid ? { gstin, ...monthBounds(month), kind: kind === '' ? null : kind, status: status === '' ? null : status } : null),
    [valid, gstin, month, kind, status],
  );
  const page = useNoteRegister(query, cursor);

  const columns: DataTableColumn<RegisterRow>[] = [
    { key: 'no', header: 'Note', render: (row) => <span className="font-mono text-xs">{row.noteNo}</span> },
    { key: 'date', header: 'Date', render: (row) => row.noteDate },
    { key: 'kind', header: 'Type', render: (row) => NOTE_KIND_LABEL[row.kind] },
    { key: 'status', header: 'Status', render: (row) => (row.voided ? 'Void' : 'Issued') },
    { key: 'recipient', header: 'Recipient', render: (row) => <span className="text-xs">{row.recipientName} · {row.recipientGstin ?? 'Unregistered'}</span> },
    { key: 'invoice', header: 'Original invoice', render: (row) => <span className="font-mono text-xs">{row.invoiceNo}</span> },
    { key: 'rate', header: 'Rate', numeric: true, render: (row) => gstRateLabel(row.gstBps) },
    { key: 'taxable', header: 'Taxable', numeric: true, render: (row) => formatRupees(row.taxablePaise) },
    { key: 'tax', header: 'Tax', numeric: true, render: (row) => formatRupees(row.igstPaise + row.cgstPaise + row.sgstPaise) },
    { key: 'value', header: 'Note value', numeric: true, render: (row) => formatRupees(row.noteValuePaise) },
  ];

  async function exportCsv() {
    if (query === null || exporting) return;
    const current = readSession();
    if (current === null) return;
    setExporting(true);
    setOutcome(null);
    try {
      const rows: NoteRegisterRowDto[] = [];
      let next: string | null = null;
      do {
        const fetched = await fetchApiClientInvoiceNoteRegister(current.tenant.id, {
          gstin: query.gstin,
          from: query.from,
          to: query.to,
          ...(query.kind === null ? {} : { kind: query.kind }),
          ...(query.status === null ? {} : { status: query.status }),
          ...(next === null ? {} : { cursor: next }),
          limit: 500,
        });
        rows.push(...fetched.rows);
        next = fetched.nextCursor;
      } while (next !== null && rows.length < REGISTER_EXPORT_CAP);
      downloadText(noteRegisterFilename(query.gstin, query.from, query.to), noteRegisterCsv(rows, query));
      setOutcome({ tone: 'accepted', word: `Exported ${rows.length} row${rows.length === 1 ? '' : 's'}`, reason: next === null ? 'Every note in the window.' : `Stopped at ${REGISTER_EXPORT_CAP} rows — narrow the window.` });
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not exported', reason: noteRefusalReason(error) });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Section title="Credit and debit notes">
      <div className="text-(--muted-foreground)">
        The notes issued under one GSTIN in a month — with the fields GSTR-1 asks for (CDNR). Void notes are listed and marked.
      </div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => event.preventDefault()} aria-label="Notes register filters">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Supplier GSTIN</span>
          <input
            className={inputClass}
            value={gstin}
            aria-label="Supplier GSTIN"
            onChange={(event) => {
              setCursor(null);
              setGstin(event.target.value.trim().toUpperCase());
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Month</span>
          <input
            type="month"
            className={inputClass}
            value={month}
            aria-label="Month"
            onChange={(event) => {
              setCursor(null);
              setMonth(event.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Type</span>
          <select
            className={selectClass}
            value={kind}
            aria-label="Type"
            onChange={(event) => {
              setCursor(null);
              setKind(event.target.value as 'credit' | 'debit' | '');
            }}
          >
            <option value="">Credit and debit</option>
            <option value="credit">Credit notes</option>
            <option value="debit">Debit notes</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Status</span>
          <select
            className={selectClass}
            value={status}
            aria-label="Status"
            onChange={(event) => {
              setCursor(null);
              setStatus(event.target.value as 'issued' | 'void' | '');
            }}
          >
            <option value="">Issued and void</option>
            <option value="issued">Issued</option>
            <option value="void">Void</option>
          </select>
        </label>
        <button type="button" className={buttonClass} disabled={query === null || exporting} onClick={exportCsv}>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </form>
      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}
      {query === null ? (
        <div className="text-(--muted-foreground)">Enter a 15-character GSTIN to list its notes.</div>
      ) : page.state === 'failed' ? (
        <ReadFailure word="Notes register unavailable" reason={page.reason} onRetry={page.reload} />
      ) : (
        <DataTable
          key={JSON.stringify(query)}
          columns={columns}
          rows={page.state === 'ready' ? page.data.rows.map((row) => ({ ...row, id: `${row.noteId}:${row.gstBps}` })) : []}
          nextCursor={page.state === 'ready' ? page.data.nextCursor : null}
          onCursor={setCursor}
          emptyMessage={page.state === 'loading' ? 'Loading notes…' : 'No notes under this GSTIN in that month.'}
        />
      )}
    </Section>
  );
}

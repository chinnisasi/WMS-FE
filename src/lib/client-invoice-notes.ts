/**
 * Story 5-6a — credit and debit notes (CGST Act s.34) against an issued
 * client services invoice: the labels, the per-status actions, the draft
 * form's parser, the printed note's wording (Rule 53(1A)), the register CSV
 * and the copy for every refusal. The backend decides every figure — the
 * tax, the exhaust rule, the payable, the deadlines; nothing here taxes or
 * rounds. Amounts are its integer paise.
 *
 * Pure: no React, no fetch — pinned by `client-invoice-notes.test.ts`. The
 * portal reaches this file too (it is a plain lib helper, never a hook).
 */
import { ApiProblem } from '@/lib/api/client';
import type { CreateNoteDto, NoteDto, NoteEntryDto, NoteRegisterRowDto } from '@/lib/api/generated';
import { csvField, csvNumber } from '@/lib/csv';
import { GST_STATE_NAMES } from '@/lib/gst-states';
import { formatRupees } from '@/lib/invoices';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { parseRupees } from '@/lib/rupees';

// ── vocabulary ───────────────────────────────────────────────────────────────

export type NoteKind = NoteDto['kind'];
export type NoteStatus = NoteDto['status'];
export type NoteReason = NoteDto['reason'];

export const NOTE_KIND_LABEL: Readonly<Record<NoteKind, string>> = { credit: 'Credit note', debit: 'Debit note' };
export const NOTE_STATUS_LABEL: Readonly<Record<NoteStatus, string>> = { draft: 'Draft', issued: 'Issued', void: 'Void' };

/** A2 — the reasons, paired with the kind (the backend's NOTE_REASONS_BY_KIND). */
export const NOTE_REASONS_BY_KIND: Readonly<Record<NoteKind, readonly NoteReason[]>> = {
  credit: ['deficiency-in-service', 'post-supply-discount', 'excess-billed'],
  debit: ['short-billed'],
};

export const NOTE_REASON_LABEL: Readonly<Record<NoteReason, string>> = {
  'deficiency-in-service': 'Deficiency in service',
  'post-supply-discount': 'Discount after supply (s.15(3)(b))',
  'excess-billed': 'Billed too much (rate or quantity)',
  'short-billed': 'Billed too little (rate or quantity)',
};

/** Reason notes, void notes and override reasons: 1–500 characters (code points). */
export const NOTE_TEXT_MAX = 500;

export const REASON_NOTE_HINT = 'Printed on the note the client receives.';

/** The signed figure a note moves the invoice by: a credit subtracts, a debit adds. */
export function signedNoteAmount(note: Pick<NoteEntryDto, 'kind' | 'totals'>): string {
  return `${note.kind === 'credit' ? '−' : '+'}${formatRupees(note.totals.payable)}`;
}

/** What each status offers (a settling credit is never voided — A5). */
export function noteActions(note: Pick<NoteEntryDto, 'status' | 'settlesDispute'>): { issue: boolean; discard: boolean; void: boolean } {
  return {
    issue: note.status === 'draft',
    discard: note.status === 'draft',
    void: note.status === 'issued' && !note.settlesDispute,
  };
}

/** A1 — which kinds an invoice of this status may take: credit on issued / disputed / settled, debit on issued only. */
export function noteKindsFor(invoiceStatus: string): readonly NoteKind[] {
  if (invoiceStatus === 'issued') return ['credit', 'debit'];
  if (invoiceStatus === 'disputed' || invoiceStatus === 'settled') return ['credit'];
  return [];
}

// ── the printed note (Rule 53(1A)) ────────────────────────────────────────────

/** The document's heading (b): the nature of the document; a draft and a void say they are not one. */
export function noteHeading(kind: NoteKind, status: NoteStatus): { title: string; notice: string | null } {
  const nature = kind === 'credit' ? 'Credit Note' : 'Debit Note';
  if (status === 'draft') return { title: `DRAFT — not a ${kind} note`, notice: 'A draft has no number; it becomes a note only when issued.' };
  if (status === 'void') return { title: `VOID — ${nature}`, notice: 'This note was voided after issue; its number stays retired.' };
  return { title: nature, notice: null };
}

/** A11 — `Karnataka (29)`. */
export function notePlaceOfSupplyLabel(code: string): string {
  const name = GST_STATE_NAMES[code];
  return name === undefined ? code : `${name} (${code})`;
}

/** The credit deadline (s.34(2)) as the draft shows it — and, once `today` (IST) is past it, that it has run out. */
export function creditDeadlineLabel(lastDay: string, today?: string): string {
  if (today !== undefined && today > lastDay) {
    return `The last day to issue this credit note was ${istDayLabel(lastDay)} (CGST Act s.34(2)) — it can no longer reduce GST. Discard it.`;
  }
  return `Issue by ${istDayLabel(lastDay)} — after that the GST on this supply can no longer be reduced (CGST Act s.34(2)).`;
}

/** A7 — whether this user may issue this credit note under the tenant's policy (the server decides; this hides a doomed click). */
export function issueBlockedForMaker(note: { kind: NoteKind; createdBy: string }, userId: string | undefined, requireSecondApprover: boolean | null): boolean {
  return note.kind === 'credit' && requireSecondApprover !== false && userId !== undefined && note.createdBy === userId;
}

/** The policy PUT's refusal copy (owner-only — not the note commands' owner-or-accountant wording). */
export function notePolicyRefusalReason(error: unknown): string {
  if (error instanceof ApiProblem && error.code === 'role-denied') return 'Only the owner can change this setting.';
  return noteRefusalReason(error);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2027-11-30` → `30 Nov 2027`. */
export function istDayLabel(date: string): string {
  const [y, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

// ── the draft form ───────────────────────────────────────────────────────────

export interface NoteFormLine {
  readonly invoiceLineId: string;
  /** The invoice line's taxable value, paise — the debit plausibility bound (A9). */
  readonly invoiceLinePaise: number;
  /** The rupee text typed; blank = this line is not on the note. */
  readonly amountText: string;
  readonly overrideReason: string;
}

export interface NoteForm {
  readonly kind: NoteKind;
  readonly reason: NoteReason | '';
  readonly reasonNote: string;
  readonly settlesDispute: boolean;
  readonly lines: readonly NoteFormLine[];
}

export type NoteFormProblem = { readonly field: string; readonly problem: string };

/** Whether a debit line needs its override reason (an amount above the invoice line's taxable). */
export function needsOverride(kind: NoteKind, line: Pick<NoteFormLine, 'amountText' | 'invoiceLinePaise'>): boolean {
  if (kind !== 'debit') return false;
  const parsed = parseRupees(line.amountText);
  return 'paise' in parsed && parsed.paise > line.invoiceLinePaise;
}

/**
 * The form → the body to send, or every problem at once (nothing is sent).
 * The server still decides (the cap, the deadlines) — this only refuses
 * what it would refuse as a shape, plus the override a debit over its line needs.
 */
export function parseNoteForm(form: NoteForm): { body: CreateNoteDto; problems: [] } | { body: null; problems: NoteFormProblem[] } {
  const problems: NoteFormProblem[] = [];
  if (form.reason === '' || !NOTE_REASONS_BY_KIND[form.kind].includes(form.reason)) {
    problems.push({ field: 'reason', problem: 'Pick a reason.' });
  }
  const reasonNote = form.reasonNote.trim();
  if (reasonNote === '') problems.push({ field: 'reasonNote', problem: 'Say why — the note is printed on the client’s copy.' });
  else if ([...reasonNote].length > NOTE_TEXT_MAX) problems.push({ field: 'reasonNote', problem: `At most ${NOTE_TEXT_MAX} characters.` });
  const lines: CreateNoteDto['lines'] = [];
  for (const line of form.lines) {
    if (line.amountText.trim() === '') continue;
    const parsed = parseRupees(line.amountText);
    if ('problem' in parsed) {
      problems.push({ field: `amount:${line.invoiceLineId}`, problem: parsed.problem });
      continue;
    }
    if (parsed.paise <= 0) {
      problems.push({ field: `amount:${line.invoiceLineId}`, problem: 'Enter an amount above ₹0.00, or leave the line blank.' });
      continue;
    }
    const override = line.overrideReason.trim();
    if (needsOverride(form.kind, line) && override === '') {
      problems.push({ field: `override:${line.invoiceLineId}`, problem: `Above the invoiced ${formatRupees(line.invoiceLinePaise)} — say why the debit is larger.` });
      continue;
    }
    if (override !== '' && [...override].length > NOTE_TEXT_MAX) {
      problems.push({ field: `override:${line.invoiceLineId}`, problem: `At most ${NOTE_TEXT_MAX} characters.` });
      continue;
    }
    // An override is sent only while the debit is above its line — a reason typed for a larger amount is not stored once the amount drops.
    lines.push({ invoiceLineId: line.invoiceLineId, amountPaise: parsed.paise, ...(needsOverride(form.kind, line) ? { overrideReason: override } : {}) });
  }
  if (lines.length === 0 && !problems.some((p) => p.field.startsWith('amount:') || p.field.startsWith('override:'))) {
    problems.push({ field: 'lines', problem: 'Enter an amount on at least one line.' });
  }
  if (problems.length > 0) return { body: null, problems };
  return {
    body: {
      kind: form.kind,
      reason: form.reason as NoteReason,
      reasonNote,
      ...(form.kind === 'credit' && form.settlesDispute ? { settlesDispute: true } : {}),
      lines,
    },
    problems: [],
  };
}

// ── the register CSV ─────────────────────────────────────────────────────────

const rupeeCell = (paise: number): string => csvNumber((paise / 100).toFixed(2));

/**
 * The notes register as CSV (A15 — the web writes it; billing has no server
 * export): a header, then one row per (note, rate). Text through `csvField`
 * (the formula guard), numbers plain through `csvNumber`, rupees to two
 * decimals as positive magnitudes with the note type C / D beside them (the
 * GSTR-1 CDNR convention). A void note is listed and marked, never dropped.
 */
export function noteRegisterCsv(rows: readonly NoteRegisterRowDto[], meta: { gstin: string; from: string; to: string }): string {
  const header = [
    'Note number',
    'Note date',
    'Note type',
    'Status',
    'Recipient GSTIN',
    'Recipient name',
    'Place of supply',
    'Supply type',
    'Original invoice',
    'Original invoice date',
    'Rate %',
    'Taxable value',
    'IGST',
    'CGST',
    'SGST/UTGST',
    'Note value',
  ];
  const lines = [
    csvField(`# Credit and debit notes — supplier GSTIN ${meta.gstin}, ${meta.from} to ${meta.to} (IST)`),
    header.map(csvField).join(','),
    ...rows.map((row) =>
      [
        csvField(row.noteNo),
        csvField(row.noteDate),
        csvField(row.kind === 'credit' ? 'C' : 'D'),
        csvField(row.voided ? 'Void' : 'Issued'),
        csvField(row.recipientGstin ?? 'Unregistered'),
        csvField(row.recipientName),
        csvField(`${row.placeOfSupply}-${GST_STATE_NAMES[row.placeOfSupply] ?? ''}`),
        csvField(row.supplyType === 'intra' ? 'Intra-state' : 'Inter-state'),
        csvField(row.invoiceNo),
        csvField(row.invoiceDate),
        csvNumber((row.gstBps / 100).toFixed(2)),
        rupeeCell(row.taxablePaise),
        rupeeCell(row.igstPaise),
        rupeeCell(row.cgstPaise),
        rupeeCell(row.sgstPaise),
        rupeeCell(row.noteValuePaise),
      ].join(','),
    ),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** `29/C2627/000001` → a file-safe name part. */
export function noteRegisterFilename(gstin: string, from: string, to: string): string {
  return `notes-${gstin}-${from}-to-${to}.csv`;
}

// ── refusals ─────────────────────────────────────────────────────────────────

/** The `credit-exceeds-invoice` refusal's per-line remainders (structured, never parsed from prose). */
export function exceededLines(error: unknown): readonly { invoiceLineId: string; remainingPaise: number }[] {
  if (!(error instanceof ApiProblem) || error.code !== 'credit-exceeds-invoice') return [];
  const lines = error.extensions.lines;
  if (!Array.isArray(lines)) return [];
  return lines.filter(
    (line): line is { invoiceLineId: string; remainingPaise: number } =>
      typeof line === 'object' && line !== null && typeof (line as { invoiceLineId?: unknown }).invoiceLineId === 'string' && typeof (line as { remainingPaise?: unknown }).remainingPaise === 'number',
  );
}

/** Every refusal a note command answers, worded for the operator. `describeLine` names an invoice line. */
export function noteRefusalReason(error: unknown, describeLine: (invoiceLineId: string) => string = (id) => id): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE_REASON;
  switch (error.code) {
    case 'credit-exceeds-invoice': {
      const lines = exceededLines(error);
      return lines.length === 0
        ? 'A credit note cannot exceed what the invoice still holds — reduce the amount.'
        : `A credit note cannot exceed the invoice: ${lines.map((line) => `${describeLine(line.invoiceLineId)} — at most ${formatRupees(line.remainingPaise)} left to credit`).join('; ')}.`;
    }
    case 'credit-note-time-barred':
      // The server's copy names the last day (spec A10).
      return error.detail ?? 'This supply is past its s.34(2) date — a credit note can no longer reduce tax.';
    case 'invoice-not-noteable':
      return 'Only an issued, disputed or settled invoice takes a note — refresh the invoice.';
    case 'invoice-not-debitable':
      return 'A debit note amends an issued invoice only — resolve the dispute first, or raise a new invoice.';
    case 'invoice-not-disputed':
      return 'The invoice is no longer disputed — untick “Settles the dispute”, or refresh.';
    case 'debit-needs-override':
      return 'A debit above its invoice line needs a reason on that line.';
    case 'note-figures-changed':
      return 'The credit notes on this invoice changed since this draft was made (one was issued or voided) — discard this draft and create it again.';
    case 'note-not-draft':
      return 'This note is no longer a draft — the list has been refreshed.';
    case 'note-not-issued':
      return 'Only an issued note can be voided — refresh the note.';
    case 'note-settles-dispute':
      return 'This credit note settled the dispute, and a settled invoice never reopens — correct it with a further note.';
    case 'note-period-closed':
      return error.detail ?? 'The GSTR-1 due date for this note’s month has passed — correct it with a further note.';
    case 'note-needs-second-approver':
      return error.detail ?? 'Another member with billing rights must do this — the tenant requires a second person for credit notes.';
    case 'einvoice-required':
      return 'E-invoicing applies to this GSTIN and the client is registered — the note needs an IRN, which is not supported yet.';
    case 'note-series-exhausted':
      return error.detail ?? 'This note series has used all its numbers for the year.';
    case 'not-found':
      return 'That invoice, line or note no longer exists — refresh.';
    case 'validation-failed':
      return error.detail ?? 'Check the note and try again.';
    case 'role-denied':
      return 'Only an owner or an accountant can create, issue or void notes.';
    case 'permission-denied':
      return 'That data belongs to another tenant — sign in again.';
    case 'unauthenticated':
      return 'Your session expired — sign in again.';
    case 'idempotency-key-reuse':
      return 'This request was already processed — refresh and try again.';
    case 'conflict':
      return 'The same request is still being processed — wait a moment and refresh.';
    default:
      return error.detail ?? `Not done (${error.code}).`;
  }
}

/** The refusals whose recovery is a re-read (the note or the invoice moved under the operator). */
export function noteNeedsReread(error: unknown): boolean {
  return (
    error instanceof ApiProblem &&
    ['note-not-draft', 'note-not-issued', 'not-found', 'invoice-not-noteable', 'invoice-not-debitable', 'invoice-not-disputed', 'note-figures-changed'].includes(error.code)
  );
}

export function noteReadReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'That note or invoice no longer exists — refresh the list.';
      case 'role-denied':
        return 'Notes are an operator surface — this session cannot read them.';
      case 'invalid-cursor':
        return 'That page reference is stale — Retry restarts from the first page.';
      case 'validation-failed':
        return error.detail ?? 'Check the GSTIN and the dates.';
      default:
        return error.detail ?? `Could not load the notes (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

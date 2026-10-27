import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { NoteRegisterRowDto } from '@/lib/api/generated';
import {
  NOTE_REASONS_BY_KIND,
  creditDeadlineLabel,
  exceededLines,
  needsOverride,
  noteActions,
  noteHeading,
  noteKindsFor,
  notePlaceOfSupplyLabel,
  noteRefusalReason,
  noteRegisterCsv,
  parseNoteForm,
  signedNoteAmount,
  type NoteForm,
} from '@/lib/client-invoice-notes';
import { clientInvoiceActionReason } from '@/lib/client-invoices';

/**
 * Story 5-6a — the pure decisions of the credit / debit note surface: the
 * eligibility and actions per status, the draft form's parser (what is sent
 * and what is refused locally), the printed heading, the register CSV and
 * the copy for every refusal the backend answers.
 */

function problem(code: string, extra: { detail?: string; extensions?: Record<string, unknown> } = {}): ApiProblem {
  return new ApiProblem(code, 409, extra.detail, code, extra.extensions ?? {});
}

const base: NoteForm = {
  kind: 'credit',
  reason: 'excess-billed',
  reasonNote: '  Rate keyed wrongly  ',
  settlesDispute: false,
  lines: [
    { invoiceLineId: 'l-1', invoiceLinePaise: 100_000, amountText: '200', overrideReason: '' },
    { invoiceLineId: 'l-2', invoiceLinePaise: 50_000, amountText: '', overrideReason: '' },
  ],
};

describe('client invoice notes — vocabulary and actions', () => {
  test('A1: a credit on an issued, disputed or settled invoice; a debit on an issued one only; nothing on a draft or void', () => {
    expect(noteKindsFor('issued')).toEqual(['credit', 'debit']);
    expect(noteKindsFor('disputed')).toEqual(['credit']);
    expect(noteKindsFor('settled')).toEqual(['credit']);
    expect(noteKindsFor('draft')).toEqual([]);
    expect(noteKindsFor('void')).toEqual([]);
  });

  test('A2: the reasons are paired with the kind — no dispute-settlement reason', () => {
    expect(NOTE_REASONS_BY_KIND.credit).toEqual(['deficiency-in-service', 'post-supply-discount', 'excess-billed']);
    expect(NOTE_REASONS_BY_KIND.debit).toEqual(['short-billed']);
  });

  test('actions per status: a draft issues or discards; an issued note voids — unless it settled a dispute (A5); a void does nothing', () => {
    expect(noteActions({ status: 'draft', settlesDispute: false })).toEqual({ issue: true, discard: true, void: false });
    expect(noteActions({ status: 'issued', settlesDispute: false })).toEqual({ issue: false, discard: false, void: true });
    expect(noteActions({ status: 'issued', settlesDispute: true })).toEqual({ issue: false, discard: false, void: false });
    expect(noteActions({ status: 'void', settlesDispute: false })).toEqual({ issue: false, discard: false, void: false });
  });

  test('the printed heading names the nature of the document (Rule 53(1A)(b)); a draft and a void say they are not one', () => {
    expect(noteHeading('credit', 'issued').title).toBe('Credit Note');
    expect(noteHeading('debit', 'issued').title).toBe('Debit Note');
    expect(noteHeading('credit', 'draft').title).toBe('DRAFT — not a credit note');
    expect(noteHeading('debit', 'void').title).toBe('VOID — Debit Note');
  });

  test('labels: the signed amount, the place of supply, the deadline', () => {
    const totals = { subtotal: 20_000, cgst: 1800, sgst: 1800, igst: 0, tax: 3600, roundOff: 0, payable: 23_600 };
    expect(signedNoteAmount({ kind: 'credit', totals })).toBe('−₹236.00');
    expect(signedNoteAmount({ kind: 'debit', totals })).toBe('+₹236.00');
    expect(notePlaceOfSupplyLabel('29')).toBe('Karnataka (29)');
    expect(creditDeadlineLabel('2027-11-30')).toContain('30 Nov 2027');
    expect(creditDeadlineLabel('2027-11-30')).toContain('s.34(2)');
    // On the last day still "issue by"; the day after, it says the deadline has passed.
    expect(creditDeadlineLabel('2027-11-30', '2027-11-30')).toContain('Issue by 30 Nov 2027');
    expect(creditDeadlineLabel('2027-11-30', '2027-12-01')).toContain('can no longer reduce GST');
  });
});

describe('client invoice notes — the draft form', () => {
  test('a valid credit: the trimmed reason note, only the lines with an amount, paise from rupees; no settles unless ticked', () => {
    expect(parseNoteForm(base)).toEqual({
      body: { kind: 'credit', reason: 'excess-billed', reasonNote: 'Rate keyed wrongly', lines: [{ invoiceLineId: 'l-1', amountPaise: 20_000 }] },
      problems: [],
    });
    const settling = parseNoteForm({ ...base, settlesDispute: true });
    expect(settling.body).toMatchObject({ settlesDispute: true });
  });

  test('every problem at once: no reason, a blank reason note, a malformed amount, a zero amount — nothing is sent', () => {
    const result = parseNoteForm({
      ...base,
      reason: '',
      reasonNote: '   ',
      lines: [
        { invoiceLineId: 'l-1', invoiceLinePaise: 100_000, amountText: '12.345', overrideReason: '' },
        { invoiceLineId: 'l-2', invoiceLinePaise: 50_000, amountText: '0', overrideReason: '' },
      ],
    });
    expect(result.body).toBeNull();
    expect(result.problems.map((p) => p.field)).toEqual(['reason', 'reasonNote', 'amount:l-1', 'amount:l-2']);
  });

  test('no line at all → "enter an amount on at least one line"; a 501-character reason note is refused (code points)', () => {
    expect(parseNoteForm({ ...base, lines: base.lines.map((l) => ({ ...l, amountText: '' })) }).problems.map((p) => p.field)).toEqual(['lines']);
    expect(parseNoteForm({ ...base, reasonNote: 'x'.repeat(501) }).problems.map((p) => p.field)).toEqual(['reasonNote']);
    expect(parseNoteForm({ ...base, reasonNote: '𝟘'.repeat(500) }).problems).toEqual([]);
  });

  test('A9: a debit above its invoice line needs an override reason; with one it is sent; a credit never sends one', () => {
    const debit: NoteForm = { ...base, kind: 'debit', reason: 'short-billed', lines: [{ invoiceLineId: 'l-1', invoiceLinePaise: 100_000, amountText: '1200', overrideReason: '' }] };
    expect(needsOverride('debit', debit.lines[0]!)).toBe(true);
    expect(needsOverride('credit', debit.lines[0]!)).toBe(false);
    expect(parseNoteForm(debit).problems.map((p) => p.field)).toEqual(['override:l-1']);
    expect(parseNoteForm({ ...debit, lines: [{ ...debit.lines[0]!, overrideReason: ' Revised rate ' }] }).body).toEqual({
      kind: 'debit',
      reason: 'short-billed',
      reasonNote: 'Rate keyed wrongly',
      lines: [{ invoiceLineId: 'l-1', amountPaise: 120_000, overrideReason: 'Revised rate' }],
    });
    const credit = parseNoteForm({ ...base, lines: [{ ...base.lines[0]!, overrideReason: 'ignored' }] });
    expect(credit.body!.lines).toEqual([{ invoiceLineId: 'l-1', amountPaise: 20_000 }]);
    // A reason typed for a larger amount is not sent once the amount drops to the line (E5).
    expect(parseNoteForm({ ...debit, lines: [{ ...debit.lines[0]!, amountText: '500', overrideReason: 'stale' }] }).body!.lines).toEqual([{ invoiceLineId: 'l-1', amountPaise: 50_000 }]);
    // A debit never settles a dispute.
    expect(parseNoteForm({ ...debit, settlesDispute: true, lines: [{ ...debit.lines[0]!, amountText: '10' }] }).body).not.toHaveProperty('settlesDispute');
  });
});

describe('client invoice notes — refusals', () => {
  test('every 409 arm has its own copy; credit-exceeds-invoice names each line’s remainder from the structured member', () => {
    const exceeded = problem('credit-exceeds-invoice', { extensions: { lines: [{ invoiceLineId: 'l-1', remainingPaise: 10_000 }] } });
    expect(exceededLines(exceeded)).toEqual([{ invoiceLineId: 'l-1', remainingPaise: 10_000 }]);
    expect(noteRefusalReason(exceeded, () => 'Pick handling')).toBe('A credit note cannot exceed the invoice: Pick handling — at most ₹100.00 left to credit.');
    const copies = new Map<string, string>();
    for (const code of [
      'invoice-not-noteable',
      'invoice-not-debitable',
      'invoice-not-disputed',
      'debit-needs-override',
      'note-figures-changed',
      'note-not-draft',
      'note-not-issued',
      'note-settles-dispute',
      'einvoice-required',
      'not-found',
      'role-denied',
    ]) {
      const copy = noteRefusalReason(problem(code));
      expect(copy).not.toContain(code);
      copies.set(code, copy);
    }
    expect(new Set(copies.values()).size).toBe(copies.size);
    expect(copies.get('note-figures-changed')).toContain('discard this draft and create it again');
    // The server's own copy where it names a date or a person.
    expect(noteRefusalReason(problem('credit-note-time-barred', { detail: '… (last day 30 Nov 2027) …' }))).toContain('last day 30 Nov 2027');
    expect(noteRefusalReason(problem('note-period-closed', { detail: 'voids close at 2027-06-12' }))).toContain('2027-06-12');
    expect(noteRefusalReason(problem('note-needs-second-approver', { detail: 'You drafted this credit note' }))).toContain('You drafted');
  });

  test('A23: the invoice void refusal invoice-has-notes has its copy', () => {
    expect(clientInvoiceActionReason(problem('invoice-has-notes'))).toBe('This invoice has issued credit/debit notes — void its notes first.');
  });
});

describe('client invoice notes — the register CSV', () => {
  const row: NoteRegisterRowDto = {
    noteId: 'n-1',
    noteNo: '29/C2728/000001',
    noteDate: '2027-05-03',
    kind: 'credit',
    status: 'issued',
    voided: false,
    recipientGstin: '29AAACA1111A1Z1',
    recipientName: '=HYPERLINK("x")',
    placeOfSupply: '29',
    supplyType: 'intra',
    invoiceNo: '29/S2627/000001',
    invoiceDate: '2026-10-05',
    gstBps: 1800,
    taxablePaise: 30_000,
    igstPaise: 0,
    cgstPaise: 2700,
    sgstPaise: 2700,
    noteValuePaise: 35_400,
  };

  test('text through csvField (the formula guard), numbers plain, rupees to two decimals, C / D, a void marked', () => {
    const csv = noteRegisterCsv([row, { ...row, noteId: 'n-2', noteNo: '29/D2728/000001', kind: 'debit', status: 'void', voided: true, recipientGstin: null }], {
      gstin: '29AAACT1234A1Z5',
      from: '2027-05-01',
      to: '2027-05-31',
    });
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.replace('﻿', '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('"# Credit and debit notes — supplier GSTIN 29AAACT1234A1Z5, 2027-05-01 to 2027-05-31 (IST)"');
    expect(lines[1]).toContain('"Note number","Note date","Note type","Status"');
    expect(lines[2]).toBe(
      '"29/C2728/000001","2027-05-03","C","Issued","29AAACA1111A1Z1","\'=HYPERLINK(""x"")","29-Karnataka","Intra-state","29/S2627/000001","2026-10-05",18.00,300.00,0.00,27.00,27.00,354.00',
    );
    expect(lines[3]).toContain('"D","Void","Unregistered"');
  });
});

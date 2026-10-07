'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import {
  fetchApiDiscardClientInvoice,
  fetchApiIssueClientInvoice,
  fetchApiPrepareClientInvoices,
  fetchApiRefreshClientInvoice,
  fetchApiTransitionClientInvoice,
} from '@/lib/api/client';
import type { ClientDto, ClientInvoiceDto, ClientInvoiceEntryDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import {
  CLIENT_INVOICE_STATUS_LABEL,
  VERB_LABEL,
  VERB_REFUSED_WORD,
  VOID_WARNING,
  actionNeedsReread,
  clientInvoiceActionReason,
  clientInvoiceActions,
  clientInvoiceGapLabel,
  clientInvoiceHeading,
  clientInvoiceWarningLabel,
  gapCountLabel,
  invoiceMonthOptions,
  issueBlockedHint,
  issueOutcome,
  lineDescription,
  lineQuantityLabel,
  lineRateLabel,
  lineTaxableLabel,
  monthLabel,
  noteRequired,
  notifyClientInvoicesChanged,
  parseStatusNote,
  prepareOutcome,
  prepareReason,
  printCopies,
  recipientAddressLines,
  stateLabel,
  supplierAddressLines,
  transitionOutcome,
  type ClientInvoiceOutcome,
  type ClientInvoiceVerb,
} from '@/lib/client-invoices';
import { amountInWords, formatRoundOff, formatRupees, gstRateLabel, invoiceDateLabel, placeOfSupplyLabel, taxRateLabels } from '@/lib/invoices';
import { pricedClients } from '@/lib/rate-cards';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useClientInvoiceDetail, useClientInvoices } from '@/lib/use-client-invoices';
import { useClients } from '@/lib/use-clients';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure, Section, buttonClass, inputClass, labelClass, primaryClass, rowButtonClass } from '@/components/outbound/shell';

/**
 * The /compliance Client invoices section (story 21-5): a 3PL's monthly
 * services (SAC) tax invoice to each client brand, one per supplying GSTIN.
 * Every member reads the list and prints an invoice; an owner or accountant
 * (`billing.invoice`) prepares a month's drafts, refreshes, issues or
 * discards a draft, and disputes, settles or voids an issued invoice.
 *
 * Pessimistic throughout (frontend guide §2): every figure is the server's,
 * re-read after each mutation (`notifyClientInvoicesChanged`). An issue the
 * server answers `stale` shows the fresh draft and the banner "Figures
 * changed — review and issue again"; the next Issue is a new click with a
 * new key.
 */
export function ClientInvoices() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <Section title="Client invoices">
        <div className="text-(--muted-foreground)">Sign in to read your client invoices.</div>
      </Section>
    );
  }
  return <ClientInvoicesSessioned />;
}

function ClientInvoicesSessioned() {
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canInvoice = roleHasCapability(role, 'billing.invoice');
  const clients = useClients();
  const brands = clients.state === 'ready' ? pricedClients(clients.data) : [];
  const codeOf = (clientId: string): string => brands.find((client) => client.id === clientId)?.code ?? `${clientId.slice(0, 8)}…`;
  const list = useClientInvoices();
  const [openId, setOpenId] = useState<string | null>(null);
  // A prepare inserts rows at the top of the newest-first keyset: the table
  // returns to page one and remounts (frontend guide §1.4).
  const [pageEpoch, setPageEpoch] = useState(0);
  // Outcomes live HERE, outside the remounted table — a discard removes the
  // row (and its detail) the moment it succeeds.
  const [outcome, setOutcome] = useState<ClientInvoiceOutcome | null>(null);

  function onPrepared(result: ClientInvoiceOutcome) {
    setOutcome(result);
    list.onCursor(null);
    setPageEpoch((e) => e + 1);
    notifyClientInvoicesChanged();
  }

  const columns: DataTableColumn<ClientInvoiceEntryDto>[] = [
    { key: 'status', header: 'Status', render: (row) => CLIENT_INVOICE_STATUS_LABEL[row.status] ?? row.status },
    {
      key: 'number',
      header: 'Number',
      render: (row) => (row.invoiceNo === null ? <span className="text-(--muted-foreground)">Unnumbered</span> : <span className="font-mono text-xs">{row.invoiceNo}</span>),
    },
    { key: 'client', header: 'Client', render: (row) => <span className="font-mono text-xs">{codeOf(row.clientId)}</span> },
    { key: 'month', header: 'Month', render: (row) => monthLabel(row.periodStart) },
    { key: 'gstin', header: 'Supplier GSTIN', render: (row) => <span className="font-mono text-xs">{row.supplierGstin ?? '—'}</span> },
    { key: 'payable', header: 'Payable', numeric: true, render: (row) => formatRupees(row.totals.payable) },
    { key: 'gaps', header: 'Gaps', render: (row) => <span className="text-xs">{gapCountLabel(row.gapCount)}</span> },
    {
      key: 'open',
      header: '',
      render: (row) => (
        <button
          type="button"
          className={rowButtonClass}
          aria-expanded={openId === row.id}
          aria-controls={expandedRowId(row.id)}
          onClick={() => setOpenId(openId === row.id ? null : row.id)}
        >
          {openId === row.id ? 'Hide' : 'View'}
        </button>
      ),
    },
  ];

  return (
    <Section title="Client invoices">
      <div className="text-(--muted-foreground)">
        A monthly services tax invoice to each client brand for its storage and handling — one per supplying GSTIN.
        Prepare a month once it has ended, clear the gaps, and issue; an issued invoice never changes.
      </div>

      {canInvoice && clients.state === 'ready' && brands.length > 0 ? <PrepareForm brands={brands} onPrepared={onPrepared} /> : null}

      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}

      {list.state === 'failed' ? (
        <ReadFailure word="Client invoices unavailable" reason={list.reason} onRetry={list.reload} />
      ) : (
        <DataTable
          key={pageEpoch}
          columns={columns}
          rows={list.state === 'ready' ? list.data.items : []}
          nextCursor={list.state === 'ready' ? list.data.nextCursor : null}
          onCursor={list.onCursor}
          emptyMessage={list.state === 'loading' ? 'Loading client invoices…' : 'No client invoices yet — prepare a month to start.'}
          renderExpanded={(row) =>
            row.id === openId ? (
              <ClientInvoiceDetail
                invoiceId={row.id}
                canInvoice={canInvoice}
                onOutcome={setOutcome}
                onDiscarded={() => setOpenId(null)}
              />
            ) : null
          }
        />
      )}
    </Section>
  );
}

/**
 * Prepare a client's month — per-draft Idempotency-Key: minted on the first
 * submit, reused across retries of the unchanged choice (a prepare that timed
 * out after the server committed must replay), cleared when the client or the
 * month changes and on success.
 */
function PrepareForm({ brands, onPrepared }: { brands: readonly ClientDto[]; onPrepared: (outcome: ClientInvoiceOutcome) => void }) {
  const [pickedClient, setPickedClient] = useState<string | null>(null);
  // The month list's "now", read once at mount (a render must stay pure);
  // the server still decides — an unended month answers period-not-ended.
  const [nowMs] = useState(() => Date.now());
  const client = brands.find((entry) => entry.id === pickedClient) ?? brands[0]!;
  const months = invoiceMonthOptions(client.createdAt, nowMs);
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);
  const month = months.find((option) => option.value === pickedMonth) ?? months[0] ?? null;
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null || month === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setRefusal(null);
    keyRef.current ??= ulid();
    try {
      const result = await fetchApiPrepareClientInvoices(session.tenant.id, client.id, month.value, keyRef.current);
      keyRef.current = null;
      onPrepared(prepareOutcome(result));
    } catch (error) {
      setRefusal(prepareReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Prepare client invoices" className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-48 flex-col gap-1">
        <span className={labelClass}>Client</span>
        <select
          className={inputClass}
          value={client.id}
          aria-label="Invoice client"
          onChange={(event) => {
            keyRef.current = null;
            setPickedClient(event.target.value);
          }}
        >
          {brands.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.code} — {entry.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-40 flex-col gap-1">
        <span className={labelClass}>Month</span>
        <select
          className={inputClass}
          value={month?.value ?? ''}
          aria-label="Invoice month"
          onChange={(event) => {
            keyRef.current = null;
            setPickedMonth(event.target.value);
          }}
        >
          {months.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={primaryClass} disabled={busy || month === null}>
        {busy ? 'Preparing…' : 'Prepare'}
      </button>
      {month === null ? <div className="w-full text-xs text-(--muted-foreground)">No month of this client has ended yet.</div> : null}
      {refusal !== null ? (
        <div className="w-full">
          <FeedbackBanner tone="rejected" word="Not prepared" reason={refusal} />
        </div>
      ) : null}
    </form>
  );
}

type Confirm = { kind: 'discard' } | { kind: 'transition'; verb: ClientInvoiceVerb };

function ClientInvoiceDetail({
  invoiceId,
  canInvoice,
  onOutcome,
  onDiscarded,
}: {
  invoiceId: string;
  canInvoice: boolean;
  onOutcome: (outcome: ClientInvoiceOutcome) => void;
  onDiscarded: () => void;
}) {
  const detail = useClientInvoiceDetail(invoiceId);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // A pre-render double-click fires both handlers before `disabled` renders.
  const inFlight = useRef(false);

  if (detail.state === 'failed') return <ReadFailure word="Client invoice unavailable" reason={detail.reason} onRetry={detail.reload} />;
  if (detail.state === 'loading') return <div className="text-(--muted-foreground)">Loading…</div>;
  const invoice = detail.data;
  const actions = clientInvoiceActions(invoice.status);

  async function run(work: (tenantId: string) => Promise<ClientInvoiceOutcome>, word: string) {
    const session = readSession();
    if (session === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      onOutcome(await work(session.tenant.id));
      notifyClientInvoicesChanged();
    } catch (error) {
      onOutcome({ tone: 'rejected', word, reason: clientInvoiceActionReason(error) });
      if (actionNeedsReread(error)) notifyClientInvoicesChanged();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  // Refresh and Issue mint a NEW key per click: an issue answered `stale` is
  // recorded under its key, so re-sending that key would re-serve "stale".
  const refresh = () =>
    run(async (tenantId) => {
      const fresh = await fetchApiRefreshClientInvoice(tenantId, invoice.id, ulid());
      return { tone: 'accepted', word: 'Draft refreshed', reason: fresh.gaps.length === 0 ? 'No gaps — ready to issue.' : `${fresh.gaps.length} gap(s) remain.` };
    }, 'Not refreshed');
  const issue = () => run(async (tenantId) => issueOutcome(await fetchApiIssueClientInvoice(tenantId, invoice.id, ulid())), 'Not issued');

  return (
    <div className="flex flex-col gap-3 py-1">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} onClick={() => window.print()}>
          Print
        </button>
        {canInvoice && actions.refresh ? (
          <button type="button" className={buttonClass} disabled={busy} onClick={refresh}>
            Refresh
          </button>
        ) : null}
        {canInvoice && actions.issue ? (
          // A draft with gaps cannot issue (the server answers 409): Issue is
          // disabled with the way forward — fix the gaps, then Refresh.
          <button type="button" className={primaryClass} disabled={busy || invoice.gaps.length > 0} onClick={issue}>
            Issue
          </button>
        ) : null}
        {canInvoice && actions.discard ? (
          <button type="button" className={buttonClass} disabled={busy} onClick={() => setConfirm({ kind: 'discard' })}>
            Discard
          </button>
        ) : null}
        {canInvoice
          ? (['dispute', 'settle', 'void'] as const)
              .filter((verb) => actions[verb])
              .map((verb) => (
                <button key={verb} type="button" className={buttonClass} disabled={busy} onClick={() => setConfirm({ kind: 'transition', verb })}>
                  {VERB_LABEL[verb]}
                </button>
              ))
          : null}
      </div>

      {canInvoice && actions.issue && issueBlockedHint(invoice.gaps.length) !== null ? (
        <div className="text-xs text-(--muted-foreground) print:hidden">{issueBlockedHint(invoice.gaps.length)}</div>
      ) : null}

      {canInvoice && confirm !== null && confirm.kind === 'discard' ? (
        <DiscardConfirm
          key={`discard-${invoice.id}`}
          invoiceId={invoice.id}
          onClose={() => setConfirm(null)}
          onDone={(result) => {
            setConfirm(null);
            onOutcome(result);
            onDiscarded();
            notifyClientInvoicesChanged();
          }}
          onRejected={(reason) => onOutcome({ tone: 'rejected', word: 'Not discarded', reason })}
        />
      ) : null}
      {canInvoice && confirm !== null && confirm.kind === 'transition' ? (
        <TransitionForm
          key={`${confirm.verb}-${invoice.id}`}
          invoice={invoice}
          verb={confirm.verb}
          onClose={() => setConfirm(null)}
          onDone={(result) => {
            setConfirm(null);
            onOutcome(result);
            notifyClientInvoicesChanged();
          }}
          onRejected={(error) => {
            onOutcome({ tone: 'rejected', word: VERB_REFUSED_WORD[confirm.verb], reason: clientInvoiceActionReason(error) });
            if (actionNeedsReread(error)) notifyClientInvoicesChanged();
          }}
        />
      ) : null}

      {invoice.gaps.length > 0 ? (
        // Screen-only: what blocks issue — never part of the printed document.
        <ul className="flex flex-col gap-0.5 text-xs print:hidden" aria-label="Invoice gaps">
          {invoice.gaps.map((gap, index) => (
            <li key={`${gap.code}-${index}`}>
              <span className="font-medium">Blocking — {clientInvoiceGapLabel(gap.code)}:</span>{' '}
              <span className="text-(--muted-foreground)">{gap.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {invoice.warnings.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs print:hidden" aria-label="Invoice warnings">
          {invoice.warnings.map((warning, index) => (
            <li key={`${warning.code}-${index}`}>
              <span className="font-medium">Warning — {clientInvoiceWarningLabel(warning.code)}:</span>{' '}
              <span className="text-(--muted-foreground)">{warning.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {invoice.statusNote !== null ? <div className="text-xs print:hidden">Note: {invoice.statusNote}</div> : null}

      <PrintableClientInvoice invoice={invoice} />
    </div>
  );
}

/** The discard confirmation — the key lives with the confirmation (per-confirmation). */
function DiscardConfirm({
  invoiceId,
  onClose,
  onDone,
  onRejected,
}: {
  invoiceId: string;
  onClose: () => void;
  onDone: (outcome: ClientInvoiceOutcome) => void;
  onRejected: (reason: string) => void;
}) {
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
      await fetchApiDiscardClientInvoice(session.tenant.id, invoiceId, keyRef.current);
      onDone({ tone: 'accepted', word: 'Draft discarded', reason: 'Nothing was issued from it. Prepare the month again to redraft.' });
    } catch (error) {
      onRejected(clientInvoiceActionReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label="Confirm discard" className="flex flex-wrap items-center gap-2">
      <span>Discard this draft?</span>
      <button type="button" className={primaryClass} disabled={busy} onClick={confirm}>
        Discard draft
      </button>
      <button type="button" className={rowButtonClass} onClick={onClose}>
        Keep
      </button>
    </div>
  );
}

/**
 * Dispute, settle or void — a note (required to dispute or void), and for a
 * void the standing GSTR-1 warning. Per-confirmation key: minted on the first
 * press, reused by a retry of the same note, cleared when the note changes.
 */
function TransitionForm({
  invoice,
  verb,
  onClose,
  onDone,
  onRejected,
}: {
  invoice: ClientInvoiceDto;
  verb: ClientInvoiceVerb;
  onClose: () => void;
  onDone: (outcome: ClientInvoiceOutcome) => void;
  onRejected: (error: unknown) => void;
}) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseStatusNote(verb, text);
    if (parsed.problem !== null) {
      setProblem(parsed.problem);
      return;
    }
    const session = readSession();
    if (session === null) return;
    setProblem(null);
    inFlight.current = true;
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const moved = await fetchApiTransitionClientInvoice(session.tenant.id, invoice.id, verb, parsed.note, keyRef.current);
      onDone(transitionOutcome(moved));
    } catch (error) {
      onRejected(error);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={`${VERB_LABEL[verb]} invoice`} className="flex flex-col gap-2 rounded-md border border-(--border) p-3">
      {verb === 'void' ? <FeedbackBanner tone="warning" word="Before you void" reason={VOID_WARNING} /> : null}
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Note {noteRequired(verb) ? '(required)' : '(optional)'}</span>
        <input
          className={inputClass}
          value={text}
          maxLength={1000}
          aria-label="Status note"
          onChange={(event) => {
            keyRef.current = null;
            setText(event.target.value);
          }}
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" className={primaryClass} disabled={busy}>
          {VERB_LABEL[verb]} invoice
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

/**
 * The printable services tax invoice (Rule 46), printed from the invoice's
 * `party` snapshot — never the live client or tenant. A draft prints as
 * "DRAFT — not a tax invoice". `data-print-root` scopes the print stylesheet.
 */
export function PrintableClientInvoice({ invoice }: { invoice: ClientInvoiceDto }) {
  // Rule 48(2): an issued services invoice prints in duplicate — the second
  // copy only on paper (a page break before it), hidden on screen.
  return (
    <article data-print-root aria-label="Printable client invoice" className="flex flex-col gap-3 rounded-md border border-(--border) bg-(--background) p-4">
      {printCopies(invoice.status).map((copy, index) => (
        <section
          key={copy ?? 'single'}
          aria-label={copy ?? 'Invoice'}
          data-copy={copy ?? undefined}
          className={index === 0 ? 'flex flex-col gap-3' : 'hidden flex-col gap-3 print:flex print:break-before-page'}
        >
          <InvoiceCopy invoice={invoice} copy={copy} />
        </section>
      ))}
    </article>
  );
}

/** One copy of the printed invoice (the copy label, when there is one, above the heading). */
function InvoiceCopy({ invoice, copy }: { invoice: ClientInvoiceDto; copy: string | null }) {
  const heading = clientInvoiceHeading(invoice.status);
  const { supplier, recipient } = invoice.party;
  return (
    <>
      {copy !== null ? <div className="text-right text-xs font-semibold tracking-wide">{copy}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <h3 className="text-base font-semibold">{heading.title}</h3>
          {heading.notice !== null ? <span className="text-xs text-(--muted-foreground)">{heading.notice}</span> : null}
          <span className="text-xs">Services · {monthLabel(invoice.periodStart)}</span>
        </div>
        <div className="flex flex-col text-right text-xs">
          <span className="font-mono">Invoice no. {invoice.invoiceNo ?? 'Unnumbered'}</span>
          <span>
            Date:{' '}
            {invoice.issuedAt === null ? (
              '—'
            ) : (
              <time dateTime={invoice.issuedAt}>{invoiceDateLabel(invoice.issuedAt)}</time>
            )}
          </span>
        </div>
      </div>

      <div className="grid gap-3 text-xs sm:grid-cols-2">
        <div className="flex flex-col" aria-label="Supplier">
          <span className="font-medium">Supplier</span>
          <span>{supplier.name}</span>
          {supplierAddressLines(invoice.party).map((line) => (
            <span key={line}>{line}</span>
          ))}
          <span>GSTIN: {supplier.gstin ?? '—'}</span>
          <span>State: {stateLabel(supplier.stateName, supplier.stateCode)}</span>
        </div>
        <div className="flex flex-col" aria-label="Recipient">
          <span className="font-medium">Recipient</span>
          <span>{recipient.legalName ?? recipient.name}</span>
          {recipientAddressLines(invoice.party).map((line) => (
            <span key={line}>{line}</span>
          ))}
          <span>GSTIN: {recipient.gstin ?? 'Unregistered'}</span>
          <span>State: {stateLabel(recipient.stateName, recipient.stateCode)}</span>
        </div>
      </div>
      <div className="flex flex-col text-xs">
        <span>Place of supply: {placeOfSupplyLabel(invoice.placeOfSupply)}</span>
        <span>Reverse charge: No</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-(--border) text-left">
              <th className="py-1 pr-2 font-medium">Description</th>
              <th className="py-1 pr-2 font-medium">SAC</th>
              <th className="data py-1 pr-2 text-right font-medium">Quantity</th>
              <th className="data py-1 pr-2 text-right font-medium">Rate</th>
              <th className="data py-1 pr-2 text-right font-medium">Taxable value</th>
              <th className="data py-1 pr-2 text-right font-medium">GST</th>
              <th className="data py-1 pr-2 text-right font-medium">CGST</th>
              <th className="data py-1 pr-2 text-right font-medium">SGST/UTGST</th>
              <th className="data py-1 text-right font-medium">IGST</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => {
              const rates = taxRateLabels(line.gstBps, line.supplyType);
              return (
                <tr key={`${line.segmentFrom}-${line.chargeCode}-${line.uom ?? ''}`} className="border-b border-(--border)">
                  <td className="py-1 pr-2">{lineDescription(line)}</td>
                  <td className="py-1 pr-2 font-mono">{line.sac}</td>
                  <td className="data py-1 pr-2 text-right">{lineQuantityLabel(line)}</td>
                  <td className="data py-1 pr-2 text-right">{lineRateLabel(line)}</td>
                  <td className="data py-1 pr-2 text-right">{lineTaxableLabel(line)}</td>
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

      <dl className="ml-auto grid grid-cols-2 gap-x-4 text-xs" aria-label="Invoice totals">
        <dt>Taxable value</dt>
        <dd className="data text-right">{formatRupees(invoice.totals.subtotal)}</dd>
        <dt>CGST</dt>
        <dd className="data text-right">{formatRupees(invoice.totals.cgst)}</dd>
        <dt>SGST/UTGST</dt>
        <dd className="data text-right">{formatRupees(invoice.totals.sgst)}</dd>
        <dt>IGST</dt>
        <dd className="data text-right">{formatRupees(invoice.totals.igst)}</dd>
        <dt>Invoice total</dt>
        <dd className="data text-right">{formatRupees(invoice.totals.subtotal + invoice.totals.tax)}</dd>
        <dt>Round off</dt>
        <dd className="data text-right">{formatRoundOff(invoice.totals.roundOff)}</dd>
        <dt className="font-medium">Payable</dt>
        <dd className="data text-right font-medium">{formatRupees(invoice.totals.payable)}</dd>
      </dl>
      <div className="text-xs">Amount in words: {amountInWords(invoice.totals.payable)}</div>

      <div className="mt-4 flex flex-col items-end text-xs">
        <span>For {supplier.name}</span>
        <span className="mt-8 border-t border-(--border) pt-1">Authorised signatory</span>
      </div>
    </>
  );
}

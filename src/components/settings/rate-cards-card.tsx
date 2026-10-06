'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import {
  fetchApiActivateRateCard,
  fetchApiCancelRateCard,
  fetchApiCreateRateCard,
  fetchApiDiscardRateCard,
  fetchApiReplaceRateCardLines,
} from '@/lib/api/client';
import type { ClientDto, RateCardDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import {
  CHARGE_BASIS,
  CHARGE_CODES,
  EMPTY_RATE_DRAFT,
  NOT_BILLED_BANNER,
  activatedOutcome,
  activationMinDate,
  basisLabel,
  canCancelRateCard,
  cancelConsequence,
  cancelledOutcome,
  chargeCell,
  chargeLabel,
  draftFieldsOf,
  formatIstDate,
  nextChangeSummary,
  notifyRateCardsChanged,
  parseRateDraft,
  pricedClients,
  rateCardReason,
  rateCardState,
  showNotBilledBanner,
  type ChargeCode,
  type RateDraftFields,
} from '@/lib/rate-cards';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useClients } from '@/lib/use-clients';
import { useRateCards } from '@/lib/use-rate-cards';

import { FeedbackBanner } from '@/components/feedback/banner';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { ReadFailure } from '@/components/outbound/shell';
import { ClientUsage } from '@/components/settings/client-usage';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const rowButtonClass =
  'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40';
const primaryButtonClass =
  'rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-40';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string };

/** The open editor/form, keyed by the client it belongs to (a client switch closes it). */
type Panel =
  | { kind: 'draft'; clientId: string; card: RateCardDto | null }
  | { kind: 'activate'; clientId: string; card: RateCardDto; min: string }
  | { kind: 'cancel'; clientId: string; card: RateCardDto }
  | { kind: 'discard'; clientId: string; card: RateCardDto };

/**
 * The rate cards card (story 21-3) — what each client brand is charged for
 * storage and handling, and from when. Every member reads a client's cards,
 * each with a state derived from its dates against the SERVER's `asOf`
 * (Draft / Scheduled / In force / Ended / Cancelled), the next scheduled
 * change, and "Not billed" for every charge a card does not price; a banner
 * warns when an active client has no card in force. An owner or accountant
 * (`rates.manage`) drafts, edits and discards drafts, activates a draft from
 * a date, and cancels a scheduled card. Below the cards, every member reads
 * the client's metered usage for a period (story 21-4, `ClientUsage`).
 *
 * Gating copies `sku-table.tsx`: the role is read through the session
 * subscription, so a `/me` role rewrite re-renders the affordances.
 */
export function RateCardsCard() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Rate cards</div>
        <div className="text-(--muted-foreground)">Sign in to see your clients’ rate cards.</div>
      </div>
    );
  }
  return <RateCardsCardSessioned />;
}

function RateCardsCardSessioned() {
  const clients = useClients();
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canManage = roleHasCapability(role, 'rates.manage');
  const priced = clients.state === 'ready' ? pricedClients(clients.data) : [];
  const [picked, setPicked] = useState<string | null>(null);
  // Keyed derivation (IMPLEMENTATION-GUIDE §1.5): a pick that no longer
  // names a priced client falls back to the first, in the same render.
  const client = priced.find((entry) => entry.id === picked) ?? priced[0] ?? null;

  return (
    <section aria-label="Rate cards" className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Rate cards</h2>
        <div className="text-(--muted-foreground)">
          What each client is charged for storage and handling, and from when. A card is frozen once activated —
          a rate change is a new card from a later date. Amounts exclude GST.
        </div>
      </div>

      {clients.state === 'failed' ? (
        <ReadFailure word="Clients unavailable" reason={clients.reason} onRetry={clients.reload} />
      ) : clients.state === 'loading' ? (
        <div className="text-(--muted-foreground)">Loading clients…</div>
      ) : client === null ? (
        <div className="text-(--muted-foreground)">Add a client above to price its storage and handling.</div>
      ) : (
        <>
          <label className="flex max-w-sm flex-col gap-1">
            <span className={labelClass}>Client</span>
            <select
              className={inputClass}
              value={client.id}
              onChange={(event) => setPicked(event.target.value)}
              aria-label="Client"
            >
              {priced.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.code} — {entry.name}
                  {entry.status === 'active' ? '' : ` (${entry.status})`}
                </option>
              ))}
            </select>
          </label>
          <ClientRateCards key={client.id} client={client} canManage={canManage} />
        </>
      )}
    </section>
  );
}

function ClientRateCards({ client, canManage }: { client: ClientDto; canManage: boolean }) {
  const view = useRateCards(client.id);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (view.state === 'failed') {
    return <ReadFailure word="Rate cards unavailable" reason={view.reason} onRetry={view.reload} />;
  }
  if (view.state === 'loading') {
    return <div className="text-(--muted-foreground)">Loading rate cards…</div>;
  }

  const { items, inForce } = view.data;
  const inForceId = inForce.rateCard?.id ?? null;
  const next = nextChangeSummary(items, inForce.rateCard, inForce.asOf);
  const open = panel !== null && panel.clientId === client.id ? panel : null;

  const done = (result: Outcome) => {
    setOutcome(result);
    setPanel(null);
    notifyRateCardsChanged();
  };

  const columns: DataTableColumn<RateCardDto>[] = [
    {
      key: 'state',
      header: 'State',
      render: (card) => {
        const state = rateCardState(card, inForceId, inForce.asOf);
        return state === 'In force' ? <strong className="text-(--accent)">{state}</strong> : state;
      },
    },
    { key: 'from', header: 'From', render: (card) => (card.effectiveFrom === null ? '—' : formatIstDate(card.effectiveFrom)) },
    { key: 'to', header: 'Until', render: (card) => (card.effectiveTo === null ? '—' : formatIstDate(card.effectiveTo)) },
    ...CHARGE_CODES.map(
      (code): DataTableColumn<RateCardDto> => ({
        key: code,
        header: `${chargeLabel(code)} (${basisLabel(CHARGE_BASIS[code])})`,
        numeric: true,
        render: (card) => chargeCell(card, code),
      }),
    ),
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            render: (card: RateCardDto) => {
              if (card.status === 'draft') {
                return (
                  <div className="flex gap-1">
                    <button type="button" className={rowButtonClass} onClick={() => { setOutcome(null); setPanel({ kind: 'draft', clientId: client.id, card }); }}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className={rowButtonClass}
                      onClick={() => {
                        setOutcome(null);
                        // The minimum is the SERVER's IST date (the loaded asOf).
                        setPanel({ kind: 'activate', clientId: client.id, card, min: activationMinDate(inForce.asOf, items) });
                      }}
                    >
                      Activate
                    </button>
                    <button type="button" className={rowButtonClass} onClick={() => { setOutcome(null); setPanel({ kind: 'discard', clientId: client.id, card }); }}>
                      Discard
                    </button>
                  </div>
                );
              }
              if (canCancelRateCard(card, inForce.asOf)) {
                return (
                  <button type="button" className={rowButtonClass} onClick={() => { setOutcome(null); setPanel({ kind: 'cancel', clientId: client.id, card }); }}>
                    Cancel
                  </button>
                );
              }
              return null;
            },
          } satisfies DataTableColumn<RateCardDto>,
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      {showNotBilledBanner(client, inForce.rateCard) ? <FeedbackBanner tone="warning" word="Not billed" reason={NOT_BILLED_BANNER} /> : null}
      {next !== null ? (
        <div aria-label="Next scheduled change" className="flex flex-col gap-0.5">
          <span className="font-medium">Next change</span>
          <ul className="list-disc pl-5">
            {next.changes.map((change) => (
              <li key={change} className="data">
                {change}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <DataTable<RateCardDto> columns={columns} rows={[...items]} emptyMessage="No rate cards yet — every charge is not billed." />

      {canManage && open === null ? (
        <div>
          <button type="button" className={rowButtonClass} onClick={() => { setOutcome(null); setPanel({ kind: 'draft', clientId: client.id, card: null }); }}>
            New draft
          </button>
        </div>
      ) : null}

      {canManage && open?.kind === 'draft' ? (
        <DraftEditor
          key={open.card?.id ?? 'new'}
          clientId={client.id}
          card={open.card}
          onClose={() => setPanel(null)}
          onSaved={(card) =>
            done({
              tone: 'accepted',
              word: open.card === null ? 'Draft created' : 'Draft saved',
              reason: card.lines.length === 0 ? 'It prices nothing yet — every charge is not billed.' : 'Activate it from a date to put its rates in force.',
            })
          }
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Not saved', reason })}
        />
      ) : null}

      {canManage && open?.kind === 'activate' ? (
        <ActivateForm
          key={open.card.id}
          card={open.card}
          min={open.min}
          onClose={() => setPanel(null)}
          onActivated={(card) => done({ tone: 'accepted', ...activatedOutcome(card) })}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Not activated', reason })}
        />
      ) : null}

      {canManage && (open?.kind === 'cancel' || open?.kind === 'discard') ? (
        <ConfirmRow
          key={`${open.kind}-${open.card.id}`}
          panel={open}
          consequence={cancelConsequence(open.card, items, inForceId, inForce.asOf)}
          onClose={() => setPanel(null)}
          onDone={(result) => done(result)}
          onRejected={(reason) =>
            setOutcome({ tone: 'rejected', word: open.kind === 'cancel' ? 'Not cancelled' : 'Not discarded', reason })
          }
        />
      ) : null}

      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}

      {/* Story 21-4 — what the client used, priced by these cards (an estimate). */}
      <ClientUsage client={client} cards={items} asOf={inForce.asOf} />
    </div>
  );
}

/**
 * Create or edit a draft — per-draft Idempotency-Key: minted on first
 * submit, reused across retries of the unchanged draft, cleared on any edit
 * and on success.
 */
function DraftEditor({
  clientId,
  card,
  onClose,
  onSaved,
  onRejected,
}: {
  clientId: string;
  card: RateCardDto | null;
  onClose: () => void;
  onSaved: (card: RateCardDto) => void;
  onRejected: (reason: string) => void;
}) {
  const [fields, setFields] = useState<RateDraftFields>(card === null ? EMPTY_RATE_DRAFT : draftFieldsOf(card));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseRateDraft(fields);
    if (parsed.lines === null) {
      setProblem(parsed.problem);
      return;
    }
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setProblem(null);
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const saved =
        card === null
          ? await fetchApiCreateRateCard(session.tenant.id, clientId, parsed.lines, keyRef.current)
          : await fetchApiReplaceRateCardLines(session.tenant.id, card.id, parsed.lines, keyRef.current);
      keyRef.current = null;
      onSaved(saved);
    } catch (error) {
      onRejected(rateCardReason(error, card === null ? 'drafted' : 'saved'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const edit = (code: ChargeCode, value: string) => {
    keyRef.current = null;
    setFields((current) => ({ ...current, [code]: value }));
  };

  return (
    <form onSubmit={submit} aria-label={card === null ? 'New rate card' : 'Edit rate card'} className="flex flex-col gap-2">
      <div className="text-(--muted-foreground)">
        Rupees per unit, excluding GST. Leave a charge blank if the client is not billed for it; ₹0 bills it at zero.
      </div>
      <div className="flex flex-wrap gap-2">
        {CHARGE_CODES.map((code) => (
          <label key={code} className="flex min-w-40 flex-1 flex-col gap-1">
            <span className={labelClass}>
              {chargeLabel(code)} <span className="font-normal text-(--muted-foreground)">₹ {basisLabel(CHARGE_BASIS[code])}</span>
            </span>
            <input
              className={inputClass}
              inputMode="decimal"
              value={fields[code]}
              aria-label={`${chargeLabel(code)} ₹ ${basisLabel(CHARGE_BASIS[code])}`}
              onChange={(event) => edit(code, event.target.value)}
              placeholder="Not billed"
            />
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? 'Saving…' : card === null ? 'Create draft' : 'Save draft'}
        </button>
        <button type="button" onClick={onClose} className={rowButtonClass}>
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

/** Activate a draft from a date — per-draft key (cleared when the date changes). */
function ActivateForm({
  card,
  min,
  onClose,
  onActivated,
  onRejected,
}: {
  card: RateCardDto;
  min: string;
  onClose: () => void;
  onActivated: (card: RateCardDto) => void;
  onRejected: (reason: string) => void;
}) {
  const [date, setDate] = useState(min);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || date === '') return;
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const activated = await fetchApiActivateRateCard(session.tenant.id, card.id, date, keyRef.current);
      keyRef.current = null;
      onActivated(activated);
    } catch (error) {
      onRejected(rateCardReason(error, 'activated'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Activate rate card" className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Takes effect from (IST)</span>
        <input
          type="date"
          className={inputClass}
          value={date}
          min={min}
          required
          onChange={(event) => {
            keyRef.current = null;
            setDate(event.target.value);
          }}
        />
      </label>
      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy ? 'Activating…' : 'Activate'}
      </button>
      <button type="button" onClick={onClose} className={rowButtonClass}>
        Close
      </button>
      <div className="w-full text-xs text-(--muted-foreground)">
        From IST midnight on that date. Once active the card cannot be edited.
      </div>
    </form>
  );
}

/** The cancel / discard confirmation — the key lives with the confirmation (per-confirmation). */
function ConfirmRow({
  panel,
  consequence,
  onClose,
  onDone,
  onRejected,
}: {
  panel: Extract<Panel, { kind: 'cancel' | 'discard' }>;
  /** What stays in force once the card is cancelled (worded by case). */
  consequence: string;
  onClose: () => void;
  onDone: (result: Outcome) => void;
  onRejected: (reason: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  // Per-confirmation: this component mounts per confirmation (keyed), so
  // the key minted on the first press is reused by every retry of it.
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const { card } = panel;

  async function confirm() {
    if (inFlight.current) return;
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      if (panel.kind === 'cancel') {
        const cancelled = await fetchApiCancelRateCard(session.tenant.id, card.id, keyRef.current);
        onDone({ tone: 'accepted', ...cancelledOutcome(cancelled, consequence) });
      } else {
        await fetchApiDiscardRateCard(session.tenant.id, card.id, keyRef.current);
        onDone({ tone: 'accepted', word: 'Draft discarded', reason: 'It is gone; nothing was ever billed from it.' });
      }
    } catch (error) {
      onRejected(rateCardReason(error, panel.kind === 'cancel' ? 'cancelled' : 'discarded'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const question =
    panel.kind === 'cancel'
      ? `Cancel the card from ${formatIstDate(card.effectiveFrom ?? '')}? ${consequence}`
      : 'Discard this draft?';
  return (
    <div role="group" aria-label={panel.kind === 'cancel' ? 'Confirm cancel' : 'Confirm discard'} className="flex flex-wrap items-center gap-2">
      <span>{question}</span>
      <button type="button" disabled={busy} onClick={confirm} className={primaryButtonClass}>
        {panel.kind === 'cancel' ? 'Cancel card' : 'Discard draft'}
      </button>
      <button type="button" onClick={onClose} className={rowButtonClass}>
        Keep
      </button>
    </div>
  );
}

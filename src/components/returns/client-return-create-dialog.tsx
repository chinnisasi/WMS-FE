'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { fetchApiCreateClientReturn } from '@/lib/api/client';
import type { AwaitingDispositionDto, ClientDto, ClientReturnDto, ReturnableToClientArmDto } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import { clientLabel } from '@/lib/clients';
import {
  RTC_ADDRESS_KINDS,
  RTC_ADDRESS_LABEL,
  RTC_DEFAULT_REASON,
  RTC_LIMITS,
  RTC_REASON_CODES,
  RTC_REASON_LABEL,
  RTC_RETURNABLE_TRUNCATED_HINT,
  buildRtcCreateBody,
  draftLine,
  emptyRtcDraft,
  keyForBody,
  rtcAddressBlock,
  rtcAddressMissing,
  rtcArmKey,
  rtcArmLabel,
  rtcReason,
  rtcRefusalStalesReturnable,
  rtcSelectable,
  type RtcAddressKind,
  type RtcDraft,
  type RtcDraftLine,
  type RtcReasonCode,
} from '@/lib/client-returns';
import { formatQuantity } from '@/lib/format-quantity';
import { SETTINGS_PAGE_TABS } from '@/lib/page-tabs';
import { RETURN_CONDITION_LABEL, awaitingCaptureText, dispositionQuantity } from '@/lib/returns';
import { ulid } from '@/lib/ulid';
import { useReturnableToClient } from '@/lib/use-client-returns';

import { FeedbackBanner } from '@/components/feedback/banner';
import { Field } from '@/components/shared/field';
import { SubmitButton } from '@/components/shared/submit-button';
import { ReadFailure, buttonClass, inputClass, selectClass } from '@/components/shared/surface';

/**
 * Story 4-7c (decision 14, A9, A12) — New return to client: one client's
 * goods in one warehouse going home to the brand. The client and warehouse
 * are fixed by the queue's selection (or picked here, when opened from the
 * To client tab); then which of the client's addresses (return by default —
 * an address the client lacks is disabled, no fallback), the client's
 * RETURNS lines awaiting a decision (the selected ones preselected at their
 * whole open quantity), its DAMAGED arms with what is still available after
 * every open RTV and RTC, a reason per line (the brand's instruction by
 * default) and a note.
 *
 * The caps are checked here so a refusal is rare (never relied on). The key
 * is per DRAFT, bound to the body it was minted for: a retry of the same
 * body replays, any change mints a new key, success clears it. A
 * `client-address-missing` refusal links to the client page.
 */

const tableInput = 'w-24 rounded-sm border border-(--input) bg-(--background) px-2 py-1 text-sm data text-right';
const tableSelect = 'rounded-sm border border-(--input) bg-(--background) px-2 py-1 text-xs max-w-48';
const legendClass = 'px-1 text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)';

function addressPreview(client: ClientDto, kind: RtcAddressKind): string | null {
  if (kind === 'return') {
    const a = client.returnAddress;
    return a === null ? null : [a.contactName, a.line1, a.line2, `${a.city}, ${a.state} — ${a.pincode}`].filter((part) => part !== null && part !== undefined && part !== '').join(', ');
  }
  const a = client.registeredAddress;
  return a === null ? null : [a.line1, a.line2, `${a.city} — ${a.pincode}`].filter((part) => part !== null && part !== undefined && part !== '').join(', ');
}

export function ClientReturnCreateDialog({
  warehouseId,
  warehouseLabel,
  clientId: fixedClientId,
  preselected,
  clients,
  tenantName,
  precisionOf = () => null,
  onCancel,
  onCreated,
}: {
  warehouseId: string;
  warehouseLabel: string;
  /** The client the queue's selection fixed; null — picked here. */
  clientId: string | null;
  /** The queue's selected lines (preselected at their whole open quantity). */
  preselected: readonly AwaitingDispositionDto[];
  clients: readonly ClientDto[] | null;
  tenantName: string | null;
  precisionOf?: (skuId: string) => number | null;
  onCancel: () => void;
  onCreated: (rtc: ClientReturnDto) => void;
}) {
  const [pickedClient, setPickedClient] = useState('');
  const clientId = fixedClientId ?? pickedClient;
  const client = clients?.find((entry) => entry.id === clientId) ?? null;
  const [draft, setDraft] = useState<RtcDraft>(() => emptyRtcDraft(preselected.filter(rtcSelectable)));
  const [problem, setProblem] = useState<{ text: string; lineId?: string; addressMissing?: RtcAddressKind } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const returnable = useReturnableToClient(warehouseId, clientId);
  const awaiting: readonly AwaitingDispositionDto[] = returnable.state === 'ready' ? returnable.data.awaiting : [];
  const damaged: readonly ReturnableToClientArmDto[] = returnable.state === 'ready' ? returnable.data.damaged : [];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inFlight.current) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function edit(next: (current: RtcDraft) => RtcDraft) {
    setProblem(null);
    setDraft(next);
  }

  function editLine(bucket: 'returns' | 'damaged', id: string, patch: Partial<RtcDraftLine>) {
    edit((current) => ({ ...current, [bucket]: { ...current[bucket], [id]: { ...draftLine(current[bucket], id), ...patch } } }));
  }

  // The address a client lacks is never the choice (decision 7 — no fallback): the other kind when only it exists.
  const chosenKind: RtcAddressKind =
    client !== null && rtcAddressBlock(client, draft.consigneeAddress) !== null && rtcAddressBlock(client, draft.consigneeAddress === 'return' ? 'registered' : 'return') === null
      ? draft.consigneeAddress === 'return'
        ? 'registered'
        : 'return'
      : draft.consigneeAddress;

  async function submit() {
    const session = readSession();
    if (session === null) {
      setProblem({ text: 'Your session expired — sign in again.' });
      return;
    }
    if (inFlight.current) return;
    if (clientId === '') {
      setProblem({ text: 'Pick the client the goods go back to.' });
      return;
    }
    const built = buildRtcCreateBody({ ...draft, consigneeAddress: chosenKind }, { awaiting, damaged }, { warehouseId, client, precisionOf });
    if (!built.ok) {
      setProblem({ text: built.problem, ...(built.lineId === undefined ? {} : { lineId: built.lineId }) });
      return;
    }
    keyRef.current = keyForBody(keyRef.current, JSON.stringify(built.body), ulid);
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const rtc = await fetchApiCreateClientReturn(session.tenant.id, built.body, keyRef.current.key);
      keyRef.current = null;
      onCreated(rtc);
    } catch (error) {
      const missing = rtcAddressMissing(error);
      setProblem({ text: rtcReason(error, 'create'), ...(missing === null ? {} : { addressMissing: missing.addressKind }) });
      if (rtcRefusalStalesReturnable(error)) returnable.reload();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const clientName = client === null ? 'this client' : clientLabel(client, tenantName);
  const missingPreselected = returnable.state === 'ready' ? preselected.filter((line) => !awaiting.some((entry) => entry.receiptLineId === line.receiptLineId)) : [];
  const rowMark = (id: string) => (problem?.lineId === id ? 'bg-(--destructive)/5' : '');

  return (
    <div role="dialog" aria-modal="false" aria-label="New return to client" className="flex flex-col gap-4 rounded-md border border-(--border) bg-(--card) p-4 text-sm">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">New return to {clientName}</h3>
        <p className="text-xs text-(--muted-foreground)">
          {warehouseLabel} — returned and damaged units of one client go back to the brand. Nothing moves until the return is picked on the handheld and dispatched here.
        </p>
      </div>
      <form
        aria-label="New return to client form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
          {fixedClientId === null && (
            <div className="max-w-sm">
              <Field label="Client" hint="A return to client carries one brand's goods.">
                {(control) => (
                  <select
                    {...control}
                    value={pickedClient}
                    onChange={(event) => {
                      setPickedClient(event.target.value);
                      setDraft(emptyRtcDraft([]));
                      setProblem(null);
                    }}
                    className={selectClass}
                  >
                    <option value="">Pick the client…</option>
                    {(clients ?? []).map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {clientLabel(entry, tenantName)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          )}

          {clientId !== '' && (
            <fieldset className="flex max-w-3xl flex-col gap-2 rounded-md border border-(--border) p-3">
              <legend className={legendClass}>Send to</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {RTC_ADDRESS_KINDS.map((kind) => {
                  const block = rtcAddressBlock(client, kind);
                  const preview = client === null ? null : addressPreview(client, kind);
                  return (
                    <label
                      key={kind}
                      className={`flex cursor-pointer flex-col gap-0.5 rounded-sm border p-2 text-xs ${
                        chosenKind === kind ? 'border-(--primary) bg-(--primary)/10' : 'border-(--border)'
                      } ${block !== null ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <input
                          type="radio"
                          name="rtc-consignee-address"
                          value={kind}
                          aria-label={RTC_ADDRESS_LABEL[kind]}
                          disabled={block !== null}
                          checked={chosenKind === kind}
                          onChange={() => edit((current) => ({ ...current, consigneeAddress: kind }))}
                        />
                        {RTC_ADDRESS_LABEL[kind]}
                      </span>
                      <span className="text-(--muted-foreground)">{block ?? preview ?? '—'}</span>
                    </label>
                  );
                })}
              </div>
              {client !== null && rtcAddressBlock(client, 'return') !== null && rtcAddressBlock(client, 'registered') !== null && (
                <div className="text-xs text-(--destructive)" data-testid="rtc-no-address">
                  {clientName} has no address on file —{' '}
                  <Link href={SETTINGS_PAGE_TABS.href('clients')} className="underline underline-offset-2">
                    add one on the client page
                  </Link>
                  .
                </div>
              )}
            </fieldset>
          )}

          {clientId !== '' && returnable.state === 'loading' && <div className="text-xs text-(--muted-foreground)">Loading what {clientName} can get back…</div>}
          {clientId !== '' && returnable.state === 'failed' && <ReadFailure word="Returnable units unavailable" reason={returnable.reason} onRetry={returnable.reload} />}
          {returnable.state === 'ready' && (
            <>
              {returnable.data.truncated && <div className="text-xs text-(--muted-foreground)">{RTC_RETURNABLE_TRUNCATED_HINT}</div>}
              {missingPreselected.length > 0 && (
                <FeedbackBanner
                  tone="warning"
                  word="Some selected lines moved"
                  reason={`${missingPreselected.map((line) => `${line.rmaCode} ${line.skuCode}`).join(', ')} no longer await a decision here — they are left out.`}
                />
              )}
              <fieldset className="flex min-w-0 flex-col gap-2 rounded-md border border-(--border) p-3">
                <legend className={legendClass}>From the Returns area</legend>
                {awaiting.length === 0 ? (
                  <div className="text-xs text-(--muted-foreground)">Nothing of {clientName} awaits a decision in {warehouseLabel}.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs" aria-label="Returned lines">
                      <thead className="bg-(--muted)">
                        <tr>
                          <th className="h-8 px-2 font-medium">Return</th>
                          <th className="px-2 font-medium">SKU</th>
                          <th className="px-2 font-medium">Received as</th>
                          <th className="px-2 font-medium">Batch · serial</th>
                          <th className="data px-2 text-right font-medium">Open</th>
                          <th className="data px-2 text-right font-medium">Send back</th>
                          <th className="px-2 font-medium">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {awaiting.filter(rtcSelectable).map((line) => {
                          const entry = draftLine(draft.returns, line.receiptLineId);
                          return (
                            <tr key={line.receiptLineId} className={`border-t border-(--border) ${rowMark(`r:${line.receiptLineId}`)}`} data-testid={`rtc-returns-row-${line.receiptLineId}`}>
                              <td className="px-2 py-1">
                                <span className="font-mono">{line.rmaCode}</span>
                                {line.orderReference !== null && <span className="text-(--muted-foreground)"> · {line.orderReference}</span>}
                              </td>
                              <td className="px-2 py-1">
                                <span className="font-mono">{line.skuCode}</span> <span className="text-(--muted-foreground)">{line.skuName}</span>
                              </td>
                              <td className="px-2 py-1">{RETURN_CONDITION_LABEL[line.condition] ?? line.condition}</td>
                              <td className="px-2 py-1 font-mono">{awaitingCaptureText(line)}</td>
                              <td className="data px-2 py-1 text-right">{dispositionQuantity(line.openQty, line.uom, precisionOf(line.skuId))}</td>
                              <td className="px-2 py-1 text-right">
                                <input
                                  aria-label={`Send back ${line.skuCode} on ${line.rmaCode}`}
                                  inputMode="decimal"
                                  value={entry.quantity}
                                  onChange={(event) => editLine('returns', line.receiptLineId, { quantity: event.target.value })}
                                  className={tableInput}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <select
                                  aria-label={`Reason for ${line.skuCode} on ${line.rmaCode}`}
                                  value={entry.reason}
                                  onChange={(event) => editLine('returns', line.receiptLineId, { reason: event.target.value as RtcReasonCode })}
                                  className={tableSelect}
                                >
                                  {RTC_REASON_CODES.map((code) => (
                                    <option key={code} value={code}>
                                      {RTC_REASON_LABEL[code]}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </fieldset>

              <fieldset className="flex min-w-0 flex-col gap-2 rounded-md border border-(--border) p-3">
                <legend className={legendClass}>From the Damaged area</legend>
                {damaged.length === 0 ? (
                  <div className="text-xs text-(--muted-foreground)">Nothing of {clientName} is in DAMAGED in {warehouseLabel} to send back.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs" aria-label="Damaged stock">
                      <thead className="bg-(--muted)">
                        <tr>
                          <th className="h-8 px-2 font-medium">SKU · batch</th>
                          <th className="data px-2 text-right font-medium">On hand</th>
                          <th className="px-2 font-medium">Claimed by</th>
                          <th className="data px-2 text-right font-medium">Available</th>
                          <th className="data px-2 text-right font-medium">Send back</th>
                          <th className="px-2 font-medium">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {damaged.map((arm) => {
                          const key = rtcArmKey(arm);
                          const entry = draftLine(draft.damaged, key);
                          return (
                            <tr key={key} className={`border-t border-(--border) ${rowMark(`d:${key}`)}`} data-testid={`rtc-damaged-row-${key}`}>
                              <td className="px-2 py-1">
                                <span className="font-mono">{rtcArmLabel(arm)}</span> <span className="text-(--muted-foreground)">{arm.skuName}</span>
                              </td>
                              <td className="data px-2 py-1 text-right">
                                {formatQuantity(arm.onHand, arm.uomPrecision)} {arm.uom}
                              </td>
                              <td className="px-2 py-1">{arm.claimedBy.length === 0 ? '—' : arm.claimedBy.join(', ')}</td>
                              <td className="data px-2 py-1 text-right">{formatQuantity(arm.available, arm.uomPrecision)}</td>
                              <td className="px-2 py-1 text-right">
                                <input
                                  aria-label={`Send back ${rtcArmLabel(arm)}`}
                                  inputMode="decimal"
                                  disabled={arm.available <= 0}
                                  value={entry.quantity}
                                  onChange={(event) => editLine('damaged', key, { quantity: event.target.value })}
                                  className={tableInput}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <select
                                  aria-label={`Reason for ${rtcArmLabel(arm)}`}
                                  value={entry.reason}
                                  onChange={(event) => editLine('damaged', key, { reason: event.target.value as RtcReasonCode })}
                                  className={tableSelect}
                                >
                                  {RTC_REASON_CODES.map((code) => (
                                    <option key={code} value={code}>
                                      {RTC_REASON_LABEL[code]}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </fieldset>
            </>
          )}

          <div className="max-w-3xl">
            <Field label="Note (optional)" hint={`Printed on the dispatch note; required when a reason is Other. Reasons default to ${RTC_REASON_LABEL[RTC_DEFAULT_REASON].toLowerCase()}.`}>
              {(control) => (
                <textarea
                  {...control}
                  rows={2}
                  maxLength={RTC_LIMITS.note}
                  value={draft.note}
                  onChange={(event) => edit((current) => ({ ...current, note: event.target.value }))}
                  className={inputClass}
                />
              )}
            </Field>
          </div>
        </fieldset>
        {problem !== null && (
          <div className="flex flex-col gap-1">
            <FeedbackBanner tone="rejected" word="Not created" reason={problem.text} />
            {problem.addressMissing !== undefined && (
              <Link href={SETTINGS_PAGE_TABS.href('clients')} className="text-xs text-(--primary) underline underline-offset-2" data-testid="rtc-client-page-link">
                Open the client page to add its {RTC_ADDRESS_LABEL[problem.addressMissing].toLowerCase()}
              </Link>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <SubmitButton busy={busy} label="Create return to client" busyLabel="Creating…" />
          <button type="button" disabled={busy} onClick={onCancel} className={buttonClass}>
            Discard
          </button>
        </div>
      </form>
    </div>
  );
}

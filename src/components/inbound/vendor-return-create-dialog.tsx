'use client';

import { useEffect, useRef, useState } from 'react';

import { ApiProblem, fetchApiCreateVendorReturn } from '@/lib/api/client';
import type { PartnerDto, ReturnableArmDto, VendorReturnDto } from '@/lib/api/generated';
import { defaultFormClientId } from '@/lib/active-client';
import { readSession } from '@/lib/auth';
import { clientLabel, showClients, workingClients } from '@/lib/clients';
import { formatQuantity, quantityInputLabel } from '@/lib/format-quantity';
import { formatIstDate, istDateOf } from '@/lib/rate-cards';
import { ulid } from '@/lib/ulid';
import type { ActiveClientState } from '@/lib/use-active-client';
import { readyClients } from '@/lib/use-clients';
import { usePoSkuOptions, usePoVendorOptions } from '@/lib/use-inbound';
import { useReturnableDamaged } from '@/lib/use-vendor-returns';
import {
  CONSIGNEE_ADDRESS_KINDS,
  CONSIGNEE_ADDRESS_LABEL,
  RETURNABLE_TRUNCATED_HINT,
  RTV_LIMITS,
  RTV_REASON_CODES,
  RTV_REASON_LABEL,
  SOURCE_KIND_LABEL,
  addressKindBlock,
  addressLines,
  armKey,
  armLabel,
  buildCreateBody,
  defaultAddressKind,
  draftArmTotal,
  draftLineFor,
  keyForBody,
  resolveLine,
  returnableEmptySentence,
  rtvReason,
  rtvRefusalStalesReturnable,
  rtvVendorRefusal,
  sourceFitsVendor,
  sourceOptionLabel,
  type ConsigneeAddressKind,
  type RtvDraft,
  type RtvDraftLine,
  type RtvReasonCode,
} from '@/lib/vendor-returns';

import { FeedbackBanner } from '@/components/feedback/banner';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/shared/field';
import { LoadingStatus, SkeletonBar } from '@/components/shared/skeleton';
import { SubmitButton } from '@/components/shared/submit-button';
import { ReadFailure, buttonClass, inputClass, rowButtonClass, selectClass } from '@/components/shared/surface';

/**
 * Story 2-8b — New return to vendor: one client's DAMAGED stock in the
 * active warehouse going back to one vendor, filled in order — the client
 * (hidden for a tenant with only its own; the active client by default,
 * pinned on the first edit), the vendor (an active vendor linked to that
 * client), which of its addresses (a kind the vendor lacks is disabled — A7,
 * no silent fallback), then the returnable table: per DAMAGED arm its batch,
 * expiry, on hand, claimed by and available, a quantity at the unit's
 * precision, the reason (defaulted from the source kind) and the optional
 * source GRN line (defaulted to one of the chosen vendor's — A5; another
 * vendor's PO source is disabled, and picking a PO source before a vendor
 * picks its vendor). "+ Source" splits an arm across GRN lines; the caps sum
 * per arm and per source across lines.
 *
 * The caps are checked here so a refusal is rare (never relied on). The key
 * is per DRAFT, bound to the body it was minted for: a retry of the same
 * body replays, any change mints a new key, success clears it. The parent
 * mounts it keyed by the warehouse, so a switch drops the draft and its key.
 */

const tableInput = 'w-24 rounded-sm border border-(--input) bg-(--background) px-2 py-1 text-sm data text-right';
const tableSelect = 'rounded-sm border border-(--input) bg-(--background) px-2 py-1 text-xs max-w-64';

const EMPTY_DRAFT: RtvDraft = { vendorId: '', consigneeAddress: '', note: '', lines: [] };

export function VendorReturnCreateDialog({
  warehouseId,
  warehouseLabel,
  active,
  tenantName,
  onCancel,
  onCreated,
}: {
  warehouseId: string;
  warehouseLabel: string;
  active: ActiveClientState;
  tenantName: string | null;
  onCancel: () => void;
  onCreated: (rtv: VendorReturnDto) => void;
}) {
  const clients = readyClients(active.clients);
  const working = workingClients(clients);
  const soleClient = clients !== null && !showClients(clients) ? (clients[0]?.id ?? '') : '';
  const [pickedClient, setPickedClient] = useState<string | null>(null);
  const fallbackClient = working !== null && working.length === 1 ? working[0]!.id : '';
  const formClient = pickedClient ?? defaultFormClientId(active, working, fallbackClient);
  const clientId = soleClient !== '' ? soleClient : formClient;
  const client = clients?.find((entry) => entry.id === clientId) ?? null;
  const clientName = client === null ? 'this client' : clientLabel(client, tenantName);

  const [draft, setDraft] = useState<RtvDraft>(EMPTY_DRAFT);
  const [skuFilter, setSkuFilter] = useState<string>('');
  const [problem, setProblem] = useState<{ text: string; lineId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);

  const vendors = usePoVendorOptions(clientId);
  const skus = usePoSkuOptions(clientId);
  const returnable = useReturnableDamaged(warehouseId, clientId, skuFilter === '' ? null : skuFilter);
  const arms: readonly ReturnableArmDto[] = returnable.state === 'ready' ? returnable.data.arms : [];
  const vendorList: readonly PartnerDto[] = vendors.state === 'ready' ? vendors.data : [];
  const vendor = vendorList.find((entry) => entry.id === draft.vendorId) ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inFlight.current) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function edited() {
    // The first edit pins the client the draft was started for (§1.12).
    if (soleClient === '' && formClient !== '') setPickedClient((picked) => picked ?? formClient);
    setProblem(null);
  }

  function edit(next: (current: RtvDraft) => RtvDraft) {
    edited();
    setDraft(next);
  }

  function pickClient(next: string) {
    setPickedClient(next);
    // Another client's vendors and stock never fit: the draft starts over.
    setDraft(EMPTY_DRAFT);
    setSkuFilter('');
    setProblem(null);
  }

  function pickVendor(vendorId: string, current: RtvDraft): RtvDraft {
    const next = vendorList.find((entry) => entry.id === vendorId) ?? null;
    const kind = current.consigneeAddress !== '' && addressKindBlock(next, current.consigneeAddress) === null ? current.consigneeAddress : defaultAddressKind(next);
    return { ...current, vendorId, consigneeAddress: kind };
  }

  /** The lines shown for an arm: its draft lines, else one untouched line. */
  function linesOf(arm: ReturnableArmDto): readonly RtvDraftLine[] {
    const own = draft.lines.filter((line) => line.armKey === armKey(arm));
    return own.length > 0 ? own : [draftLineFor(arm, 0)];
  }

  function editLine(line: RtvDraftLine, patch: Partial<RtvDraftLine>) {
    edit((current) => {
      const exists = current.lines.some((entry) => entry.id === line.id);
      return {
        ...current,
        lines: exists ? current.lines.map((entry) => (entry.id === line.id ? { ...entry, ...patch } : entry)) : [...current.lines, { ...line, ...patch }],
      };
    });
  }

  function pickSource(arm: ReturnableArmDto, line: RtvDraftLine, grnLineId: string) {
    const source = arm.sources.find((entry) => entry.grnLineId === grnLineId) ?? null;
    edit((current) => {
      // A PO source picked before the vendor picks its vendor (when it is offered).
      let next = current;
      if (current.vendorId === '' && source !== null && source.vendorId !== null && vendorList.some((entry) => entry.id === source.vendorId)) {
        next = pickVendor(source.vendorId, current);
      }
      const exists = next.lines.some((entry) => entry.id === line.id);
      const patched = { ...line, ...(exists ? next.lines.find((entry) => entry.id === line.id) : {}), source: grnLineId };
      return { ...next, lines: exists ? next.lines.map((entry) => (entry.id === line.id ? patched : entry)) : [...next.lines, patched] };
    });
  }

  function addSourceLine(arm: ReturnableArmDto) {
    edit((current) => {
      const own = current.lines.filter((line) => line.armKey === armKey(arm));
      const base = own.length > 0 ? [] : [draftLineFor(arm, 0)];
      const ordinal = own.length + base.length;
      return { ...current, lines: [...current.lines, ...base, { ...draftLineFor(arm, ordinal), source: '' }] };
    });
  }

  function removeLine(line: RtvDraftLine) {
    edit((current) => ({ ...current, lines: current.lines.filter((entry) => entry.id !== line.id) }));
  }

  async function submit() {
    const session = readSession();
    if (session === null) {
      setProblem({ text: 'Your session expired — sign in again.' });
      return;
    }
    if (inFlight.current) return;
    const built = buildCreateBody(draft, arms, { warehouseId, vendor });
    if (!built.ok) {
      setProblem({ text: built.problem, ...(built.lineId === undefined ? {} : { lineId: built.lineId }) });
      return;
    }
    keyRef.current = keyForBody(keyRef.current, JSON.stringify(built.body), ulid);
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const rtv = await fetchApiCreateVendorReturn(session.tenant.id, built.body, keyRef.current.key);
      keyRef.current = null;
      onCreated(rtv);
    } catch (error) {
      setProblem({ text: rtvReason(error, 'create') });
      if (rtvRefusalStalesReturnable(error)) returnable.reload();
      if (rtvVendorRefusal(error)) vendors.reload();
      if (error instanceof ApiProblem && error.code === 'client-departed') active.clients.reload();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const skuOptions = skus.state === 'ready' ? skus.data : [];

  return (
    <div role="dialog" aria-modal="false" aria-label="New return to vendor" className="flex flex-col gap-4 rounded-md border border-(--border) bg-(--card) p-4 text-sm">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">New return to vendor</h3>
        <p className="text-xs text-(--muted-foreground)">
          {warehouseLabel} — damaged units of one client go back to one vendor. Nothing moves until the return is picked on the handheld and dispatched here.
        </p>
      </div>
      <form
        aria-label="New return to vendor form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
          {active.clients.state === 'failed' ? (
            <FeedbackBanner tone="rejected" word="Clients not loaded" reason="Reload the page to create a return to vendor." />
          ) : (
            <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
              {soleClient === '' && (
                <Field label="Client" hint="A return carries one brand's goods.">
                  {(control) => (
                    <select {...control} value={formClient} onChange={(event) => pickClient(event.target.value)} className={selectClass}>
                      <option value="">Pick the client…</option>
                      {(working ?? []).map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {clientLabel(entry, tenantName)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
              {clientId !== '' && (
                <Field label="Vendor" hint={`An active vendor linked to ${clientName}.`}>
                  {(control) =>
                    vendors.state === 'loading' ? (
                      <span {...control} className="text-xs text-(--muted-foreground)">
                        Loading vendors…
                      </span>
                    ) : vendors.state === 'failed' ? (
                      <span {...control}>
                        <ReadFailure word="Vendors unavailable" reason={vendors.reason} onRetry={vendors.reload} />
                      </span>
                    ) : vendorList.length === 0 ? (
                      <span {...control} className="text-xs text-(--muted-foreground)">
                        No vendor is linked to {clientName} yet — link one under Settings → Partners.
                      </span>
                    ) : (
                      <select
                        {...control}
                        value={draft.vendorId}
                        onChange={(event) => edit((current) => pickVendor(event.target.value, current))}
                        className={selectClass}
                      >
                        <option value="">Pick the vendor…</option>
                        {vendorList.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.code} — {entry.name}
                          </option>
                        ))}
                      </select>
                    )
                  }
                </Field>
              )}
            </div>
          )}

          {vendor !== null && (
            <fieldset className="flex max-w-3xl flex-col gap-2 rounded-md border border-(--border) p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">Send to</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {CONSIGNEE_ADDRESS_KINDS.map((kind: ConsigneeAddressKind) => {
                  const block = addressKindBlock(vendor, kind);
                  const address = kind === 'dispatch' ? vendor.dispatchAddress : vendor.registeredAddress;
                  return (
                    <label
                      key={kind}
                      className={`flex cursor-pointer flex-col gap-0.5 rounded-sm border p-2 text-xs ${
                        draft.consigneeAddress === kind ? 'border-(--primary) bg-(--primary)/10' : 'border-(--border)'
                      } ${block !== null ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <input
                          type="radio"
                          name="consignee-address"
                          value={kind}
                          aria-label={CONSIGNEE_ADDRESS_LABEL[kind]}
                          disabled={block !== null}
                          checked={draft.consigneeAddress === kind}
                          onChange={() => edit((current) => ({ ...current, consigneeAddress: kind }))}
                        />
                        {CONSIGNEE_ADDRESS_LABEL[kind]}
                      </span>
                      {block !== null ? (
                        <span className="text-(--muted-foreground)">{block} — add one under Settings → Partners.</span>
                      ) : (
                        addressLines(address).map((line) => <span key={line}>{line}</span>)
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {clientId !== '' && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="flex flex-col">
                  <span className="font-medium">Damaged stock of {clientName}</span>
                  <span className="text-xs text-(--muted-foreground)">Leave a quantity blank to keep those units in DAMAGED.</span>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-(--muted-foreground)">SKU</span>
                  <select
                    aria-label="Filter by SKU"
                    value={skuFilter}
                    onChange={(event) => setSkuFilter(event.target.value)}
                    className={tableSelect}
                  >
                    <option value="">All SKUs</option>
                    {skuOptions.map((sku) => (
                      <option key={sku.id} value={sku.id}>
                        {sku.code} — {sku.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {returnable.state === 'ready' && returnable.data.truncated && (
                <FeedbackBanner tone="warning" word="Not every arm is shown" reason={RETURNABLE_TRUNCATED_HINT} />
              )}
              {returnable.state === 'loading' ? (
                <div className="flex flex-col gap-2" aria-busy="true">
                  <LoadingStatus label="Loading the damaged stock…" />
                  <SkeletonBar className="h-4 w-full" />
                  <SkeletonBar className="h-4 w-5/6" />
                  <SkeletonBar className="h-4 w-2/3" />
                </div>
              ) : returnable.state === 'failed' ? (
                <ReadFailure word="Damaged stock unavailable" reason={returnable.reason} onRetry={returnable.reload} />
              ) : arms.length === 0 ? (
                <EmptyState kind={skuFilter === '' ? 'first-use' : 'filtered'} action={skuFilter === '' ? undefined : (
                  <button type="button" className={rowButtonClass} onClick={() => setSkuFilter('')}>
                    Show all SKUs
                  </button>
                )}>
                  {skuFilter === '' ? returnableEmptySentence(clientName, warehouseLabel) : 'Nothing of that SKU is in DAMAGED to return.'}
                </EmptyState>
              ) : (
                <div className="overflow-x-auto rounded-md border border-(--border)">
                  <table className="w-full text-left text-xs" aria-label="Returnable damaged stock">
                    <thead className="bg-(--muted)">
                      <tr>
                        <th className="h-9 px-2 font-medium">SKU</th>
                        <th className="px-2 font-medium">Batch · expiry</th>
                        <th className="data px-2 text-right font-medium">On hand</th>
                        <th className="px-2 font-medium">Claimed by</th>
                        <th className="data px-2 text-right font-medium">Available</th>
                        <th className="data px-2 text-right font-medium">Return</th>
                        <th className="px-2 font-medium">Reason</th>
                        <th className="px-2 font-medium">Source</th>
                        <th className="px-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {arms.map((arm) => {
                        const lines = linesOf(arm);
                        const total = draftArmTotal(draft, armKey(arm));
                        const p = arm.uomPrecision;
                        return lines.map((line, index) => {
                          const resolved = resolveLine(line, arm, draft.vendorId);
                          const first = index === 0;
                          const marked = problem?.lineId === line.id;
                          const label = armLabel(arm);
                          return (
                            <tr
                              key={line.id}
                              data-testid={`returnable-${label}`}
                              className={`border-t border-(--border) align-top ${first ? '' : 'bg-(--muted)/40'}`}
                            >
                              <td className="px-2 py-1.5">
                                {first && (
                                  <div className="flex flex-col">
                                    <span className="font-mono">{arm.skuCode}</span>
                                    <span className="text-(--muted-foreground)">{arm.skuName}</span>
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                {first && (
                                  <div className="flex flex-col">
                                    <span className="font-mono">{arm.batchCode ?? '—'}</span>
                                    {arm.batchExpiry !== null && (
                                      <span className="text-(--muted-foreground)">exp {formatIstDate(istDateOf(arm.batchExpiry))}</span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="data px-2 py-1.5 text-right">{first ? `${formatQuantity(arm.onHand, p)} ${arm.uom}` : ''}</td>
                              <td className="px-2 py-1.5">{first ? (arm.claimedBy.length === 0 ? '—' : arm.claimedBy.join(', ')) : ''}</td>
                              <td className="data px-2 py-1.5 text-right">
                                {first && (
                                  <span className={total > arm.available ? 'font-medium text-(--destructive)' : ''}>{formatQuantity(arm.available, p)}</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step={p === 0 ? 1 : 10 ** -p}
                                  aria-label={`Return quantity ${label}${first ? '' : ` (line ${index + 1})`}`}
                                  aria-invalid={marked ? true : undefined}
                                  title={quantityInputLabel(p)}
                                  value={line.quantity}
                                  onChange={(event) => editLine(line, { quantity: event.target.value })}
                                  className={`${tableInput} ${marked ? 'border-(--destructive)' : ''}`}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <select
                                  aria-label={`Reason ${label}${first ? '' : ` (line ${index + 1})`}`}
                                  value={resolved.reason}
                                  onChange={(event) => editLine(line, { reason: event.target.value as RtvReasonCode })}
                                  className={tableSelect}
                                >
                                  {RTV_REASON_CODES.map((code) => (
                                    <option key={code} value={code}>
                                      {RTV_REASON_LABEL[code]}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-2 py-1.5">
                                {arm.sources.length === 0 ? (
                                  <span className="text-(--muted-foreground)">No GRN source</span>
                                ) : (
                                  <select
                                    aria-label={`Source ${label}${first ? '' : ` (line ${index + 1})`}`}
                                    value={resolved.source?.grnLineId ?? ''}
                                    onChange={(event) => pickSource(arm, line, event.target.value)}
                                    className={tableSelect}
                                  >
                                    <option value="">No source</option>
                                    {arm.sources.map((source) => {
                                      const fits = sourceFitsVendor(source, draft.vendorId);
                                      return (
                                        <option key={source.grnLineId} value={source.grnLineId} disabled={!fits}>
                                          {sourceOptionLabel(source, p)}
                                          {fits ? '' : ` — another vendor's PO`}
                                        </option>
                                      );
                                    })}
                                  </select>
                                )}
                                {first && resolved.source !== null && (
                                  <div className="mt-0.5 text-(--muted-foreground)">
                                    {SOURCE_KIND_LABEL[resolved.source.kind]}
                                    {resolved.source.reason === null ? '' : ` — ${resolved.source.reason}`}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                {first ? (
                                  arm.sources.length > 1 && (
                                    <button type="button" className={rowButtonClass} onClick={() => addSourceLine(arm)} aria-label={`Add a source line for ${label}`}>
                                      + Source
                                    </button>
                                  )
                                ) : (
                                  <button type="button" className={rowButtonClass} onClick={() => removeLine(line)} aria-label={`Remove line ${index + 1} of ${label}`}>
                                    Remove
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        });
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <Field label="Note (optional; required for Other)" hint="Printed on the dispatch note.">
            {(control) => (
              <textarea
                {...control}
                rows={2}
                maxLength={RTV_LIMITS.note}
                value={draft.note}
                onChange={(event) => {
                  const note = event.target.value;
                  edit((current) => ({ ...current, note }));
                }}
                className={`${inputClass} max-w-3xl`}
              />
            )}
          </Field>
        </fieldset>
        {problem !== null && <FeedbackBanner tone="rejected" word="Not created" reason={problem.text} />}
        <div className="flex flex-wrap gap-2">
          <SubmitButton busy={busy} label="Create return to vendor" busyLabel="Creating…" />
          <button type="button" disabled={busy} onClick={onCancel} className={buttonClass}>
            Discard
          </button>
        </div>
      </form>
    </div>
  );
}

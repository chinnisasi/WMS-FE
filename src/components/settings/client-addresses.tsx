'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { fetchApiUpdateClientAddresses } from '@/lib/api/client';
import type { ClientDto, UpdateClientAddressesDto } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import {
  BILLING_STATE_OPTIONS,
  addressesReason,
  parseRegisteredAddress,
  parseReturnAddress,
  registeredAddressLine,
  registeredFieldsOf,
  returnAddressLine,
  returnFieldsOf,
  type RegisteredAddressFields,
} from '@/lib/clients';
import type { DestinationFields } from '@/lib/outbound-orders';
import { ulid } from '@/lib/ulid';

import { StateSelect } from '@/components/address/state-select';
import { FeedbackBanner } from '@/components/feedback/banner';
import { ConfirmRow } from '@/components/settings/confirm-row';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const rowButtonClass =
  'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40';
const primaryButtonClass =
  'rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-40';

type Group = 'registered' | 'return';
type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

const GROUP_NAME: Readonly<Record<Group, string>> = { registered: 'Registered address', return: 'Return address' };

/**
 * Story 1-2a — a client's two address groups. Every staff session reads
 * them; an owner (`canManage`) edits. Registered uses the tax form's
 * state-code select (`BILLING_STATE_OPTIONS`); Return reuses the shipment
 * address's `StateSelect` and `parseDestinationFields` (labelled 'return
 * address'). Each group saves on its own (the other is omitted — unchanged on
 * the server) and has Clear behind a confirmation. Per-draft
 * Idempotency-Keys, cleared on any edit and on success.
 */
export function ClientAddressesPanel({
  client,
  canManage,
  onClose,
  onSaved,
  onDirtyChange,
}: {
  client: ClientDto;
  canManage: boolean;
  onClose: () => void;
  onSaved: (client: ClientDto) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [current, setCurrent] = useState<ClientDto>(client);
  const [registered, setRegistered] = useState<RegisteredAddressFields>(() => registeredFieldsOf(client));
  const [ret, setRet] = useState<DestinationFields>(() => returnFieldsOf(client));
  const [clearing, setClearing] = useState<Group | null>(null);
  const [problem, setProblem] = useState<{ group: Group; text: string } | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState<Group | null>(null);
  const keys = useRef<Record<Group, string | null>>({ registered: null, return: null });
  const inFlight = useRef(false);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const dirtyNow = (nextRegistered: RegisteredAddressFields, nextReturn: DestinationFields): boolean =>
    JSON.stringify(nextRegistered) !== JSON.stringify(registeredFieldsOf(current)) ||
    JSON.stringify(nextReturn) !== JSON.stringify(returnFieldsOf(current));

  const editRegistered = (next: RegisteredAddressFields) => {
    keys.current.registered = null;
    setRegistered(next);
    onDirtyChange(dirtyNow(next, ret));
  };
  const editReturn = (next: DestinationFields) => {
    keys.current.return = null;
    setRet(next);
    onDirtyChange(dirtyNow(registered, next));
  };

  const applied = (saved: ClientDto, word: string, reason: string) => {
    setCurrent(saved);
    setRegistered(registeredFieldsOf(saved));
    setRet(returnFieldsOf(saved));
    onDirtyChange(false);
    setOutcome({ tone: 'accepted', word, reason });
    onSaved(saved);
  };

  async function save(group: Group) {
    if (inFlight.current) return;
    let body: UpdateClientAddressesDto;
    if (group === 'registered') {
      const parsed = parseRegisteredAddress(registered);
      if (parsed.address === null) {
        setProblem({ group, text: parsed.problem });
        return;
      }
      body = { registered: parsed.address };
    } else {
      const parsed = parseReturnAddress(ret);
      if (parsed.address === null) {
        setProblem({ group, text: parsed.problem ?? 'Check the return address.' });
        return;
      }
      body = { return: parsed.address };
    }
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setProblem(null);
    setBusy(group);
    keys.current[group] ??= ulid();
    try {
      const saved = await fetchApiUpdateClientAddresses(session.tenant.id, current.id, body, keys.current[group]!);
      keys.current[group] = null;
      applied(saved, `${GROUP_NAME[group]} saved`, `${current.code}'s ${GROUP_NAME[group].toLowerCase()} is up to date.`);
    } catch (error) {
      setOutcome({ tone: 'rejected', word: `${GROUP_NAME[group]} not saved`, reason: addressesReason(error) });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-md border border-(--border) p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-medium outline-none">
          Addresses — {current.code}
        </h3>
        <button type="button" onClick={onClose} className={rowButtonClass}>
          Close
        </button>
      </div>

      {!canManage ? (
        <dl className="grid gap-1">
          <dt className={labelClass}>Registered address</dt>
          <dd>{registeredAddressLine(current)}</dd>
          <dt className={labelClass}>Return address</dt>
          <dd>{returnAddressLine(current)}</dd>
        </dl>
      ) : (
        <>
          <form
            aria-label={`Registered address of ${current.code}`}
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save('registered');
            }}
          >
            <div className="font-medium">Registered address</div>
            <div className="flex flex-wrap gap-2">
              <TextField label="Address line 1" value={registered.line1} onChange={(v: string) => editRegistered({ ...registered, line1: v })} maxLength={200} />
              <TextField label="Address line 2 (optional)" value={registered.line2} onChange={(v: string) => editRegistered({ ...registered, line2: v })} maxLength={200} />
            </div>
            <div className="flex flex-wrap gap-2">
              <TextField label="City" value={registered.city} onChange={(v: string) => editRegistered({ ...registered, city: v })} maxLength={100} />
              <label className="flex min-w-48 flex-1 flex-col gap-1">
                <span className={labelClass}>State</span>
                <select
                  className={inputClass}
                  value={registered.stateCode}
                  onChange={(event) => editRegistered({ ...registered, stateCode: event.target.value })}
                >
                  <option value="">—</option>
                  {BILLING_STATE_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <TextField label="Pincode" value={registered.pincode} onChange={(v: string) => editRegistered({ ...registered, pincode: v })} maxLength={6} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy !== null} className={primaryButtonClass}>
                {busy === 'registered' ? 'Saving…' : 'Save registered address'}
              </button>
              {current.registeredAddress !== null ? (
                <button type="button" disabled={busy !== null} className={rowButtonClass} onClick={() => setClearing('registered')}>
                  Clear
                </button>
              ) : null}
            </div>
            {problem?.group === 'registered' ? (
              <div role="alert" className="text-xs text-(--destructive)">
                {problem.text}
              </div>
            ) : null}
          </form>

          <form
            aria-label={`Return address of ${current.code}`}
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save('return');
            }}
          >
            <div className="font-medium">Return address</div>
            <div className="text-xs text-(--muted-foreground)">Where returned goods of {current.code} are sent back to.</div>
            <div className="flex flex-wrap gap-2">
              <TextField label="Contact name" value={ret.contactName} onChange={(v: string) => editReturn({ ...ret, contactName: v })} maxLength={120} />
              <TextField label="Phone" value={ret.phone} onChange={(v: string) => editReturn({ ...ret, phone: v })} maxLength={20} />
            </div>
            <div className="flex flex-wrap gap-2">
              <TextField label="Address line 1" value={ret.line1} onChange={(v: string) => editReturn({ ...ret, line1: v })} maxLength={200} />
              <TextField label="Address line 2 (optional)" value={ret.line2} onChange={(v: string) => editReturn({ ...ret, line2: v })} maxLength={200} />
            </div>
            <div className="flex flex-wrap gap-2">
              <TextField label="City" value={ret.city} onChange={(v: string) => editReturn({ ...ret, city: v })} maxLength={100} />
              <label className="flex min-w-48 flex-1 flex-col gap-1">
                <span className={labelClass}>State</span>
                <StateSelect className={inputClass} value={ret.state} onChange={(v) => editReturn({ ...ret, state: v })} />
              </label>
              <TextField label="Pincode" value={ret.pincode} onChange={(v: string) => editReturn({ ...ret, pincode: v })} maxLength={6} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy !== null} className={primaryButtonClass}>
                {busy === 'return' ? 'Saving…' : 'Save return address'}
              </button>
              {current.returnAddress !== null ? (
                <button type="button" disabled={busy !== null} className={rowButtonClass} onClick={() => setClearing('return')}>
                  Clear
                </button>
              ) : null}
            </div>
            {problem?.group === 'return' ? (
              <div role="alert" className="text-xs text-(--destructive)">
                {problem.text}
              </div>
            ) : null}
          </form>

          {clearing !== null ? (
            <ConfirmRow<ClientDto>
              key={`clear-${clearing}`}
              question={`Clear ${current.code}'s ${GROUP_NAME[clearing].toLowerCase()}?`}
              confirmLabel={`Clear ${GROUP_NAME[clearing].toLowerCase()}`}
              ariaLabel={`Confirm clear ${GROUP_NAME[clearing].toLowerCase()}`}
              run={(key, tenantId) =>
                fetchApiUpdateClientAddresses(tenantId, current.id, clearing === 'registered' ? { registered: null } : { return: null }, key)
              }
              reason={addressesReason}
              onClose={() => setClearing(null)}
              onDone={(saved) => {
                const group = clearing;
                setClearing(null);
                applied(saved, `${GROUP_NAME[group]} cleared`, `${saved.code} has no ${GROUP_NAME[group].toLowerCase()} now.`);
              }}
              onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Not cleared', reason })}
            />
          ) : null}
        </>
      )}

      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
}) {
  return (
    <label className="flex min-w-48 flex-1 flex-col gap-1">
      <span className={labelClass}>{label}</span>
      <input className={inputClass} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

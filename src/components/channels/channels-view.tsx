'use client';

import Link from 'next/link';
import { useRef, useState, useSyncExternalStore } from 'react';

import {
  ApiProblem,
  fetchApiConnectChannel,
  fetchApiDisconnectChannel,
  fetchApiRetryChannelConnection,
  fetchApiRotateChannelCredentials,
  fetchApiSetChannelBuffers,
  fetchApiUpdateChannelConnectionConfig,
} from '@/lib/api/client';
import type {
  ChannelBufferVerdictDto,
  ChannelConnectionListEntryDto,
  ChannelConnectionResponse,
  SkuResponse,
  WarehouseResponse,
} from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import {
  BACKORDER_POLICIES,
  BACKORDER_POLICY_LABEL,
  BREAKER_LABEL,
  CHANNEL_CREDENTIAL_FIELDS,
  CHANNEL_MANAGE_CAPABILITY,
  CHANNEL_PROVIDER_LABEL,
  CHANNEL_PROVIDERS,
  backorderPolicySavedSentence,
  buffersSavedSentence,
  connectAcceptedSentence,
  connectReason,
  credentialsRotatedSentence,
  disconnectAcceptedSentence,
  disconnectReason,
  entryBuckets,
  lagLabel,
  notifyChannelsChanged,
  retryAcceptedSentence,
  retryConnectionReason,
  rotateCredentialsReason,
  setBuffersReason,
  updateConnectionConfigReason,
  type BackorderPolicy,
  type ChannelCredentialFieldSpec,
  type ChannelProvider,
} from '@/lib/channels';
import { milliToBase, parseMilliInput } from '@/lib/replenishment';
import { quantityLabel } from '@/lib/format-quantity';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useSkuMap } from '@/lib/use-inbound';
import { useOutboundWarehouses } from '@/lib/use-outbound-orders';
import { useChannelConnections } from '@/lib/use-channels';

import { FeedbackBanner } from '@/components/feedback/banner';
import {
  ReadFailure,
  Section,
  inputClass,
  primaryClass,
  rowButtonClass,
  selectClass,
} from '@/components/outbound/shell';

/**
 * The Channels surface (story 7-1): the tenant's sales-channel connections
 * (connect / rotate / disconnect), each one's standing-buffer editor
 * (warehouse + SKU rows, MILLI wire), and the sync health read inline —
 * amber for `degraded` (the lag and the last effort named on the card, per
 * UX-DR19), destructive for `error` with the Retry affordance.
 *
 * Everything on this surface is ledger-backed through the backend: a buffer
 * IS a standing reservation row (AD-13), a connect seals its credential
 * (the response — and this UI — never carries material), a disconnect is a
 * hard delete that releases the buffers through the reservation core. The
 * retry re-appends the availability snapshot through the outbox and
 * half-opens the breaker; it appends, it never force-publishes.
 *
 * The list read is member-open server-side; the surface's entry (the nav
 * item and these mutating affordances) consults `channel.manage` — owner +
 * Ops Manager. An operator reaching a direct URL renders the cards
 * read-only (hide surfaces, never "blocked" screens; the backend's
 * per-command DB role read stays the authority).
 */

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

export function ChannelsView() {
  // `null` = unknown (server render) → render nothing, no hydration mismatch.
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <Section title="Channels">
        <div className="text-(--muted-foreground)">
          Sign in to view channel connections —{' '}
          <Link
            href="/login"
            className="text-(--primary) underline underline-offset-2"
          >
            go to sign in
          </Link>
          .
        </div>
      </Section>
    );
  }
  return <ChannelsSessioned />;
}

function ChannelsSessioned() {
  const warehouses = useOutboundWarehouses();
  const tenantId = warehouses.state === 'ready' ? warehouses.data.tenantId : null;
  // Story 1.5 gating pattern: subscribed (not a bare readSession() at render)
  // so a /me bootstrap role rewrite re-renders the affordances.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canManage = roleHasCapability(role, CHANNEL_MANAGE_CAPABILITY);

  const connections = useChannelConnections();

  if (warehouses.state === 'failed') {
    return (
      <Section title="Channels">
        <ReadFailure
          word="Context unavailable"
          reason={warehouses.reason}
          onRetry={warehouses.reload}
        />
      </Section>
    );
  }
  if (tenantId === null) {
    return (
      <Section title="Channels">
        <div className="text-(--muted-foreground)">Loading…</div>
      </Section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ConnectionList
        tenantId={tenantId}
        warehouses={warehouses.state === 'ready' ? warehouses.data.items : []}
        canManage={canManage}
        connections={connections}
      />
    </div>
  );
}

function ConnectionList({
  tenantId,
  warehouses,
  canManage,
  connections,
}: {
  tenantId: string;
  warehouses: readonly WarehouseResponse[];
  canManage: boolean;
  connections: ReturnType<typeof useChannelConnections>;
}) {
  const skus = useSkuMap();
  const [outcome, setOutcome] = useState<Outcome>(null);
  // Which card's connect/rotate sub-form is open, keyed by connection id
  // ('connect' is the connect card's key).
  const [rotateFor, setRotateFor] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  function onMutated(verdicts?: readonly ChannelBufferVerdictDto[]) {
    if (verdicts !== undefined) {
      setOutcome({
        tone: 'accepted',
        word: 'Buffers saved',
        reason: buffersSavedSentence(verdicts),
      });
    }
    notifyChannelsChanged();
  }

  return (
    <Section title="Channel connections">
      <div className="-mt-2 pr-1 text-xs text-(--muted-foreground)">
        A sales channel connected here reads the warehouse pool&apos;s available quantity —
        every standing buffer carves stock off that share for this channel (a ledger-backed
        standing reservation) and off the published quantity of every other channel.
      </div>
      {connections.state === 'failed' ? (
        <ReadFailure
          word="Connections unavailable"
          reason={connections.reason}
          onRetry={connections.reload}
        />
      ) : connections.state === 'loading' ? (
        <div className="p-3 text-(--muted-foreground)">Loading…</div>
      ) : connections.data.length === 0 ? (
        <div className="rounded-md border border-(--border) p-3 text-(--muted-foreground)">
          {canManage
            ? 'No sales channel is connected yet — connect one below.'
            : 'No sales channel is connected yet.'}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {connections.data.map((entry) => (
            <ConnectionCard
              key={entry.id}
              tenantId={tenantId}
              entry={entry}
              warehouses={warehouses}
              skus={skus}
              canManage={canManage}
              rotateOpen={rotateFor === entry.id}
              onToggleRotate={() =>
                setRotateFor((prev) => (prev === entry.id ? null : entry.id))
              }
              onOutcome={setOutcome}
              onMutated={onMutated}
            />
          ))}
        </div>
      )}
      {canManage && (
        <ConnectCard
          tenantId={tenantId}
          connected={connections.state === 'ready' ? connections.data : []}
          open={connectOpen}
          onToggle={() => setConnectOpen((prev) => !prev)}
          onOutcome={setOutcome}
          onMutated={() => onMutated()}
        />
      )}
      {outcome !== null && (
        <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      )}
    </Section>
  );
}

/**
 * The health chip's classes — the surface's inline severity, never colour
 * alone (the word rides the chip). `degraded` is the warning pair (amber),
 * `error` the destructive pair (red); `ok` stays the neutral border.
 */
function healthChipClass(health: ChannelConnectionListEntryDto['health']): string {
  if (health === 'degraded') {
    return 'rounded-full border border-(--warning) bg-(--warning)/10 px-2 py-0.5 text-xs font-medium text-(--foreground)';
  }
  if (health === 'error') {
    return 'rounded-full border border-(--destructive) bg-(--destructive)/10 px-2 py-0.5 text-xs font-medium text-(--foreground)';
  }
  return 'rounded-full border border-(--border) px-2 py-0.5 text-xs';
}

function ConnectionCard({
  tenantId,
  entry,
  warehouses,
  skus,
  canManage,
  rotateOpen,
  onToggleRotate,
  onOutcome,
  onMutated,
}: {
  tenantId: string;
  entry: ChannelConnectionListEntryDto;
  warehouses: readonly WarehouseResponse[];
  skus: Readonly<Record<string, SkuResponse>> | null;
  canManage: boolean;
  rotateOpen: boolean;
  onToggleRotate: () => void;
  onOutcome: (outcome: Exclude<Outcome, null>) => void;
  onMutated: (verdicts?: readonly ChannelBufferVerdictDto[]) => void;
}) {
  // The synchronous re-entry guard (the variance-queue pattern).
  const busy = useRef(false);
  const [disconnectConfirming, setDisconnectConfirming] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  async function run(what: 'disconnect' | 'retry', action: () => Promise<unknown>): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setWorking(what);
    setDisconnectConfirming(false);
    try {
      const response = (await action()) as ChannelConnectionResponse | void;
      if (what === 'disconnect') {
        onOutcome({ tone: 'accepted', word: 'Channel disconnected', reason: disconnectAcceptedSentence() });
      } else {
        onOutcome({
          tone: 'accepted',
          word: 'Sync retried',
          reason: retryAcceptedSentence(response as ChannelConnectionResponse),
        });
      }
      onMutated();
    } catch (error) {
      onOutcome({
        tone: 'rejected',
        word: what === 'disconnect' ? 'Not disconnected' : 'Not retried',
        reason:
          what === 'disconnect' ? disconnectReason(error) : retryConnectionReason(error),
      });
    } finally {
      busy.current = false;
      setWorking(null);
    }
  }

  const lag = lagLabel(entry.syncLagMs);
  const isDegraded = entry.health === 'degraded';
  const isError = entry.health === 'error';

  return (
    <article
      className={
        isDegraded
          ? 'flex flex-col gap-2 rounded-sm border border-(--warning) bg-(--warning)/10 p-3'
          : isError
            ? 'flex flex-col gap-2 rounded-sm border border-(--destructive) bg-(--destructive)/10 p-3'
            : 'flex flex-col gap-2 rounded-sm border border-(--border) p-3'
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{entry.providerName}</span>
        <span className="font-mono text-xs text-(--muted-foreground)">{entry.provider}</span>
        <span className={healthChipClass(entry.health)}>{entry.health}</span>
        {isDegraded && lag !== null && (
          <span className="text-xs text-(--foreground)">{lag}</span>
        )}
        <span className="text-xs text-(--muted-foreground)">
          {BREAKER_LABEL[entry.breakerState]}
        </span>
      </div>
      {isDegraded && (
        <div className="text-xs text-(--foreground)">
          Sync is behind — last attempt{' '}
          {entry.lastAttemptAt === null ? 'none recorded' : (
            <time dateTime={entry.lastAttemptAt}>{new Date(entry.lastAttemptAt).toLocaleString()}</time>
          )}
          {entry.lastError !== null && <> · the last error read: {entry.lastError}</>}
        </div>
      )}
      {isError && (
        <div className="text-xs text-(--foreground)">
          The sync stopped{entry.breakerState === 'open' ? ' — the breaker is open after repeated delivery failures' : ''}.
          {entry.lastError !== null && <> The last error read: {entry.lastError}.</>}
          {canManage && (
            <div className="mt-1">
              <button
                type="button"
                disabled={working !== null}
                onClick={() => void run('retry', () => fetchApiRetryChannelConnection(tenantId, entry.id, ulid()))}
                className={rowButtonClass}
              >
                {working === 'retry' ? 'Retrying…' : 'Retry sync'}
              </button>
            </div>
          )}
        </div>
      )}
      {!isDegraded && !isError && (
        <div className="text-xs text-(--muted-foreground)">
          Last synced{' '}
          {entry.lastSyncedAt === null ? 'never' : (
            <time dateTime={entry.lastSyncedAt}>{new Date(entry.lastSyncedAt).toLocaleString()}</time>
          )}
          .
        </div>
      )}
      <div className="data flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        <span>credential v{entry.credentialVersion}</span>
        <span>mapped SKUs {entry.mappingCount}</span>
        <span>
          standing buffers {entryBuckets(entry).length}
          {entryBuckets(entry).length === 0 ? '' : ' (see editor below)'}
        </span>
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <BackorderPolicySelect
            tenantId={tenantId}
            entry={entry}
            working={working}
            setWorking={setWorking}
            onOutcome={onOutcome}
            onMutated={onMutated}
          />
          <div className="flex gap-1">
            <button type="button" onClick={onToggleRotate} className={rowButtonClass}>
              {rotateOpen ? 'Hide rotate form' : 'Rotate credential'}
            </button>
            {disconnectConfirming ? (
              <>
                <button
                  type="button"
                  disabled={working !== null}
                  onClick={() =>
                    void run('disconnect', () =>
                      fetchApiDisconnectChannel(tenantId, entry.id, ulid()),
                    )
                  }
                  className="rounded-sm border border-(--destructive) bg-(--destructive)/10 px-2 py-1 text-xs font-medium text-(--foreground) hover:opacity-90 disabled:opacity-60"
                >
                  {working === 'disconnect' ? 'Disconnecting…' : 'Confirm disconnect'}
                </button>
                <button
                  type="button"
                  disabled={working !== null}
                  onClick={() => setDisconnectConfirming(false)}
                  className={rowButtonClass}
                >
                  Keep connected
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={working !== null}
                onClick={() => setDisconnectConfirming(true)}
                className={rowButtonClass}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      )}
      {canManage && rotateOpen && (
        <RotateCredentialForm
          tenantId={tenantId}
          entry={entry}
          working={working}
          setWorking={setWorking}
          onOutcome={onOutcome}
          onMutated={onMutated}
        />
      )}
      {canManage && (
        <BufferEditor
          tenantId={tenantId}
          entry={entry}
          warehouses={warehouses}
          skus={skus}
          working={working}
          setWorking={setWorking}
          onOutcome={onOutcome}
          onMutated={onMutated}
        />
      )}
      {!canManage && entryBuckets(entry).length > 0 && (
        <BufferBucketsReadOnly entry={entry} skus={skus} />
      )}
    </article>
  );
}

/** The backorder-policy select — a PUT per change, the card's own words. */
function BackorderPolicySelect({
  tenantId,
  entry,
  working,
  setWorking,
  onOutcome,
  onMutated,
}: {
  tenantId: string;
  entry: ChannelConnectionListEntryDto;
  working: string | null;
  setWorking: (value: string | null) => void;
  onOutcome: (outcome: Exclude<Outcome, null>) => void;
  onMutated: () => void;
}) {
  const inFlight = working !== null;
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-(--muted-foreground)">Backorder policy</span>
      <select
        className={`${selectClass} w-auto py-1 text-xs`}
        value={entry.backorderPolicy}
        disabled={inFlight}
        onChange={(e) => {
          const policy = e.target.value as BackorderPolicy;
          if (policy === entry.backorderPolicy) return;
          void (async () => {
            if (working !== null) return;
            setWorking('policy');
            try {
              await fetchApiUpdateChannelConnectionConfig(
                tenantId,
                entry.id,
                { backorderPolicy: policy },
                ulid(),
              );
              onOutcome({
                tone: 'accepted',
                word: 'Backorder policy saved',
                reason: backorderPolicySavedSentence(policy),
              });
              onMutated();
            } catch (error) {
              onOutcome({
                tone: 'rejected',
                word: 'Not saved',
                reason: updateConnectionConfigReason(error),
              });
            } finally {
              setWorking(null);
            }
          })();
        }}
        aria-label={`Backorder policy for ${entry.providerName}`}
      >
        {BACKORDER_POLICIES.map((policy) => (
          <option key={policy} value={policy}>
            {BACKORDER_POLICY_LABEL[policy]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The rotate form: the frozen provider's fields, blank — nothing prefilled. */
function RotateCredentialForm({
  tenantId,
  entry,
  working,
  setWorking,
  onOutcome,
  onMutated,
}: {
  tenantId: string;
  entry: ChannelConnectionListEntryDto;
  working: string | null;
  setWorking: (value: string | null) => void;
  onOutcome: (outcome: Exclude<Outcome, null>) => void;
  onMutated: () => void;
}) {
  const fields = fieldSpecs(entry.provider as ChannelProvider);
  const [values, setValues] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  // This form's own synchronous re-entry guard.
  const busy = useRef(false);

  const missing = fields.filter((f) => f.required && (values[f.name] ?? '').trim() === '');
  const inFlight = working !== null;

  function submit() {
    if (busy.current || missing.length > 0) {
      setLocalError('Fill every required credential field — nothing was sent.');
      return;
    }
    setLocalError(null);
    void (async () => {
      if (busy.current) return;
      busy.current = true;
      setWorking('rotate');
      try {
        await fetchApiRotateChannelCredentials(
          tenantId,
          entry.id,
          { credentials: values },
          ulid(),
        );
        onOutcome({ tone: 'accepted', word: 'Credential rotated', reason: credentialsRotatedSentence() });
        setValues({});
        onMutated();
      } catch (error) {
        onOutcome({
          tone: 'rejected',
          word: 'Not rotated',
          reason: rotateCredentialsReason(error),
        });
      } finally {
        busy.current = false;
        setWorking(null);
      }
    })();
  }

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--background) p-2 text-xs">
      <div className="text-(--muted-foreground)">
        Paste the replaced credential material — it is sealed under the tenant key and never
        read back. The version bumps on save.
      </div>
      {fields.map((field) => (
        <CredentialFieldInput
          key={field.name}
          field={field}
          provider={entry.providerName}
          value={values[field.name] ?? ''}
          onChange={(next) => setValues((prev) => ({ ...prev, [field.name]: next }))}
        />
      ))}
      {localError !== null && <div className="text-(--destructive)">{localError}</div>}
      <div className="flex justify-end">
        <button type="button" disabled={inFlight} onClick={submit} className={primaryClass}>
          {working === 'rotate' ? 'Rotating…' : 'Rotate credential'}
        </button>
      </div>
    </div>
  );
}

/** The connect card: provider select + its frozen field declarations. */
function ConnectCard({
  tenantId,
  connected,
  open,
  onToggle,
  onOutcome,
  onMutated,
}: {
  tenantId: string;
  connected: readonly ChannelConnectionListEntryDto[];
  open: boolean;
  onToggle: () => void;
  onOutcome: (outcome: Exclude<Outcome, null>) => void;
  onMutated: () => void;
}) {
  const [provider, setProvider] = useState<ChannelProvider | ''>('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  // The synchronous re-entry guard (the variance-queue pattern).
  const busy = useRef(false);
  const [inFlight, setInFlight] = useState(false);

  const taken = (code: string) => connected.some((c) => c.provider === code);
  const fields = provider === '' ? [] : fieldSpecs(provider);
  const missing =
    provider === ''
      ? []
      : (fieldSpecs(provider) as readonly ChannelCredentialFieldSpec[]).filter(
          (f) => f.required && (values[f.name] ?? '').trim() === '',
        );

  function submit() {
    if (busy.current || provider === '') return;
    if (missing.length > 0) {
      setLocalError('Fill every required credential field — nothing was sent.');
      return;
    }
    setLocalError(null);
    void (async () => {
      if (busy.current) return;
      busy.current = true;
      setInFlight(true);
      try {
        const response = await fetchApiConnectChannel(
          tenantId,
          { provider, credentials: values },
          ulid(),
        );
        onOutcome({ tone: 'accepted', word: `${response.providerName} connected`, reason: connectAcceptedSentence(response) });
        setValues({});
        setProvider('');
        onMutated();
      } catch (error) {
        onOutcome({
          tone: 'rejected',
          word: 'Not connected',
          reason: connectReason(error),
        });
        // A 409 means the provider got connected between the read and the
        // click — the reload IS that refusal's recovery (the row the server
        // says now exists renders).
        if (error instanceof ApiProblem && error.status === 409) onMutated();
      } finally {
        busy.current = false;
        setInFlight(false);
      }
    })();
  }

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">Connect a channel</div>
        <button type="button" onClick={onToggle} className={rowButtonClass}>
          {open ? 'Hide connect form' : 'Connect'}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-2 text-xs">
          <label className="flex items-center gap-2">
            <span className="text-(--muted-foreground)">Provider</span>
            <select
              className={`${selectClass} w-auto py-1 text-xs`}
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as ChannelProvider | '');
                setValues({});
                setLocalError(null);
              }}
              aria-label="Channel provider"
            >
              <option value="">Choose a provider…</option>
              {CHANNEL_PROVIDERS.map((code) => (
                <option key={code} value={code} disabled={taken(code)}>
                  {CHANNEL_PROVIDER_LABEL[code]}
                  {taken(code) ? ' — already connected' : ''}
                </option>
              ))}
            </select>
          </label>
          {fields.map((field) => (
            <CredentialFieldInput
              key={(field as ChannelCredentialFieldSpec).name}
              field={field as ChannelCredentialFieldSpec}
              provider={provider !== '' ? CHANNEL_PROVIDER_LABEL[provider as ChannelProvider] : ''}
              value={values[(field as ChannelCredentialFieldSpec).name] ?? ''}
              onChange={(next) =>
                setValues((prev) => ({ ...prev, [(field as ChannelCredentialFieldSpec).name]: next }))
              }
            />
          ))}
          {localError !== null && <div className="text-(--destructive)">{localError}</div>}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={provider === '' || inFlight}
              onClick={submit}
              className={primaryClass}
            >
              {inFlight ? 'Connecting…' : 'Connect channel'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One credential input: password-typed (it is secret material — no browser
 * reveals it), the field's NAME is its label's anchor. The placeholder is
 * the field's own description verb, never an example secret.
 */
function CredentialFieldInput({
  field,
  provider,
  value,
  onChange,
}: {
  field: ChannelCredentialFieldSpec;
  provider: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-(--muted-foreground)">
        {field.label}
        {field.required ? ' — required' : ' — optional'}
      </span>
      <input
        type="password"
        className={`${inputClass} py-1 text-xs`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${field.label} for ${provider}`}
        autoComplete="off"
      />
      <span className="text-[10px] text-(--muted-foreground)">{field.description}</span>
    </label>
  );
}

function fieldSpecs(provider: ChannelProvider): readonly ChannelCredentialFieldSpec[] {
  return CHANNEL_CREDENTIAL_FIELDS[provider];
}

/* ── the standing-buffer editor ────────────────────────────────────────── */

/**
 * One buffer editor row's state — a (warehouse, SKU) pair and a raw decimal
 * input. A row whose pair already stands in `entry` prefills its figure;
 * a fresh row starts empty (a blank stays blank — nothing inferred).
 */
interface BufferRowState {
  readonly key: string;
  warehouseId: string;
  skuId: string;
  raw: string;
}

/**
 * One connection's standing-buffer editor (the flash-sale knob, FQ-2's
 * frozen granularity): the existing buckets render as rows, each editable
 * or removable (a removal saves 0 for that scope — 0 clears the buffer),
 * plus an Add row for a scope that does not stand yet. The save sends
 * every row as an item and renders the per-item verdicts verbatim — a
 * `refused` item (the pool cannot grant it) leaves its OLD buffer standing
 * and says so with the server's own words.
 */
function BufferEditor({
  tenantId,
  entry,
  warehouses,
  skus,
  working,
  setWorking,
  onOutcome,
  onMutated,
}: {
  tenantId: string;
  entry: ChannelConnectionListEntryDto;
  warehouses: readonly WarehouseResponse[];
  skus: Readonly<Record<string, SkuResponse>> | null;
  working: string | null;
  setWorking: (value: string | null) => void;
  onOutcome: (outcome: Exclude<Outcome, null>) => void;
  onMutated: (verdicts?: readonly ChannelBufferVerdictDto[]) => void;
}) {
  const existing = entryBuckets(entry);
  const [rows, setRows] = useState<BufferRowState[]>(() =>
    existing.map((bucket, index) => ({
      key: `${bucket.warehouseId}:${bucket.skuId}:${index}`,
      warehouseId: bucket.warehouseId,
      skuId: bucket.skuId,
      raw: String(milliToBase(bucket.bufferMilli)),
    })),
  );
  // A removed standing scope rides the NEXT save as a 0-clear item — the
  // editor re-renders from the reloaded list after the save, so the removed
  // scope's absence here must not leave its buffer standing forever.
  const [cleared, setCleared] = useState<{ warehouseId: string; skuId: string }[]>([]);
  // This editor's own synchronous re-entry guard.
  const busy = useRef(false);
  const inFlight = working !== null;

  const skuList =
    skus === null ? [] : Object.values(skus).sort((a, b) => a.code.localeCompare(b.code));

  function addRow() {
    const firstFree = warehouses[0]?.id ?? '';
    setRows((prev) => [
      ...prev,
      { key: `new-${prev.length}`, warehouseId: firstFree, skuId: skuList[0]?.id ?? '', raw: '' },
    ]);
  }

  function removeRow(key: string) {
    const row = rows.find((r) => r.key === key);
    if (row !== undefined) {
      const standing = existing.some(
        (b) => b.warehouseId === row.warehouseId && b.skuId === row.skuId,
      );
      if (standing) {
        setCleared((prev) => [...prev, { warehouseId: row.warehouseId, skuId: row.skuId }]);
      }
    }
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  function patch(key: string, patch: Partial<BufferRowState>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function save() {
    if (busy.current) return;
    // Every row is an item; a blank input is a locally-refused save (parse
    // failure — nothing is sent). `0` is grammar-admitted and CLEARS the
    // scope (the backend's documented authority).
    const items: { warehouseId: string; skuId: string; bufferMilli: number }[] = [];
    for (const row of rows) {
      const parsed = parseMilliInput(row.raw);
      if (parsed === null) {
        onOutcome({
          tone: 'rejected',
          word: 'Not saved',
          reason: 'Buffer figures must be decimals of at most three places — nothing was sent.',
        });
        return;
      }
      items.push({ warehouseId: row.warehouseId, skuId: row.skuId, bufferMilli: parsed });
    }
    for (const scope of cleared) {
      items.push({ warehouseId: scope.warehouseId, skuId: scope.skuId, bufferMilli: 0 });
    }
    if (items.length === 0) {
      onOutcome({
        tone: 'accepted',
        word: 'Nothing to change',
        reason: 'The buffer editor holds no rows — the connection keeps whatever stands.',
      });
      return;
    }
    void (async () => {
      if (busy.current) return;
      busy.current = true;
      setWorking('buffers');
      try {
        const response = await fetchApiSetChannelBuffers(
          tenantId,
          entry.id,
          { items },
          ulid(),
        );
        onOutcome({
          tone: 'accepted',
          word: 'Buffers saved',
          reason: buffersSavedSentence(response.verdicts),
        });
        setCleared([]);
        onMutated(response.verdicts);
      } catch (error) {
        onOutcome({
          tone: 'rejected',
          word: 'Not saved',
          reason: setBuffersReason(error),
        });
      } finally {
        busy.current = false;
        setWorking(null);
      }
    })();
  }

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--background) p-2 text-xs">
      <div className="text-(--muted-foreground)">
        Standing buffers — quantity kept off this channel&apos;s published share (base units;
        decimals to 3 places; 0 clears). A buffer is a standing reservation: the pool and every
        other channel&apos;s published quantity lose it too.
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-(--border) text-left text-(--muted-foreground)">
              <th className="px-2 py-1.5 font-medium">Warehouse</th>
              <th className="px-2 py-1.5 font-medium">SKU</th>
              <th className="px-2 py-1.5 font-medium">Buffer</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const sku = skus?.[row.skuId] ?? null;
              return (
                <tr key={row.key} className="border-b border-(--border)/60">
                  <td className="px-2 py-1.5">
                    <select
                      className={`${selectClass} w-auto py-1 text-xs`}
                      value={row.warehouseId}
                      onChange={(e) => patch(row.key, { warehouseId: e.target.value })}
                      aria-label={`Buffer warehouse for row ${row.key}`}
                    >
                      {warehouses.length === 0 && <option value="">no warehouse</option>}
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} {w.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      className={`${selectClass} w-auto py-1 text-xs`}
                      value={row.skuId}
                      onChange={(e) => patch(row.key, { skuId: e.target.value })}
                      aria-label={`Buffer SKU for row ${row.key}`}
                    >
                      {skuList.length === 0 && <option value="">no SKU</option>}
                      {skuList.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step={sku?.uomPrecision === 0 || sku?.uomPrecision === undefined ? '1' : '0.001'}
                        className={`${inputClass} w-28 py-1 text-right text-xs`}
                        value={row.raw}
                        onChange={(e) => patch(row.key, { raw: e.target.value })}
                        aria-label={`Buffer for ${sku?.code ?? row.skuId}`}
                        placeholder="0 clears"
                      />
                      <span className="text-(--muted-foreground)">
                        {sku !== null ? quantityLabel(milliToBase(safeMilli(existing, row)), sku) : ''}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      disabled={inFlight}
                      onClick={() => removeRow(row.key)}
                      className={rowButtonClass}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-2 text-(--muted-foreground)">
                  No standing buffer on this channel.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-1">
        <button type="button" disabled={inFlight} onClick={addRow} className={rowButtonClass}>
          Add row
        </button>
        <button
          type="button"
          disabled={inFlight || (rows.length === 0 && cleared.length === 0)}
          onClick={save}
          className={primaryClass}
        >
          {working === 'buffers' ? 'Saving…' : 'Save buffers'}
        </button>
      </div>
      {cleared.length > 0 && (
        <div className="text-[10px] text-(--muted-foreground)">
          {cleared.length} standing buffer{cleared.length === 1 ? '' : 's'} marked to clear with
          the next save.
        </div>
      )}
    </div>
  );
}

/** The standing figure of a row's (warehouse, sku) scope, 0 when none stands. */
function safeMilli(
  buckets: readonly { warehouseId: string; skuId: string; bufferMilli: number }[],
  row: BufferRowState,
): number {
  return (
    buckets.find(
      (b) => b.warehouseId === row.warehouseId && b.skuId === row.skuId,
    )?.bufferMilli ?? 0
  );
}

/** A read-only bucket listing (an operator's direct-URL render). */
function BufferBucketsReadOnly({
  entry,
  skus,
}: {
  entry: ChannelConnectionListEntryDto;
  skus: Readonly<Record<string, SkuResponse>> | null;
}) {
  const buckets = entryBuckets(entry);
  if (buckets.length === 0) return null;
  return (
    <div className="text-xs text-(--muted-foreground)">
      Standing buffers:{' '}
      {buckets
        .map((b) => {
          const sku = skus?.[b.skuId] ?? null;
          return `${sku?.code ?? b.skuId.slice(0, 8)}… ${quantityLabel(milliToBase(b.bufferMilli), sku)}`;
        })
        .join(', ')}
    </div>
  );
}
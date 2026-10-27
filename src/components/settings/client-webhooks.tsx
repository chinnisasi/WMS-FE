'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import {
  fetchApiBulkRedeliverWebhooks,
  fetchApiCreateWebhookEndpoint,
  fetchApiDeleteWebhookEndpoint,
  fetchApiGetWebhookDelivery,
  fetchApiListWebhookDeliveries,
  fetchApiRedeliverWebhook,
  fetchApiRotateWebhookSecret,
  fetchApiTestWebhookEndpoint,
  fetchApiUpdateWebhookEndpoint,
} from '@/lib/api/client';
import type {
  ClientDto,
  WebhookDeliveryDetailDto,
  WebhookDeliveryDto,
  WebhookEndpointListEntryDto,
  WebhookEndpointResponse,
} from '@/lib/api/generated';
import { ApiProblem } from '@/lib/api/client';
import { readSession } from '@/lib/auth';
import {
  MAX_WEBHOOK_ENDPOINTS,
  WEBHOOK_DESCRIPTION_MAX_LENGTH,
  WEBHOOK_EVENT_HINT,
  WEBHOOK_EVENT_LABEL,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_URL_MAX_LENGTH,
  deliveryOutcomeLabel,
  deliveryStatusChip,
  emptyEndpointFields,
  endpointDraftDirty,
  endpointFieldsOf,
  endpointStatusChip,
  istInstantLabel,
  parseEndpointDraft,
  secretHintLabel,
  sinceHoursAgo,
  testOutcome,
  webhookEventsLabel,
  webhookReason,
  type EndpointFields,
  type WebhookDeliveryStatus,
} from '@/lib/client-webhooks';
import { ulid } from '@/lib/ulid';
import { useClientWebhooks } from '@/lib/use-client-webhooks';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusChip } from '@/components/shared/status-chip';
import { ReadFailure } from '@/components/shared/surface';
import { ConfirmRow } from '@/components/settings/confirm-row';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const selectClass =
  'rounded-sm border border-(--input) bg-(--background) px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const rowButtonClass =
  'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40';
const primaryButtonClass =
  'rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-40';

type Endpoint = WebhookEndpointListEntryDto;

type Mode =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'edit'; endpoint: Endpoint }
  | { kind: 'rotate'; endpoint: Endpoint }
  | { kind: 'disable'; endpoint: Endpoint }
  | { kind: 'enable'; endpoint: Endpoint }
  | { kind: 'delete'; endpoint: Endpoint }
  | { kind: 'secret'; endpoint: WebhookEndpointResponse['endpoint']; secret: string; rotated: boolean };

type Outcome = { tone: 'accepted' | 'rejected' | 'warning'; word: string; reason: string } | null;

/**
 * Story 5-2a — a client's outbound webhooks, one panel of the clients card.
 * Owner-only (`clients.manage`) — reads too: URLs and payloads are
 * integration detail, so the card offers the row action to owners only.
 *
 * - The endpoint table: URL (and what it is for), events, a status chip with
 *   a word (Active / Disabled — by staff / failing since … IST), the last
 *   delivery, the secret's hint, and the row actions: Deliveries and Send
 *   test inline, the rest under "More" (UI-PATTERNS §3.7: two inline).
 * - Add / edit with the A19 attestation; a one-time secret panel after a
 *   create or a rotate (copy, "you won't see this again").
 * - Rotate (keep the old one 24 h, or end it now), Enable (release or
 *   discard what was held), Disable, Delete — each an inline confirmation
 *   with its own Idempotency-Key (`ConfirmRow`).
 * - The deliveries list per endpoint: status, attempts, outcome, times,
 *   the exact body (and a download), Redeliver, and "Redeliver failed since…".
 * - "Deliveries are paused" when the server's sending is off, and the
 *   receiver's "How to verify" guide.
 */
export function ClientWebhooksPanel({
  client,
  onClose,
  onDirtyChange,
}: {
  client: ClientDto;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const webhooks = useClientWebhooks(client.id);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [deliveriesOf, setDeliveriesOf] = useState<Endpoint | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const testInFlight = useRef(false);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const rows = webhooks.state === 'ready' ? webhooks.data.items : [];
  const paused = webhooks.state === 'ready' && webhooks.data.warnings.includes('webhooks-unavailable');
  const full = rows.length >= MAX_WEBHOOK_ENDPOINTS;
  const show = (next: Mode) => {
    // Code review C19 — the one-time secret on screen counts as unsaved: the
    // card asks before another panel replaces it (its only copy).
    onDirtyChange(next.kind === 'secret');
    setMode(next);
  };
  const done = (next: Outcome) => {
    show({ kind: 'list' });
    setOutcome(next);
    webhooks.refresh();
  };

  async function sendTest(endpoint: Endpoint) {
    if (testInFlight.current) return;
    const session = readSession();
    if (session === null) return;
    testInFlight.current = true;
    setTesting(endpoint.id);
    setOutcome(null);
    try {
      // Each press is a new test send: a fresh key.
      const res = await fetchApiTestWebhookEndpoint(session.tenant.id, client.id, endpoint.id, ulid());
      setOutcome(testOutcome(res.test));
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Test not sent', reason: webhookReason(error) });
    } finally {
      testInFlight.current = false;
      setTesting(null);
    }
  }

  const columns: DataTableColumn<Endpoint>[] = [
    {
      key: 'url',
      header: 'Endpoint',
      priority: 1,
      render: (endpoint) => (
        <div className="flex max-w-md flex-col">
          <span className="break-all font-medium">{endpoint.url}</span>
          {endpoint.description !== null ? <span className="text-xs text-(--muted-foreground)">{endpoint.description}</span> : null}
        </div>
      ),
    },
    { key: 'events', header: 'Events', priority: 2, render: (endpoint) => webhookEventsLabel(endpoint.eventTypes) },
    {
      key: 'status',
      header: 'Status',
      priority: 1,
      render: (endpoint) => {
        const chip = endpointStatusChip(endpoint);
        return (
          <div className="flex flex-col items-start gap-1">
            <StatusChip tone={chip.tone} variant={chip.solid ? 'solid' : 'outline'}>
              {chip.word}
            </StatusChip>
            {endpoint.heldCount > 0 ? (
              <span className="text-xs text-(--muted-foreground)">
                {endpoint.heldCount.toLocaleString('en-IN')} {endpoint.heldCount === 1 ? 'delivery' : 'deliveries'} held
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'lastSuccess',
      header: 'Last delivered',
      priority: 3,
      render: (endpoint) => (endpoint.lastSuccessAt === null ? <span className="text-(--muted-foreground)">Never</span> : istInstantLabel(endpoint.lastSuccessAt)),
    },
    {
      key: 'secret',
      header: 'Signing secret',
      priority: 3,
      render: (endpoint) => (
        <div className="flex flex-col">
          <code className="text-xs">{secretHintLabel(endpoint.secretHint)}</code>
          {endpoint.previousSecretExpiresAt !== null ? (
            <span className="text-xs text-(--muted-foreground)">Old secret signs until {istInstantLabel(endpoint.previousSecretExpiresAt)}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      priority: 1,
      render: (endpoint) => (
        <div className="flex flex-wrap items-start gap-1">
          <button
            type="button"
            className={rowButtonClass}
            aria-label={`Deliveries of ${endpoint.url}`}
            aria-pressed={deliveriesOf?.id === endpoint.id}
            onClick={() => setDeliveriesOf(deliveriesOf?.id === endpoint.id ? null : endpoint)}
          >
            Deliveries
          </button>
          <button
            type="button"
            className={rowButtonClass}
            aria-label={`Send a test to ${endpoint.url}`}
            disabled={testing !== null || paused}
            title={paused ? 'Sending is off on this server' : undefined}
            onClick={() => void sendTest(endpoint)}
          >
            {testing === endpoint.id ? 'Sending…' : 'Send test'}
          </button>
          <details className="relative">
            <summary className={`${rowButtonClass} cursor-pointer list-none`} aria-label={`More actions for ${endpoint.url}`}>
              More
            </summary>
            <div className="mt-1 flex flex-col gap-1">
              <button type="button" className={rowButtonClass} onClick={() => show({ kind: 'edit', endpoint })}>
                Edit
              </button>
              <button type="button" className={rowButtonClass} onClick={() => show({ kind: 'rotate', endpoint })}>
                Rotate secret
              </button>
              {endpoint.status === 'active' ? (
                <button type="button" className={rowButtonClass} onClick={() => show({ kind: 'disable', endpoint })}>
                  Disable
                </button>
              ) : (
                <button type="button" className={rowButtonClass} onClick={() => show({ kind: 'enable', endpoint })}>
                  Enable
                </button>
              )}
              <button type="button" className={rowButtonClass} onClick={() => show({ kind: 'delete', endpoint })}>
                Delete
              </button>
            </div>
          </details>
        </div>
      ),
    },
  ];

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-md border border-(--border) p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-medium outline-none">
          Webhooks — {client.code}
        </h3>
        <button type="button" onClick={onClose} className={rowButtonClass}>
          Close
        </button>
      </div>
      <div className="text-(--muted-foreground)">
        Signed HTTPS notifications to {client.code}&apos;s own systems when its goods are received and its orders dispatched. Each
        delivery is retried for up to 72 hours; an endpoint that keeps failing for a day is paused and its deliveries are held.
      </div>

      {paused ? (
        <FeedbackBanner
          tone="warning"
          word="Deliveries are paused on this server"
          reason="Sending is turned off (WEBHOOK_GATEWAY=off). New events still queue and are sent once it is on — within 72 hours."
        />
      ) : null}

      {webhooks.state === 'failed' ? (
        <ReadFailure word="Webhooks unavailable" reason={webhooks.reason} onRetry={webhooks.reload} />
      ) : (
        <DataTable<Endpoint>
          columns={columns}
          rows={rows}
          loading={webhooks.state === 'loading' ? 'Loading webhooks…' : undefined}
          rowNoun={{ one: 'endpoint', many: 'endpoints' }}
          emptyMessage={
            <EmptyState
              kind="first-use"
              action={
                <button type="button" className={rowButtonClass} onClick={() => show({ kind: 'add' })}>
                  Add endpoint
                </button>
              }
            >
              No webhooks yet — add the URL {client.code} gave you to start sending receipts and dispatches.
            </EmptyState>
          }
        />
      )}

      {mode.kind === 'list' && webhooks.state === 'ready' && rows.length > 0 ? (
        full ? (
          <div className="text-xs text-(--muted-foreground)">
            {client.code} has {MAX_WEBHOOK_ENDPOINTS} endpoints, the most a client holds — delete one to add another.
          </div>
        ) : (
          <div>
            <button type="button" className={rowButtonClass} onClick={() => show({ kind: 'add' })}>
              Add endpoint
            </button>
          </div>
        )
      ) : null}

      {mode.kind === 'add' ? (
        <EndpointForm
          key="add"
          mode="create"
          clientCode={client.code}
          initial={emptyEndpointFields()}
          onDirtyChange={onDirtyChange}
          onCancel={() => show({ kind: 'list' })}
          save={(body, key, tenantId) => fetchApiCreateWebhookEndpoint(tenantId, client.id, body, key)}
          onSaved={(res) => {
            webhooks.refresh();
            if (res.signingSecret !== null) {
              setOutcome(null);
              show({ kind: 'secret', endpoint: res.endpoint, secret: res.signingSecret, rotated: false });
            } else {
              done({ tone: 'accepted', word: 'Endpoint added', reason: 'Rotate its secret to see a new one — a repeated save never shows it twice.' });
            }
          }}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Endpoint not added', reason })}
        />
      ) : null}

      {mode.kind === 'edit' ? (
        <EndpointForm
          key={`edit-${mode.endpoint.id}`}
          mode="edit"
          clientCode={client.code}
          initial={endpointFieldsOf(mode.endpoint)}
          onDirtyChange={onDirtyChange}
          onCancel={() => show({ kind: 'list' })}
          save={(body, key, tenantId) => fetchApiUpdateWebhookEndpoint(tenantId, client.id, mode.endpoint.id, body, key)}
          onSaved={(res) => done({ tone: 'accepted', word: 'Endpoint saved', reason: `${res.endpoint.url} is up to date.` })}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Endpoint not saved', reason })}
        />
      ) : null}

      {mode.kind === 'secret' ? <SecretReveal endpointUrl={mode.endpoint.url} secret={mode.secret} rotated={mode.rotated} onDone={() => show({ kind: 'list' })} /> : null}

      {mode.kind === 'rotate' ? (
        <RotateConfirm
          key={`rotate-${mode.endpoint.id}`}
          endpoint={mode.endpoint}
          run={(revokePrevious, key, tenantId) => fetchApiRotateWebhookSecret(tenantId, client.id, mode.endpoint.id, revokePrevious, key)}
          onClose={() => show({ kind: 'list' })}
          onDone={(res) => {
            webhooks.refresh();
            if (res.signingSecret !== null) show({ kind: 'secret', endpoint: res.endpoint, secret: res.signingSecret, rotated: true });
            else done({ tone: 'accepted', word: 'Secret rotated', reason: 'Rotate again to see a new secret.' });
          }}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Secret not rotated', reason })}
        />
      ) : null}

      {mode.kind === 'disable' ? (
        <ConfirmRow<WebhookEndpointResponse>
          key={`disable-${mode.endpoint.id}`}
          question={`Disable ${mode.endpoint.url}? Its pending deliveries fail now and nothing is sent until it is enabled.`}
          confirmLabel="Disable endpoint"
          ariaLabel="Confirm disable endpoint"
          run={(key, tenantId) => fetchApiUpdateWebhookEndpoint(tenantId, client.id, mode.endpoint.id, { status: 'disabled' }, key)}
          reason={webhookReason}
          onClose={() => show({ kind: 'list' })}
          onDone={(res) => done({ tone: 'accepted', word: 'Endpoint disabled', reason: `${res.endpoint.url} sends nothing until it is enabled.` })}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Not disabled', reason })}
        />
      ) : null}

      {mode.kind === 'enable' ? (
        <EnableConfirm
          key={`enable-${mode.endpoint.id}`}
          endpoint={mode.endpoint}
          run={(held, key, tenantId) =>
            fetchApiUpdateWebhookEndpoint(tenantId, client.id, mode.endpoint.id, held === null ? { status: 'active' } : { status: 'active', held }, key)
          }
          onClose={() => show({ kind: 'list' })}
          onDone={(res) =>
            done({
              tone: 'accepted',
              word: 'Endpoint enabled',
              reason:
                res.heldReleased !== undefined
                  ? `${res.heldReleased.toLocaleString('en-IN')} held deliveries are being sent.`
                  : res.heldDiscarded !== undefined
                    ? `${res.heldDiscarded.toLocaleString('en-IN')} held deliveries were discarded.`
                    : 'New events are sent again.',
            })
          }
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Not enabled', reason })}
        />
      ) : null}

      {mode.kind === 'delete' ? (
        <ConfirmRow<WebhookEndpointResponse>
          key={`delete-${mode.endpoint.id}`}
          question={`Delete ${mode.endpoint.url}? It stops at once; its pending deliveries fail and its log stays readable for 30 days.`}
          confirmLabel="Delete endpoint"
          ariaLabel="Confirm delete endpoint"
          run={(key, tenantId) => fetchApiDeleteWebhookEndpoint(tenantId, client.id, mode.endpoint.id, key)}
          reason={webhookReason}
          onClose={() => show({ kind: 'list' })}
          onDone={(res) => {
            if (deliveriesOf?.id === res.endpoint.id) setDeliveriesOf(null);
            done({ tone: 'accepted', word: 'Endpoint deleted', reason: `${res.endpoint.url} receives nothing more.` });
          }}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Not deleted', reason })}
        />
      ) : null}

      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}

      {deliveriesOf !== null ? (
        <DeliveriesView key={deliveriesOf.id} clientId={client.id} endpoint={deliveriesOf} onClose={() => setDeliveriesOf(null)} />
      ) : null}

      <HowToVerify />
    </section>
  );
}

/** The add / edit form — a per-draft Idempotency-Key, cleared on any edit and on success. */
function EndpointForm({
  mode,
  clientCode,
  initial,
  onDirtyChange,
  onCancel,
  save,
  onSaved,
  onRejected,
}: {
  mode: 'create' | 'edit';
  clientCode: string;
  initial: EndpointFields;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  save: (
    body: { url: string; description: string | null; eventTypes: ('receipt.recorded' | 'order.dispatched')[] },
    idempotencyKey: string,
    tenantId: string,
  ) => Promise<WebhookEndpointResponse>;
  onSaved: (res: WebhookEndpointResponse) => void;
  onRejected: (reason: string) => void;
}) {
  const [fields, setFields] = useState<EndpointFields>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const urlId = useId();
  const problemId = useId();
  const legendId = useId();
  const submitLabel = mode === 'create' ? 'Add endpoint' : 'Save endpoint';

  const edit = (next: EndpointFields) => {
    keyRef.current = null;
    setFields(next);
    onDirtyChange(endpointDraftDirty(next, initial));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseEndpointDraft(fields, mode);
    if (parsed.body === null) {
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
      const res = await save(parsed.body, keyRef.current, session.tenant.id);
      keyRef.current = null;
      onSaved(res);
    } catch (error) {
      onRejected(webhookReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={`${submitLabel} for ${clientCode}`} className="flex max-w-3xl flex-col gap-3">
      <fieldset disabled={busy} className="m-0 flex flex-col gap-3 border-0 p-0">
        <label htmlFor={urlId} className="flex flex-col gap-1">
          <span className={labelClass}>Endpoint URL</span>
          <span className="text-xs text-(--muted-foreground)">https only, on a public host. Port 443 or 1024–65535.</span>
          <input
            id={urlId}
            className={inputClass}
            value={fields.url}
            required
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            placeholder="https://hooks.example.com/wms"
            maxLength={WEBHOOK_URL_MAX_LENGTH}
            aria-invalid={problem !== null}
            aria-describedby={problem !== null ? problemId : undefined}
            onChange={(event) => edit({ ...fields, url: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>What it is for (optional)</span>
          <input
            className={inputClass}
            value={fields.description}
            maxLength={WEBHOOK_DESCRIPTION_MAX_LENGTH}
            placeholder="e.g. Acme ERP — order status sync"
            onChange={(event) => edit({ ...fields, description: event.target.value })}
          />
        </label>
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" aria-labelledby={legendId}>
          <legend id={legendId} className={labelClass}>
            Events to send
          </legend>
          {WEBHOOK_EVENT_TYPES.map((type) => (
            <label key={type} className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={fields.eventTypes.includes(type)}
                onChange={(event) =>
                  edit({
                    ...fields,
                    eventTypes: event.target.checked ? [...fields.eventTypes, type] : fields.eventTypes.filter((t) => t !== type),
                  })
                }
              />
              <span className="flex flex-col">
                <span>
                  {WEBHOOK_EVENT_LABEL[type]} <code className="text-xs text-(--muted-foreground)">{type}</code>
                </span>
                <span className="text-xs text-(--muted-foreground)">{WEBHOOK_EVENT_HINT[type]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {mode === 'create' ? (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={fields.attested} onChange={(event) => edit({ ...fields, attested: event.target.checked })} />
            <span>
              {clientCode} asked for this URL. <span className="text-(--muted-foreground)">Their goods and order facts will be sent to it.</span>
            </span>
          </label>
        ) : null}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={rowButtonClass}>
          Cancel
        </button>
      </div>
      {problem !== null ? (
        <div id={problemId} role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      ) : null}
    </form>
  );
}

/** The one-time secret: copy it now — it is never shown again. */
function SecretReveal({ endpointUrl, secret, rotated, onDone }: { endpointUrl: string; secret: string; rotated: boolean; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <section aria-labelledby={headingId} className="flex max-w-3xl flex-col gap-2 rounded-md border border-(--warning) bg-(--warning)/10 p-3">
      <h4 id={headingId} ref={headingRef} tabIndex={-1} className="font-medium outline-none">
        {rotated ? 'New signing secret' : 'Signing secret'} for {endpointUrl}
      </h4>
      <p className="text-(--foreground)">
        Give this to the client securely, out of band. You won&apos;t see it again — rotate to get a new one.
        {rotated ? ' The old secret keeps signing beside it for 24 hours unless you ended it.' : ''}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input readOnly aria-label="Signing secret" value={secret} className={`${inputClass} max-w-xl font-mono`} onFocus={(event) => event.target.select()} />
        <button
          type="button"
          className={rowButtonClass}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(secret)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div role="status" className="text-xs text-(--muted-foreground)">
        {copied ? 'Copied to the clipboard.' : ''}
      </div>
      <div>
        <button type="button" className={primaryButtonClass} onClick={onDone}>
          I have saved it
        </button>
      </div>
    </section>
  );
}

function RotateConfirm({
  endpoint,
  run,
  onClose,
  onDone,
  onRejected,
}: {
  endpoint: Endpoint;
  run: (revokePrevious: boolean, key: string, tenantId: string) => Promise<WebhookEndpointResponse>;
  onClose: () => void;
  onDone: (res: WebhookEndpointResponse) => void;
  onRejected: (reason: string) => void;
}) {
  const [revoke, setRevoke] = useState(false);
  const warning =
    endpoint.previousSecretExpiresAt !== null ? ' A rotation is already overlapping — rotating again ends the oldest secret now.' : '';
  return (
    <ConfirmRow<WebhookEndpointResponse>
      question={`Rotate the signing secret of ${endpoint.url}?${warning}`}
      confirmLabel="Rotate secret"
      ariaLabel="Confirm rotate secret"
      draft={String(revoke)}
      fields={
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={revoke} onChange={(event) => setRevoke(event.target.checked)} />
          End the old secret now (no 24-hour overlap)
        </label>
      }
      run={(key, tenantId) => run(revoke, key, tenantId)}
      reason={webhookReason}
      onClose={onClose}
      onDone={onDone}
      onRejected={onRejected}
    />
  );
}

function EnableConfirm({
  endpoint,
  run,
  onClose,
  onDone,
  onRejected,
}: {
  endpoint: Endpoint;
  run: (held: 'release' | 'discard' | null, key: string, tenantId: string) => Promise<WebhookEndpointResponse>;
  onClose: () => void;
  onDone: (res: WebhookEndpointResponse) => void;
  onRejected: (reason: string) => void;
}) {
  const [held, setHeld] = useState<'release' | 'discard'>('release');
  // Code review C26 — the list may be stale: a `held-decision-required`
  // refusal carries the real count, and the choice appears for the retry.
  const [heldCount, setHeldCount] = useState(endpoint.heldCount);
  const hasHeld = heldCount > 0;
  return (
    <ConfirmRow<WebhookEndpointResponse>
      question={
        hasHeld
          ? `Enable ${endpoint.url}? ${heldCount.toLocaleString('en-IN')} deliveries were held while it was failing.`
          : `Enable ${endpoint.url}? Its failure count starts again from zero.`
      }
      confirmLabel="Enable endpoint"
      ariaLabel="Confirm enable endpoint"
      draft={hasHeld ? held : undefined}
      fields={
        hasHeld ? (
          <span role="radiogroup" aria-label="Held deliveries" className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1">
              <input type="radio" name={`held-${endpoint.id}`} checked={held === 'release'} onChange={() => setHeld('release')} />
              Send them
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name={`held-${endpoint.id}`} checked={held === 'discard'} onChange={() => setHeld('discard')} />
              Discard them
            </label>
          </span>
        ) : undefined
      }
      run={(key, tenantId) => run(hasHeld ? held : null, key, tenantId)}
      reason={webhookReason}
      detail={(error) => {
        if (error instanceof ApiProblem && error.code === 'held-decision-required') {
          const count = typeof error.extensions.heldCount === 'number' ? error.extensions.heldCount : 1;
          setHeldCount(count);
          return `${count.toLocaleString('en-IN')} deliveries are held — choose to send or discard them, then enable again.`;
        }
        return null;
      }}
      onClose={onClose}
      onDone={onDone}
      onRejected={onRejected}
    />
  );
}

const STATUS_FILTERS: readonly { value: '' | WebhookDeliveryStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
  { value: 'held', label: 'Held' },
  { value: 'succeeded', label: 'Delivered' },
];

const SINCE_CHOICES: readonly { hours: number; label: string }[] = [
  { hours: 1, label: 'the last hour' },
  { hours: 24, label: 'the last 24 hours' },
  { hours: 72, label: 'the last 3 days' },
  { hours: 24 * 30, label: 'the last 30 days' },
];

/** One endpoint's delivery log: newest first, cursor-paged, each row openable to its body. */
function DeliveriesView({ clientId, endpoint, onClose }: { clientId: string; endpoint: Endpoint; onClose: () => void }) {
  const [status, setStatus] = useState<'' | WebhookDeliveryStatus>('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{ state: 'loading' } | { state: 'failed'; reason: string } | { state: 'ready'; items: WebhookDeliveryDto[]; nextCursor: string | null }>({
    state: 'loading',
  });
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<WebhookDeliveryDetailDto | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [sinceHours, setSinceHours] = useState(24);
  const [expiredOnly, setExpiredOnly] = useState(false);
  const busy = useRef(false);
  const headingId = useId();

  useEffect(() => {
    const session = readSession();
    if (session === null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchApiListWebhookDeliveries(session.tenant.id, clientId, endpoint.id, {
          limit: 25,
          ...(cursor === null ? {} : { cursor }),
          ...(status === '' ? {} : { status }),
        });
        if (!cancelled) setPage({ state: 'ready', items: res.items, nextCursor: res.nextCursor });
      } catch (error) {
        if (!cancelled) setPage({ state: 'failed', reason: webhookReason(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, endpoint.id, cursor, status, revision]);

  useEffect(() => {
    // The previous body stays until this one lands; it renders only under its own row.
    if (open === null) return;
    const session = readSession();
    if (session === null) return;
    let cancelled = false;
    void fetchApiGetWebhookDelivery(session.tenant.id, clientId, endpoint.id, open)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((error: unknown) => {
        if (!cancelled) setOutcome({ tone: 'rejected', word: 'Delivery unavailable', reason: webhookReason(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, endpoint.id, open]);

  const refresh = useCallback(() => setRevision((r) => r + 1), []);

  async function redeliver(delivery: WebhookDeliveryDto) {
    if (busy.current) return;
    const session = readSession();
    if (session === null) return;
    busy.current = true;
    try {
      await fetchApiRedeliverWebhook(session.tenant.id, clientId, endpoint.id, delivery.id, ulid());
      setOutcome({ tone: 'accepted', word: 'Sent again', reason: 'The same event (same webhook-id) goes out with a fresh signature, on a new retry schedule.' });
      refresh();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not sent again', reason: webhookReason(error) });
    } finally {
      busy.current = false;
    }
  }

  const columns: DataTableColumn<WebhookDeliveryDto>[] = [
    {
      key: 'created',
      header: 'Event',
      priority: 1,
      render: (d) => (
        <div className="flex flex-col">
          <span>{WEBHOOK_EVENT_LABEL[d.eventType]}</span>
          <span className="text-xs text-(--muted-foreground)">{istInstantLabel(d.createdAt)}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      priority: 1,
      render: (d) => {
        const chip = deliveryStatusChip(d.status);
        return <StatusChip tone={chip.tone}>{chip.word}</StatusChip>;
      },
    },
    { key: 'outcome', header: 'Last outcome', priority: 2, render: (d) => deliveryOutcomeLabel(d) },
    { key: 'attempts', header: 'Attempts', numeric: true, priority: 2, render: (d) => d.attempts.toLocaleString('en-IN') },
    {
      key: 'when',
      header: 'Last attempt · next',
      priority: 3,
      render: (d) => (
        <div className="flex flex-col text-xs">
          <span>{d.lastAttemptAt === null ? '—' : istInstantLabel(d.lastAttemptAt)}</span>
          {d.nextAttemptAt !== null ? <span className="text-(--muted-foreground)">next {istInstantLabel(d.nextAttemptAt)}</span> : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      priority: 1,
      render: (d) => (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className={rowButtonClass}
            aria-expanded={open === d.id}
            aria-label={`${open === d.id ? 'Hide' : 'Show'} the body of the delivery of ${istInstantLabel(d.createdAt)}`}
            onClick={() => setOpen(open === d.id ? null : d.id)}
          >
            {open === d.id ? 'Hide body' : 'Body'}
          </button>
          {(d.status === 'failed' || d.status === 'succeeded') && endpoint.status === 'active' ? (
            <button type="button" className={rowButtonClass} onClick={() => void redeliver(d)}>
              Redeliver
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 rounded-md border border-(--border) p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="font-medium">
          Deliveries — <span className="break-all">{endpoint.url}</span>
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            Status
            <select
              className={selectClass}
              value={status}
              onChange={(event) => {
                setCursor(null);
                setStatus(event.target.value as '' | WebhookDeliveryStatus);
              }}
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={rowButtonClass} onClick={refresh}>
            Refresh
          </button>
          <button type="button" className={rowButtonClass} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {page.state === 'failed' ? (
        <ReadFailure word="Deliveries unavailable" reason={page.reason} onRetry={refresh} />
      ) : (
        <DataTable<WebhookDeliveryDto>
          columns={columns}
          rows={page.state === 'ready' ? page.items : []}
          loading={page.state === 'loading' ? 'Loading deliveries…' : undefined}
          nextCursor={page.state === 'ready' ? page.nextCursor : null}
          onCursor={(next) => setCursor(next)}
          rowNoun={{ one: 'delivery', many: 'deliveries' }}
          emptyMessage={
            status === '' ? (
              <EmptyState kind="first-use">Nothing sent yet — deliveries appear when this client’s goods are received or orders dispatched.</EmptyState>
            ) : (
              <EmptyState
                kind="filtered"
                action={
                  <button
                    type="button"
                    className={rowButtonClass}
                    onClick={() => {
                      setCursor(null);
                      setStatus('');
                    }}
                  >
                    Clear filter
                  </button>
                }
              >
                No deliveries are {STATUS_FILTERS.find((f) => f.value === status)?.label.toLowerCase()}.
              </EmptyState>
            )
          }
          renderExpanded={(d) =>
            open === d.id ? (
              detail === null || detail.id !== d.id ? (
                <span className="text-xs text-(--muted-foreground)">Loading the body…</span>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-(--muted-foreground)">
                    webhook-id <code>{detail.eventId}</code> · every attempt sends exactly these bytes.
                  </div>
                  <pre className="max-h-72 overflow-auto rounded-sm border border-(--border) bg-(--muted) p-2 text-xs">{prettyJson(detail.body)}</pre>
                  <div>
                    <button type="button" className={rowButtonClass} onClick={() => downloadBody(detail)}>
                      Download body
                    </button>
                  </div>
                </div>
              )
            ) : null
          }
        />
      )}

      {endpoint.status === 'active' ? (
        <BulkRedeliver
          sinceHours={sinceHours}
          expiredOnly={expiredOnly}
          onSince={setSinceHours}
          onExpiredOnly={setExpiredOnly}
          run={(since, key, tenantId) =>
            fetchApiBulkRedeliverWebhooks(tenantId, clientId, endpoint.id, { since, ...(expiredOnly ? { statuses: ['expired'] } : {}) }, key)
          }
          onDone={(res) => {
            setOutcome({
              tone: 'accepted',
              word: `${res.redelivered.toLocaleString('en-IN')} sent again`,
              reason: res.remaining > 0 ? `${res.remaining.toLocaleString('en-IN')} more match — press again to continue.` : 'Every matching failed delivery is pending again.',
            });
            refresh();
          }}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Not sent again', reason })}
        />
      ) : (
        <div className="text-xs text-(--muted-foreground)">Enable the endpoint to redeliver to it.</div>
      )}

      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}
    </section>
  );
}

function BulkRedeliver({
  sinceHours,
  expiredOnly,
  onSince,
  onExpiredOnly,
  run,
  onDone,
  onRejected,
}: {
  sinceHours: number;
  expiredOnly: boolean;
  onSince: (hours: number) => void;
  onExpiredOnly: (value: boolean) => void;
  /** `since` is frozen per draft (code review C25): a retry of the same confirmation sends the same body. */
  run: (since: string, key: string, tenantId: string) => Promise<{ redelivered: number; remaining: number }>;
  onDone: (res: { redelivered: number; remaining: number }) => void;
  onRejected: (reason: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [anchor, setAnchor] = useState(() => Date.now());
  const since = sinceHoursAgo(sinceHours, anchor);
  if (!confirming) {
    return (
      <div>
        <button
          type="button"
          className={rowButtonClass}
          onClick={() => {
            setAnchor(Date.now());
            setConfirming(true);
          }}
        >
          Redeliver failed since…
        </button>
      </div>
    );
  }
  return (
    <ConfirmRow<{ redelivered: number; remaining: number }>
      question="Send every failed delivery again, created in"
      confirmLabel="Redeliver"
      ariaLabel="Confirm redeliver failed"
      draft={`${since}-${expiredOnly}`}
      fields={
        <>
          <select aria-label="Since" className={selectClass} value={sinceHours} onChange={(event) => onSince(Number(event.target.value))}>
            {SINCE_CHOICES.map((c) => (
              <option key={c.hours} value={c.hours}>
                {c.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={expiredOnly} onChange={(event) => onExpiredOnly(event.target.checked)} />
            Only those that expired
          </label>
        </>
      }
      run={(key, tenantId) => run(since, key, tenantId)}
      reason={webhookReason}
      onClose={() => setConfirming(false)}
      onDone={(res) => {
        setConfirming(false);
        onDone(res);
      }}
      onRejected={onRejected}
    />
  );
}

/** The receiver's guide (decision 9, A16): the Standard Webhooks steps and the 5-minute window. */
function HowToVerify() {
  return (
    <details className="rounded-md border border-(--border) p-3">
      <summary className="cursor-pointer font-medium">How the client verifies a webhook</summary>
      <div className="mt-2 flex max-w-3xl flex-col gap-2 text-sm">
        <p>
          Every delivery is an HTTPS <code>POST</code> of a JSON body, signed with the{' '}
          <a className="underline" href="https://www.standardwebhooks.com/" target="_blank" rel="noreferrer">
            Standard Webhooks
          </a>{' '}
          scheme — off-the-shelf libraries (<code>standardwebhooks</code>, <code>svix</code>) verify it in one call.
        </p>
        <ol className="list-decimal pl-5">
          <li>
            Read the <code>webhook-id</code>, <code>webhook-timestamp</code> and <code>webhook-signature</code> headers.
          </li>
          <li>Refuse a timestamp more than 5 minutes from your clock (replay protection).</li>
          <li>
            Compute HMAC-SHA256 over <code>{'{webhook-id}.{webhook-timestamp}.{raw body}'}</code> with the key = the base64-decoded bytes after{' '}
            <code>whsec_</code>, and base64 it.
          </li>
          <li>
            Accept when it equals any <code>v1,…</code> entry in the signature header (two appear for 24 hours after a rotation).
          </li>
          <li>
            Answer 2xx quickly. Dedupe on <code>webhook-id</code>: a delivery can arrive more than once and in any order — order by the body’s{' '}
            <code>occurredAt</code>.
          </li>
        </ol>
        <p className="text-(--muted-foreground)">
          A 410 Gone disables the endpoint; a 3xx is never followed; 408, 429 and 5xx are retried for up to 72 hours. Receivers allowlisting our
          addresses use the outbound IPs in the deployment guide.
        </p>
      </div>
    </details>
  );
}

function prettyJson(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function downloadBody(detail: WebhookDeliveryDetailDto): void {
  const url = URL.createObjectURL(new Blob([detail.body], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `webhook-${detail.eventType}-${detail.eventId}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

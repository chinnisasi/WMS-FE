'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { fetchApiUpdateClientEmailSettings } from '@/lib/api/client';
import type { ClientDto, ClientEmailLogItemDto } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import {
  CLIENT_EMAILS_HELP,
  REPLY_TO_MAX_LENGTH,
  clientEmailBanners,
  clientEmailKindWord,
  clientEmailStatusTone,
  clientEmailStatusWord,
  istInstantLabel,
  parseReplyToDraft,
  replyToLabel,
  replyToReason,
  replyToSaved,
} from '@/lib/client-emails';
import { ulid } from '@/lib/ulid';
import { useClientEmails } from '@/lib/use-client-emails';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusChip } from '@/components/shared/status-chip';
import { ReadFailure } from '@/components/shared/surface';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const rowButtonClass =
  'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40';
const primaryButtonClass =
  'rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-40';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/**
 * Story 5-2b — a client's receipt and dispatch emails, one panel of the
 * clients card. Every staff session reads the log (decision 11); an owner
 * (`canManage`, `clients.manage`) also sets the client's Reply-To.
 *
 * - The server-state banners: mail off, client emails off (A4), and each
 *   kind over today's limit of 500 (A5).
 * - An All / Problems filter and the log table: the email (kind and GRN code
 *   or order ref), the recipient, the status in words, attempts, and the IST
 *   times; cursor Prev / Next. While a row is queued the log re-reads every
 *   5 s for at most 60 s (`useClientEmails`).
 */
export function ClientEmailsPanel({
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
  const log = useClientEmails(client.id);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const data = log.state === 'ready' ? log.data : null;
  const banners = data === null ? [] : clientEmailBanners(data);

  const columns: DataTableColumn<ClientEmailLogItemDto>[] = [
    {
      key: 'email',
      header: 'Email',
      priority: 1,
      render: (email) => (
        <div className="flex flex-col">
          <span className="font-medium">{email.subjectLabel}</span>
          <span className="text-xs text-(--muted-foreground)">{clientEmailKindWord(email.kind)}</span>
        </div>
      ),
    },
    { key: 'to', header: 'To', priority: 2, render: (email) => <span className="break-all">{email.to}</span> },
    {
      key: 'status',
      header: 'Status',
      priority: 1,
      render: (email) => <StatusChip tone={clientEmailStatusTone(email)}>{clientEmailStatusWord(email)}</StatusChip>,
    },
    { key: 'attempts', header: 'Attempts', numeric: true, priority: 3, render: (email) => email.attempts.toLocaleString('en-IN') },
    {
      key: 'when',
      header: 'Queued · last change',
      priority: 2,
      render: (email) => (
        <div className="flex flex-col text-xs">
          <span>{istInstantLabel(email.createdAt)}</span>
          {email.updatedAt !== email.createdAt ? <span className="text-(--muted-foreground)">{istInstantLabel(email.updatedAt)}</span> : null}
        </div>
      ),
    },
  ];

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-md border border-(--border) p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-medium outline-none">
          Emails — {client.code}
        </h3>
        <button type="button" onClick={onClose} className={rowButtonClass}>
          Close
        </button>
      </div>
      <div className="text-(--muted-foreground)">
        One email per goods receipt or dispatched order to each of {client.code}&apos;s contacts who opted in (Contacts → Edit).
      </div>

      <ReplyToForm client={client} canManage={canManage} onSaved={onSaved} onDirtyChange={onDirtyChange} />

      {banners.length > 0 ? (
        <div role="group" aria-label="Email warnings" className="flex flex-col gap-2">
          {banners.map((banner) => (
            <FeedbackBanner key={banner.word} tone="warning" word={banner.word} reason={banner.reason} />
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Show" className="flex gap-1">
          <button type="button" className={rowButtonClass} aria-pressed={!log.problems} onClick={() => log.problems && log.setProblems(false)}>
            All
          </button>
          <button type="button" className={rowButtonClass} aria-pressed={log.problems} onClick={() => !log.problems && log.setProblems(true)}>
            Problems
          </button>
        </div>
        <button type="button" className={rowButtonClass} onClick={log.refresh}>
          Refresh
        </button>
      </div>

      {log.state === 'failed' ? (
        <ReadFailure word="Emails unavailable" reason={log.reason} onRetry={log.reload} />
      ) : (
        <DataTable<ClientEmailLogItemDto>
          key={`${log.problems}#${log.epoch}`}
          columns={columns}
          rows={data === null ? [] : data.items}
          loading={log.state === 'loading' ? 'Loading emails…' : undefined}
          nextCursor={data === null ? null : data.nextCursor}
          onCursor={log.setCursor}
          rowNoun={{ one: 'email', many: 'emails' }}
          emptyMessage={
            log.problems ? (
              <EmptyState
                kind="filtered"
                action={
                  <button type="button" className={rowButtonClass} onClick={() => log.setProblems(false)}>
                    Show all
                  </button>
                }
              >
                No problems — no email failed, expired or was refused.
              </EmptyState>
            ) : (
              <EmptyState kind="first-use">
                No emails yet — they appear when {client.code}&apos;s goods are received or orders dispatched, once a contact opts in.
              </EmptyState>
            )
          }
        />
      )}
      <div className="text-xs text-(--muted-foreground)">{CLIENT_EMAILS_HELP}</div>
    </section>
  );
}

/**
 * The Reply-To: read-only for every staff session, a form for an owner.
 * Per-draft Idempotency-Key (`keyRef.current ??= ulid()`): reused across
 * retries of the unchanged draft, cleared on any edit and on success.
 */
function ReplyToForm({
  client,
  canManage,
  onSaved,
  onDirtyChange,
}: {
  client: ClientDto;
  canManage: boolean;
  onSaved: (client: ClientDto) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  // The panel's client is a snapshot from when it opened: the saved value is kept here.
  const [current, setCurrent] = useState<string | null>(client.emailReplyTo ?? null);
  const [value, setValue] = useState(current ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const hintId = useId();

  if (!canManage) {
    return (
      <div className="text-sm">
        <span className={labelClass}>Reply-To: </span>
        {replyToLabel(current)}
      </div>
    );
  }

  const edit = (next: string) => {
    keyRef.current = null;
    setProblem(null);
    // A new value makes the last "Reply-To saved" stale.
    setOutcome(null);
    setValue(next);
    onDirtyChange(next.trim().toLowerCase() !== (current ?? ''));
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseReplyToDraft(value);
    if (parsed.problem !== null) {
      setProblem(parsed.problem);
      return;
    }
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setProblem(null);
    setOutcome(null);
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const saved = await fetchApiUpdateClientEmailSettings(session.tenant.id, client.id, { replyTo: parsed.replyTo }, keyRef.current);
      keyRef.current = null;
      // What the server stored — never the draft.
      const next = saved.emailReplyTo;
      setCurrent(next);
      setValue(next ?? '');
      onDirtyChange(false);
      setOutcome({ tone: 'accepted', ...replyToSaved(client.code, next) });
      onSaved(saved);
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Reply-To not saved', reason: replyToReason(error) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form aria-label={`Reply-To of ${client.code}`} onSubmit={save} noValidate className="flex flex-col gap-2">
      <label className="flex max-w-md flex-col gap-1">
        <span className={labelClass}>Reply-To</span>
        <input
          className={inputClass}
          type="email"
          value={value}
          placeholder="accounts@your-company.in"
          maxLength={REPLY_TO_MAX_LENGTH}
          spellCheck={false}
          aria-describedby={hintId}
          aria-invalid={problem !== null}
          onChange={(event) => edit(event.target.value)}
        />
        <span id={hintId} className="text-xs text-(--muted-foreground)">
          Where {client.code}&apos;s replies go — usually your account team. Blank uses the server&apos;s default.
        </span>
        {problem !== null ? (
          <span role="alert" className="text-xs text-(--destructive)">
            {problem}
          </span>
        ) : null}
      </label>
      <div>
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? 'Saving…' : 'Save Reply-To'}
        </button>
      </div>
      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}
    </form>
  );
}

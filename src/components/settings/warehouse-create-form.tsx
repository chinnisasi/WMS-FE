'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { ApiProblem, fetchApiCreateWarehouse, fetchApiListWarehouses } from '@/lib/api/client';
import { readSession, subscribeSession } from '@/lib/auth';
import { ulid } from '@/lib/ulid';
import { notifyWarehousesChanged, WAREHOUSES_CHANGED_EVENT } from '@/lib/warehouses';

import { FeedbackBanner } from '@/components/feedback/banner';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';

/**
 * Warehouse creation, hosted in Settings (EXPERIENCE.md puts warehouses
 * there). Every submit sends a fresh ULID Idempotency-Key, so a double
 * click creates one warehouse and replays the same response — never a
 * duplicate. Signed-out state is honest: a link to /login, no fake form.
 */
export function WarehouseCreateForm() {
  // `null` = unknown (server render) → render nothing, no hydration mismatch.
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<
    { tone: 'accepted'; word: string; reason: string } | { tone: 'rejected'; word: string; reason: string } | null
  >(null);

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Warehouses</div>
        <div className="text-(--muted-foreground)">
          Sign in to create a warehouse —{' '}
          <Link href="/login" className="text-(--primary) underline underline-offset-2">
            go to sign in
          </Link>
          .
        </div>
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null) return;
    setPending(true);
    setOutcome(null);
    try {
      const warehouse = await fetchApiCreateWarehouse(
        session.tenant.id,
        { code, name },
        // Fresh key per submit: retries replay, new submissions don't.
        ulid(),
      );
      setCode('');
      setName('');
      setOutcome({
        tone: 'accepted',
        word: 'Warehouse created',
        reason: `${warehouse.code} ${warehouse.name} now appears in the sidebar switcher.`,
      });
      notifyWarehousesChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: rejectionReason(error, code) });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-md border border-(--border) p-3">
      <div className="flex flex-col gap-0.5">
        <div className="font-medium">Create a warehouse</div>
        <div className="text-(--muted-foreground)">Codes are unique inside your tenant.</div>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Code</span>
          <input
            className={inputClass}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            maxLength={32}
            placeholder="BLR-01"
          />
        </label>
        <label className="flex flex-[2] flex-col gap-1">
          <span className={labelClass}>Name</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            placeholder="Whitefield"
          />
        </label>
      </div>
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create warehouse'}
      </button>
    </form>
  );
}

/** Clients branch on the machine-readable problem `code`, never on prose. */
function rejectionReason(error: unknown, attemptedCode: string): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'duplicate-warehouse-code':
        return `Code ${attemptedCode} is already used — pick another.`;
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the entered values and try again.';
      default:
        return error.detail ?? `Request failed (${error.code}).`;
    }
  }
  return 'The API is unreachable — is wms-be running?';
}

/** Existing warehouses, read-only for this story; refreshes on changes. */
export function WarehouseList() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => false,
  );
  const [items, setItems] = useState<readonly { id: string; code: string; name: string }[] | null>(null);
  // Bumped by the warehouses-changed event so the fetch effect re-runs.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(WAREHOUSES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(WAREHOUSES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (!sessioned) return;
    let cancelled = false;
    const session = readSession();
    if (session === null) return;
    fetchApiListWarehouses(session.tenant.id)
      .then((page) => {
        if (!cancelled) setItems(page.items);
      })
      .catch(() => {
        if (!cancelled) setItems(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessioned, revision]);

  if (!sessioned || items === null || items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 text-sm">
      {items.map((warehouse) => (
        <div key={warehouse.id} className="rounded-md border border-(--border) p-3">
          <div className="font-medium">
            {warehouse.code} {warehouse.name}
          </div>
        </div>
      ))}
    </div>
  );
}
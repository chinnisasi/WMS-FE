import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { AuditTrail } from './audit-trail';

/**
 * Story 9-3a — the `/reports` Audit section, driven through a stubbed global
 * `fetch`:
 *   - it renders only for `audit.view` (the owner); an ops manager sees nothing;
 *   - the columns: recorded IST + "happened", the member's email / "System" /
 *     a short id, the action, the target as plain text;
 *   - Next sends the cursor verbatim; a filter change starts again at page 1
 *     with NO cursor and Prev disabled;
 *   - the refusals' copy (role-denied for a demoted owner, the 503);
 *   - "System" sends the published system actor id; a refused draft sends nothing;
 *   - the members read failing shows an error.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const OWNER_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000u1';
const SYSTEM_ID = '01900000-0000-7000-8000-000000000000';

function session(role: 'owner' | 'ops_manager'): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Audit Co', gstin: null },
    user: { id: OWNER_ID, email: 'owner@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

const ROWS = [
  {
    id: 'a-3',
    recordedAt: '2026-10-12T10:00:00.000Z',
    occurredAt: '2026-10-12T08:00:00.000Z',
    actorUserId: OWNER_ID,
    actorKind: 'user',
    action: 'putaway.placed',
    targetType: 'putaway_placement',
    targetId: '0198f7a2-aaaa-7d4e-8f90-000000000003',
  },
  {
    id: 'a-2',
    recordedAt: '2026-10-12T09:00:00.000Z',
    occurredAt: '2026-10-12T09:00:00.000Z',
    actorUserId: SYSTEM_ID,
    actorKind: 'system',
    action: 'replenishment.breach_detected',
    targetType: 'reorder_breach',
    targetId: '0198f7a2-aaaa-7d4e-8f90-000000000002',
  },
  {
    id: 'a-1',
    recordedAt: '2026-10-12T08:00:00.000Z',
    occurredAt: '2026-10-12T08:00:00.000Z',
    actorUserId: '0198f7a2-dddd-7d4e-8f90-0000000000u9',
    actorKind: 'user',
    action: 'transfer.created',
    targetType: 'transfer_order',
    targetId: '0198f7a2-aaaa-7d4e-8f90-000000000001',
  },
];

let urls: string[] = [];
let auditReply: [number, unknown] = [200, { items: ROWS, nextCursor: 'CURSOR-2', systemActorId: SYSTEM_ID }];
/** Story 9-3a patch — a queue of one-shot replies served before `auditReply` (a failing page, then recovery). */
let auditQueue: [number, unknown][] = [];
let usersFail = false;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let view: Rendered | undefined;

beforeEach(() => {
  urls = [];
  auditReply = [200, { items: ROWS, nextCursor: 'CURSOR-2', systemActorId: SYSTEM_ID }];
  auditQueue = [];
  usersFail = false;
  writeSession(session('owner'));
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname, search } = new URL(request.url);
    urls.push(`${pathname}${search}`);
    if (pathname.endsWith('/reporting/audit')) {
      const next = auditQueue.shift() ?? auditReply;
      return json(next[0], next[1]);
    }
    if (pathname.endsWith('/users')) {
      if (usersFail) return json(503, { code: 'service-unavailable', status: 503, title: 'Unavailable', detail: 'The users read is down.' });
      return json(200, {
        items: [{ id: OWNER_ID, tenantId: TENANT_ID, email: 'owner@example.com', role: 'owner', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }],
        nextCursor: null,
      });
    }
    return json(200, { items: [], nextCursor: null });
  }) as unknown as typeof fetch);
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

function click(element: Element): void {
  act(() => {
    (element as HTMLElement).click();
  });
}

async function apply(container: HTMLElement): Promise<void> {
  const form = container.querySelector('form[aria-label="Audit filters"]') as HTMLFormElement;
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

// Story 9-3b: the section also reads `…/reporting/audit/exports` — the
// trail's own requests are the ones whose path ENDS at `/reporting/audit`.
const auditUrls = () => urls.filter((url) => url.split('?')[0]!.endsWith('/reporting/audit'));
/** The trail's table — the first in the section (9-3b's "Your exports" table follows it). */
const trailTable = (container: HTMLElement) => container.querySelector('table')!;
const lastAudit = () => new URL(`http://x${auditUrls().at(-1)!}`);
const button = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;

async function open(): Promise<HTMLElement> {
  view = render(<AuditTrail />);
  await settle();
  return view.container;
}

describe('AuditTrail (9-3a)', () => {
  test('owner: the trail renders newest first with its columns — recorded IST + happened, who, action, plain-text target', async () => {
    const container = await open();
    expect(lastAudit().pathname).toBe(`/api/v1/tenants/${TENANT_ID}/reporting/audit`);
    expect(lastAudit().search).toBe('');
    const rows = [...trailTable(container).querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent));
    expect(rows).toEqual([
      ['12 Oct 2026, 15:30:00happened 13:30', 'owner@example.com', 'putaway.placed', 'Putaway 00000003'],
      ['12 Oct 2026, 14:30:00', 'System', 'replenishment.breach_detected', 'Reorder breach 00000002'],
      // An unknown user and every target: the id's random tail, never the shared timestamp head.
      ['12 Oct 2026, 13:30:00', '000000u9', 'transfer.created', 'Transfer 00000001'],
    ]);
    // The Target column is text, never a link.
    expect(trailTable(container).querySelectorAll('tbody a')).toHaveLength(0);
  });

  test('an ops manager is never shown the section (the mirror) and nothing is read', async () => {
    writeSession(session('ops_manager'));
    const container = await open();
    expect(container.textContent).toBe('');
    expect(auditUrls()).toHaveLength(0);
  });

  test('Next sends the cursor verbatim; a filter change on a later page starts at page 1 with no cursor and Prev disabled', async () => {
    const container = await open();
    click(button(container, 'Next'));
    await settle();
    expect(lastAudit().searchParams.get('cursor')).toBe('CURSOR-2');
    expect(button(container, 'Prev').disabled).toBe(false);

    setValue(container.querySelector('[aria-label="Audit action prefix"]') as HTMLInputElement, 'transfer.');
    await apply(container);
    const url = lastAudit();
    expect(url.searchParams.get('actionPrefix')).toBe('transfer.');
    expect(url.searchParams.has('cursor')).toBe(false);
    expect(button(container, 'Prev').disabled).toBe(true);
  });

  test('the IST dates go out as the half-open instant window; from after to is refused and nothing is sent', async () => {
    const container = await open();
    setValue(container.querySelector('[aria-label="Audit from date"]') as HTMLInputElement, '2026-10-12');
    setValue(container.querySelector('[aria-label="Audit to date"]') as HTMLInputElement, '2026-10-12');
    await apply(container);
    expect(lastAudit().searchParams.get('from')).toBe('2026-10-12T00:00:00+05:30');
    expect(lastAudit().searchParams.get('to')).toBe('2026-10-13T00:00:00+05:30');

    const before = auditUrls().length;
    setValue(container.querySelector('[aria-label="Audit from date"]') as HTMLInputElement, '2026-10-14');
    await apply(container);
    expect(auditUrls()).toHaveLength(before);
    expect(container.textContent).toContain('The start date is after the end date.');
  });

  test('"System" filters on the system actor id the backend published; a member filters on their id; the target type goes out', async () => {
    const container = await open();
    setValue(container.querySelector('[aria-label="Audit actor"]') as HTMLSelectElement, 'system');
    await apply(container);
    expect(lastAudit().searchParams.get('actorUserId')).toBe(SYSTEM_ID);
    setValue(container.querySelector('[aria-label="Audit actor"]') as HTMLSelectElement, OWNER_ID);
    setValue(container.querySelector('[aria-label="Audit target type"]') as HTMLSelectElement, 'transfer_order');
    await apply(container);
    expect(lastAudit().searchParams.get('actorUserId')).toBe(OWNER_ID);
    expect(lastAudit().searchParams.get('targetType')).toBe('transfer_order');
  });

  test('a demoted owner (the server refuses role-denied) reads the role copy; a 503 reads "Narrow the filters or dates"', async () => {
    auditReply = [403, { code: 'role-denied', status: 403, title: 'x', detail: 'Role "ops_manager" does not include the "audit.view" capability.' }];
    let container = await open();
    expect(container.textContent).toContain('Only the owner can read the audit trail');
    view?.unmount();
    auditReply = [503, { code: 'report-unavailable', status: 503, title: 'x', detail: 'took too long' }];
    container = await open();
    expect(container.textContent).toContain('Narrow the filters or dates');
  });

  test('the members read failing shows an error; the trail still reads', async () => {
    usersFail = true;
    const container = await open();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Members not loaded');
    expect(trailTable(container).querySelectorAll('tbody tr')).toHaveLength(3);
  });

  test('"System" works even when no read has succeeded: the first page 503s, then System is applied with the typed id', async () => {
    auditReply = [503, { code: 'report-unavailable', status: 503, title: 'x', detail: 'took too long' }];
    const container = await open();
    expect(container.textContent).toContain('Narrow the filters or dates');
    setValue(container.querySelector('[aria-label="Audit actor"]') as HTMLSelectElement, 'system');
    await apply(container);
    expect(lastAudit().searchParams.get('actorUserId')).toBe(SYSTEM_ID);
    expect(container.textContent).not.toContain('not known yet');
  });

  test('Retry after a failed later page reads page 1 again, and the table restarts with it (Prev disabled)', async () => {
    const container = await open();
    const ok = [200, { items: ROWS, nextCursor: 'CURSOR-2', systemActorId: SYSTEM_ID }] as [number, unknown];
    auditQueue = [[503, { code: 'report-unavailable', status: 503, title: 'x', detail: 'took too long' }], ok];
    click(button(container, 'Next'));
    await settle();
    expect(lastAudit().searchParams.get('cursor')).toBe('CURSOR-2');
    expect(container.textContent).toContain('Narrow the filters or dates');
    click(button(container, 'Retry'));
    await settle();
    expect(lastAudit().searchParams.has('cursor')).toBe(false);
    expect(trailTable(container).querySelectorAll('tbody tr')).toHaveLength(3);
    expect(button(container, 'Prev').disabled).toBe(true);
    expect(button(container, 'Next').disabled).toBe(false);
  });

});

import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import {
  deliveryOutcomeLabel,
  deliveryStatusChip,
  emptyEndpointFields,
  endpointDraftDirty,
  endpointStatusChip,
  istInstantLabel,
  parseEndpointDraft,
  secretHintLabel,
  sinceHoursAgo,
  testOutcome,
  webhookEventsLabel,
  webhookReason,
} from './client-webhooks';

const AT = '2026-10-27T08:35:00.000Z'; // 14:05 IST

describe('client webhooks copy (story 5-2a)', () => {
  test('IST instants, events and the secret hint', () => {
    expect(istInstantLabel(AT)).toBe('27 Oct 2026, 14:05 IST');
    expect(webhookEventsLabel(['receipt.recorded', 'order.dispatched'])).toBe('Goods received · Order dispatched');
    expect(secretHintLabel('a1B2')).toBe('whsec_…a1B2');
  });

  test('the endpoint status reads as a word with a tone', () => {
    expect(endpointStatusChip({ status: 'active', disabledReason: null, failingSince: null })).toEqual({ tone: 'success', word: 'Active', solid: false });
    expect(endpointStatusChip({ status: 'active', disabledReason: null, failingSince: AT })).toEqual({
      tone: 'warning',
      word: 'Active — failing since 27 Oct 2026, 14:05 IST',
      solid: false,
    });
    expect(endpointStatusChip({ status: 'disabled', disabledReason: 'manual', failingSince: null }).word).toBe('Disabled — by staff');
    expect(endpointStatusChip({ status: 'disabled', disabledReason: 'failing', failingSince: AT })).toEqual({
      tone: 'danger',
      word: 'Disabled — failing since 27 Oct 2026, 14:05 IST',
      solid: true,
    });
    expect(endpointStatusChip({ status: 'disabled', disabledReason: 'gone', failingSince: null }).word).toBe('Disabled — receiver gone (410)');
    expect(endpointStatusChip({ status: 'disabled', disabledReason: 'client-departed', failingSince: null }).word).toBe('Disabled — client departed');
  });

  test('delivery statuses and outcomes', () => {
    expect(deliveryStatusChip('succeeded')).toEqual({ tone: 'success', word: 'Delivered' });
    expect(deliveryStatusChip('held')).toEqual({ tone: 'warning', word: 'Held' });
    expect(deliveryStatusChip('failed')).toEqual({ tone: 'danger', word: 'Failed' });
    expect(deliveryOutcomeLabel({ status: 'succeeded', lastStatusCode: 204, lastErrorCode: null })).toBe('HTTP 204');
    expect(deliveryOutcomeLabel({ status: 'pending', lastStatusCode: 503, lastErrorCode: 'http-503' })).toBe('HTTP 503');
    expect(deliveryOutcomeLabel({ status: 'failed', lastStatusCode: 302, lastErrorCode: 'http-302' })).toBe('HTTP 302 — redirect not followed');
    expect(deliveryOutcomeLabel({ status: 'pending', lastStatusCode: null, lastErrorCode: 'target-blocked' })).toBe('Blocked — the host resolves to a private address');
    expect(deliveryOutcomeLabel({ status: 'failed', lastStatusCode: null, lastErrorCode: 'expired' })).toBe('Expired — not delivered within 72 hours');
    expect(deliveryOutcomeLabel({ status: 'pending', lastStatusCode: null, lastErrorCode: null })).toBe('—');
    expect(deliveryOutcomeLabel({ status: 'failed', lastStatusCode: null, lastErrorCode: 'something-new' })).toBe('something-new');
  });

  test('the test send outcome', () => {
    expect(testOutcome({ statusCode: 204, errorCode: null, durationMs: 1234 })).toEqual({
      tone: 'accepted',
      word: 'Test delivered — HTTP 204',
      reason: 'The receiver answered in 1,234 ms.',
    });
    expect(testOutcome({ statusCode: null, errorCode: 'timeout', durationMs: 10000 })).toEqual({
      tone: 'rejected',
      word: 'Test not delivered',
      reason: 'Timed out (10,000 ms). The failure counters were not touched.',
    });
  });

  test('the draft: the save-time URL rules, at least one event, the attestation on create', () => {
    const base = { ...emptyEndpointFields(), url: 'https://hooks.acme.in/wms', attested: true };
    expect(parseEndpointDraft(base, 'create')).toEqual({
      body: { url: 'https://hooks.acme.in/wms', description: null, eventTypes: ['receipt.recorded', 'order.dispatched'] },
      problem: null,
    });
    const problem = (fields: Partial<typeof base>, mode: 'create' | 'edit' = 'create') => parseEndpointDraft({ ...base, ...fields }, mode).problem;
    expect(problem({ url: '' })).toBe('Enter the URL the client gave you.');
    expect(problem({ url: 'http://hooks.acme.in/' })).toContain('https://');
    expect(problem({ url: 'https://u:p@hooks.acme.in/' })).toContain('user name');
    expect(problem({ url: 'https://hooks.acme.in/#x' })).toContain('fragment');
    for (const url of ['https://10.0.0.5/', 'https://2130706433/', 'https://0x7f.1/', 'https://[::1]/']) expect(problem({ url })).toContain('IP address');
    for (const url of ['https://localhost/', 'https://localhost./', 'https://nas.local/', 'https://db.internal/']) expect(problem({ url })).toContain('not a public host');
    expect(problem({ url: 'https://hooks.acme.in:80/' })).toContain('port');
    expect(problem({ eventTypes: [] })).toBe('Choose at least one event to send.');
    expect(problem({ description: 'd'.repeat(201) })).toContain('200');
    expect(problem({ attested: false })).toBe('Confirm the client asked for this URL.');
    expect(problem({ attested: false }, 'edit')).toBeNull();
    expect(parseEndpointDraft({ ...base, description: '  ERP  ', eventTypes: ['order.dispatched'] }, 'create').body).toEqual({
      url: 'https://hooks.acme.in/wms',
      description: 'ERP',
      eventTypes: ['order.dispatched'],
    });
  });

  test('dirty: URL, description and the event set (order-insensitive)', () => {
    const initial = { url: 'https://a.in/', description: '', eventTypes: ['order.dispatched', 'receipt.recorded'] as ('order.dispatched' | 'receipt.recorded')[], attested: true };
    expect(endpointDraftDirty({ ...initial, eventTypes: ['receipt.recorded', 'order.dispatched'] }, initial)).toBe(false);
    expect(endpointDraftDirty({ ...initial, url: 'https://b.in/' }, initial)).toBe(true);
    expect(endpointDraftDirty({ ...initial, eventTypes: ['order.dispatched'] }, initial)).toBe(true);
  });

  test('refusals in words, branching on code', () => {
    expect(webhookReason(new ApiProblem('webhook-endpoint-limit', 409))).toContain('at most 5');
    expect(webhookReason(new ApiProblem('webhooks-unavailable', 409))).toContain('turned off');
    expect(webhookReason(new ApiProblem('rate-limited', 429, 'x', 'x', { retryAfterSeconds: 12 }))).toContain('try again in 12 s');
    expect(webhookReason(new ApiProblem('validation-failed', 400, 'url must use https (rule: scheme)'))).toBe('url must use https (rule: scheme)');
    expect(webhookReason(new Error('offline'))).toContain('could not be reached');
  });

  test('since N hours ago', () => {
    expect(sinceHoursAgo(24, Date.parse(AT))).toBe('2026-10-26T08:35:00.000Z');
  });
});

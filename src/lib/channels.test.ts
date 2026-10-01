import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { ChannelConnectionListEntryDto } from './api/generated';
import {
  BREAKER_LABEL,
  CHANNEL_CREDENTIAL_FIELDS,
  CHANNEL_MANAGE_CAPABILITY,
  CHANNEL_PROVIDER_LABEL,
  CHANNEL_PROVIDERS,
  CHANNEL_WEBHOOK_PROVIDERS,
  backorderPolicySavedSentence,
  buffersSavedSentence,
  connectAcceptedSentence,
  connectReason,
  disconnectAcceptedSentence,
  entryBuckets,
  ingestWarehouseSavedSentence,
  lagLabel,
  listMappingsReason,
  mappingsSavedSentence,
  retryAcceptedSentence,
  setBuffersReason,
  setMappingsReason,
  updateConnectionConfigReason,
  webhookUrlFromBase,
} from './channels';

/**
 * The channels vocabulary's pure decisions (story 7-1). The generated
 * client's types come from the backend contract, so the mirror pins here are:
 * the frozen provider set with its connect-form field declarations in wire
 * order, the ledger-honest sentences, and the reason mappers' code branches
 * — prose pins for the arms whose wording is load-bearing.
 */

describe('the provider vocabulary', () => {
  test('the frozen three, and only them', () => {
    expect([...CHANNEL_PROVIDERS]).toEqual(['shopify', 'amazon-in', 'flipkart']);
    expect(CHANNEL_PROVIDER_LABEL).toEqual({
      shopify: 'Shopify',
      'amazon-in': 'Amazon.in',
      flipkart: 'Flipkart',
    });
  });

  test('each provider declares its credential fields in registry wire order', () => {
    // Shopify: domain + access token required; story 7-2 appends its two
    // OPTIONAL fields — the webhook signing secret and the fulfillment
    // location id the writeback writes against.
    expect(CHANNEL_CREDENTIAL_FIELDS.shopify.map((f) => f.name)).toEqual([
      'shopDomain',
      'accessToken',
      'apiVersion',
      'webhookSecret',
      'locationId',
    ]);
    expect(CHANNEL_CREDENTIAL_FIELDS.shopify.map((f) => f.required)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(CHANNEL_CREDENTIAL_FIELDS['amazon-in'].map((f) => f.name)).toEqual([
      'sellerId',
      'refreshToken',
      'marketplaceId',
    ]);
    expect(CHANNEL_CREDENTIAL_FIELDS['amazon-in'].map((f) => f.required)).toEqual([
      true,
      true,
      false,
    ]);
    expect(CHANNEL_CREDENTIAL_FIELDS.flipkart.map((f) => f.name)).toEqual([
      'appId',
      'appSecret',
      'sellerId',
    ]);
    expect(CHANNEL_CREDENTIAL_FIELDS.flipkart.map((f) => f.required)).toEqual([
      true,
      true,
      false,
    ]);
  });

  test('the ingest/writback fields carry their sensitivity: the secret hides, the location id does not', () => {
    const spec = (name: string) =>
      CHANNEL_CREDENTIAL_FIELDS.shopify.find((f) => f.name === name) as never as {
        sensitive?: boolean;
      };
    // Nothing declared = password-typed (the connect-form default), so only
    // the location id OVERRIDES to text.
    expect(spec('webhookSecret').sensitive).toBe(true);
    expect(spec('locationId').sensitive).toBe(false);
    expect(spec('accessToken').sensitive).toBeUndefined();
    expect(spec('shopDomain').sensitive).toBeUndefined();
  });
});

describe('the connection verdict sentences', () => {
  test('the connect sentence promises sealing, not material', () => {
    const sentence = connectAcceptedSentence({
      id: 'conn-1',
      providerName: 'Shopify',
    } as never);
    expect(sentence).toContain('Shopify is connected');
    // The whole point of the sealed-credential contract, said on screen.
    expect(sentence).toContain('sealed');
    expect(sentence).not.toMatch(/token|key/i);
  });

  test('the buffer-save sentence counts the verdicts and names each refused item with the server\'s words', () => {
    const applied = buffersSavedSentence([
      verdict({ status: 'applied', bufferMilli: 4000, standingMilli: 4000 }),
      verdict({ status: 'unchanged', bufferMilli: 0, standingMilli: 0 }),
    ]);
    expect(applied).toContain('1 buffer applied');
    expect(applied).toContain('1 unchanged');
    expect(applied).not.toContain('refused');

    const refused = buffersSavedSentence([
      verdict({ status: 'refused', code: 'buffer-over-ceiling', detail: 'pool ATP 10,000 would fall to 2,000' }),
    ]);
    expect(refused).toContain('1 refused');
    // The server's own words, verbatim — the pool figure is its evidence.
    expect(refused).toContain('pool ATP 10,000 would fall to 2,000');
  });

  test('the retry sentence reads the breaker state off the snapshot', () => {
    expect(retryAcceptedSentence({ breakerState: 'half-open' } as never)).toContain(
      'the breaker reads half-open',
    );
    expect(retryAcceptedSentence({ breakerState: 'closed' } as never)).toContain(
      'the breaker reads closed',
    );
  });

  test('the backorder-policy sentences say what 7-2 will do with the value', () => {
    expect(backorderPolicySavedSentence('accept')).toContain('accept');
    expect(backorderPolicySavedSentence('reject')).toContain('refuse');
    expect(disconnectAcceptedSentence()).toContain('released back to the pool');
  });
});

describe('the lag label', () => {
  test('seconds under a minute, minutes at or past it, none when never synced', () => {
    expect(lagLabel(null)).toBeNull();
    expect(lagLabel(5000)).toBe('5s of sync lag');
    expect(lagLabel(59_400)).toBe('59s of sync lag');
    expect(lagLabel(60_000)).toBe('1m of sync lag');
    expect(lagLabel(185_000)).toBe('3m of sync lag');
  });
});

describe('the reason mappers', () => {
  test('a 409 renders the server\'s own words VERBATIM, and the capability refusals name the verb', () => {
    // The replenishment convention: the cause is invisible behind the DTOs the
    // client holds, so the 409's title/detail is the only honest rendering.
    const exists = new ApiProblem(
      'connection-exists',
      409,
      'This provider is already connected for the tenant.',
      'Connection exists',
    );
    expect(connectReason(exists)).toContain('Connection exists');
    expect(connectReason(exists)).toContain('This provider is already connected for the tenant.');
    expect(connectReason(problem(403, 'role-denied'))).toContain('cannot connect channels');
    // The blank-required-field local refusal's server twin.
    expect(connectReason(problem(400, 'validation-failed', 'accessToken is required'))).toContain(
      'accessToken is required',
    );
  });

  test('the set-buffers mapper separates the whole-request 503 from the per-item refusals', () => {
    const unreachable = setBuffersReason(problem(503, 'reservation-store-unavailable'));
    expect(unreachable).toContain('no buffer was changed');
    expect(setBuffersReason(problem(404, 'not-found'))).toContain('no longer exists');
  });

  test('the backorder-policy mapper pins the capability refusal, the gone connection and the already-processed save', () => {
    expect(updateConnectionConfigReason(problem(403, 'role-denied'))).toContain(
      'cannot change a channel’s backorder policy',
    );
    expect(updateConnectionConfigReason(problem(404, 'not-found'))).toContain('no longer exists');
    expect(updateConnectionConfigReason(problem(422, 'idempotency-key-reuse'))).toContain(
      'already processed',
    );
  });

  test('an unbranchable error renders the unreachable copy, not a stack trace', () => {
    expect(connectReason(new Error('Network request failed'))).toMatch(/failed|unreachable/i);
  });
});

describe('the bucket stitch', () => {
  test('entryBuckets reads the wire array back as the declared shape', () => {
    const entry = {
      id: 'conn-1',
      buffers: [{ warehouseId: 'w1', skuId: 's1', bufferMilli: 4000 }],
    } as unknown as ChannelConnectionListEntryDto;
    expect(entryBuckets(entry)).toEqual([
      { warehouseId: 'w1', skuId: 's1', bufferMilli: 4000 },
    ]);
  });

  test('the surface vocabulary names the breaker and the capability it consults', () => {
    expect(BREAKER_LABEL['open']).toContain('open');
    expect(CHANNEL_MANAGE_CAPABILITY).toBe('channel.manage');
  });
});

describe('the webhook endpoint composer (story 7-2, bl-16)', () => {
  test('the URL is composed from the CONFIGURED API base, not the page origin', () => {
    // The base carries /api/v1 — it is stripped and the route re-appended.
    expect(
      webhookUrlFromBase(
        'https://api.example.co.uk/api/v1',
        't-1',
        'shopify',
        'conn-1',
        'orders',
      ),
    ).toBe('https://api.example.co.uk/api/v1/tenants/t-1/webhooks/channels/shopify/conn-1/orders');
  });

  test('a path-prefixed base keeps its prefix and a bare base simply gains one', () => {
    expect(
      webhookUrlFromBase('https://gateway.example.com/wms/api/v1', 't-1', 'shopify', 'c-1', 'cancellations'),
    ).toBe(
      'https://gateway.example.com/wms/api/v1/tenants/t-1/webhooks/channels/shopify/c-1/cancellations',
    );
    expect(
      webhookUrlFromBase('https://gateway.example.com', 't-2', 'shopify', 'c-2', 'orders'),
    ).toBe('https://gateway.example.com/api/v1/tenants/t-2/webhooks/channels/shopify/c-2/orders');
  });

  test('only the providers with a wired ingest offer URLs', () => {
    expect([...CHANNEL_WEBHOOK_PROVIDERS]).toEqual(['shopify']);
    expect(CHANNEL_WEBHOOK_PROVIDERS.includes('amazon-in' as never)).toBe(false);
  });
});

describe('the mapping mappers (story 7-2)', () => {
  test('the read mapper separates the capability arm, the gone connection and the session arm', () => {
    expect(listMappingsReason(problem(403, 'role-denied'))).toContain(
      'cannot read a channel’s SKU mappings',
    );
    expect(listMappingsReason(problem(404, 'not-found'))).toContain('no longer exists');
    expect(listMappingsReason(problem(401, 'unauthenticated'))).toContain('sign in again');
    expect(listMappingsReason(problem(403, 'permission-denied'))).toContain('another tenant');
  });

  test('the save mapper pins the full-replacement refusals, the 400 arms carry their detail VERBATIM', () => {
    expect(setMappingsReason(problem(403, 'role-denied'))).toContain(
      'cannot edit a channel’s SKU mappings',
    );
    expect(setMappingsReason(problem(404, 'not-found'))).toContain('refresh the page');
    expect(setMappingsReason(problem(422, 'idempotency-key-reuse'))).toContain('already processed');
    // The 200-SKU / publish-scope arithmetic binds ride the server's own words.
    expect(
      setMappingsReason(
        problem(
          400,
          'validation-failed',
          'mappings must name at most 200 SKUs (published rows for 3 SKUs across 2 warehouses = 6)',
        ),
      ),
    ).toContain('published rows for 3 SKUs across 2 warehouses = 6');
    expect(setMappingsReason(problem(400, 'validation-failed'))).toContain('up to 200 SKUs');
    expect(setMappingsReason(new Error('Network request failed'))).toMatch(/failed|unreachable/i);
  });
});

describe('the 7-2 acceptance sentences', () => {
  test('the ingest-warehouse sentences name what clearing costs', () => {
    expect(ingestWarehouseSavedSentence(null)).toContain('ingest-warehouse-unset');
    expect(ingestWarehouseSavedSentence('WH-A')).toContain('WH-A');
    expect(ingestWarehouseSavedSentence('WH-A')).toContain('order path');
  });

  test('the mapping-save sentence says full replacement out loud', () => {
    expect(mappingsSavedSentence(1)).toContain('1 mapping replaced');
    expect(mappingsSavedSentence(3)).toContain('3 mappings replaced');
    expect(mappingsSavedSentence(2)).toContain('removed');
    expect(mappingsSavedSentence(0)).toContain('cleared');
  });
});

function problem(status: number, code: string, detail?: string): ApiProblem {
  return new ApiProblem(code, status, detail, 'Title');
}

function verdict(
  overrides: Partial<{
    index: number;
    status: string;
    bufferMilli: number;
    standingMilli: number;
    code?: string;
    detail?: string;
  }>,
): Parameters<typeof buffersSavedSentence>[0][number] {
  return {
    index: 0,
    warehouseId: 'w1',
    skuId: 's1',
    status: 'applied',
    bufferMilli: 0,
    standingMilli: 0,
    ...overrides,
    } as Parameters<typeof buffersSavedSentence>[0][number];
}
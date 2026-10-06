import { describe, expect, test } from 'bun:test';

import { drillHref, drillLinkText, webRouteFor } from './drill-routes';

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const W = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';

describe('webRouteFor — the one apiPath → screen map', () => {
  test.each([
    [`/tenants/${T}/warehouses/${W}/inventory/events`, '/inventory'],
    [`/tenants/${T}/warehouses/${W}/outbound/orders`, '/outbound'],
    [`/tenants/${T}/receiving/over-receipts`, '/conflicts'],
    [`/tenants/${T}/receiving/goods-receipts`, '/inbound'],
    [`/tenants/${T}/putaway/tasks`, '/inbound'],
    [`/tenants/${T}/replenishment/batch-alerts`, '/replenishment'],
    [`/tenants/${T}/channels/connections`, '/channels'],
    [`/tenants/${T}/eway/bills`, '/compliance'],
    [`/tenants/${T}/invoices`, '/compliance'],
  ])('%s → %s', (apiPath, route) => {
    expect(webRouteFor(apiPath)).toBe(route);
  });

  test.each(['picklist-lines', 'pack-failures', 'backorder-refusals'])(
    'the outbound %s list has no web screen → no route, no link',
    (list) => {
      const apiPath = `/tenants/${T}/warehouses/${W}/outbound/${list}`;
      expect(webRouteFor(apiPath)).toBeNull();
      expect(drillHref({ apiPath, query: { from: 'x' } })).toBeNull();
      expect(drillLinkText(apiPath)).toBeNull();
    },
  );

  test('link copy names the screen', () => {
    expect(drillLinkText(`/tenants/${T}/warehouses/${W}/outbound/orders`)).toBe('Open Outbound');
    expect(drillLinkText(`/tenants/${T}/receiving/over-receipts`)).toBe('Open Conflicts & Reviews');
    expect(drillLinkText(`/tenants/${T}/invoices`)).toBe('Open Compliance');
    expect(drillLinkText(`/tenants/${T}/reports/audit`)).toBeNull();
  });

  test('an unknown route maps to nothing — never a guess', () => {
    expect(webRouteFor(`/tenants/${T}/reports/audit`)).toBeNull();
    expect(webRouteFor(`/tenants/${T}/invoices/${W}`)).toBeNull();
    expect(webRouteFor('')).toBeNull();
  });
});

describe('drillHref — the full drill query rides into the URL', () => {
  test('every query key is carried, in the drill order', () => {
    const href = drillHref({
      apiPath: `/tenants/${T}/warehouses/${W}/outbound/orders`,
      query: { status: 'accepted', from: '2026-10-05T18:30:00.000Z', to: '2026-10-06T10:00:00.000Z' },
    });
    expect(href).toBe(
      '/outbound?status=accepted&from=2026-10-05T18%3A30%3A00.000Z&to=2026-10-06T10%3A00%3A00.000Z',
    );
    const params = new URLSearchParams(href!.split('?')[1]);
    expect(params.get('from')).toBe('2026-10-05T18:30:00.000Z');
  });

  test('an empty query links the bare route', () => {
    expect(drillHref({ apiPath: `/tenants/${T}/channels/connections`, query: {} })).toBe('/channels');
  });

  test('an unknown apiPath renders no link', () => {
    expect(drillHref({ apiPath: '/tenants/x/unknown', query: { a: 'b' } })).toBeNull();
  });
});

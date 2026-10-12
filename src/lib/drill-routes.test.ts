import { describe, expect, test } from 'bun:test';

import { drillHref, drillLinkHref, drillLinkText, webRouteFor } from './drill-routes';
import { roleHasCapability, type Capability, type UserRole } from './users';

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const W = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';

describe('webRouteFor — the one apiPath → screen map', () => {
  test.each([
    [`/tenants/${T}/warehouses/${W}/inventory/events`, '/inventory/ledger'],
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
    expect(drillLinkText(`/tenants/${T}/warehouses/${W}/inventory/events`)).toBe('Open Ledger');
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

describe('drillHref — list, the path warehouse, then the full drill query', () => {
  test('a path-scoped drill carries `list` and the path warehouse ahead of its own keys, in order', () => {
    const href = drillHref({
      apiPath: `/tenants/${T}/warehouses/${W}/outbound/orders`,
      query: { status: 'accepted', from: '2026-10-05T18:30:00.000Z', to: '2026-10-06T10:00:00.000Z' },
    });
    expect(href).toBe(
      `/outbound?list=orders&warehouseId=${W}&status=accepted&from=2026-10-05T18%3A30%3A00.000Z&to=2026-10-06T10%3A00%3A00.000Z`,
    );
    const params = new URLSearchParams(href!.split('?')[1]);
    expect(params.get('from')).toBe('2026-10-05T18:30:00.000Z');
    expect(params.get('warehouseId')).toBe(W);
  });

  test('the ledger drill lands on /inventory/ledger with its warehouse', () => {
    const href = drillHref({
      apiPath: `/tenants/${T}/warehouses/${W}/inventory/events`,
      query: { type: 'pick.picked', to: '2026-10-06T10:00:00.000Z' },
    });
    expect(href).toBe(`/inventory/ledger?list=ledger&warehouseId=${W}&type=pick.picked&to=2026-10-06T10%3A00%3A00.000Z`);
  });

  test('the PATH warehouse wins: a query naming another warehouse renders no link', () => {
    const other = '0198f7a2-1b3c-7d4e-8f90-000000000009';
    const apiPath = `/tenants/${T}/warehouses/${W}/outbound/orders`;
    expect(drillHref({ apiPath, query: { warehouseId: other } })).toBeNull();
    expect(drillLinkHref({ apiPath, query: { warehouseId: other } }, () => true)).toBeNull();
  });

  test('a query repeating the path warehouse is carried once', () => {
    const href = drillHref({ apiPath: `/tenants/${T}/warehouses/${W}/outbound/orders`, query: { warehouseId: W } });
    expect(new URLSearchParams(href!.split('?')[1]).getAll('warehouseId')).toEqual([W]);
  });

  test.each([
    [`/tenants/${T}/receiving/over-receipts`, 'over-receipts'],
    [`/tenants/${T}/receiving/goods-receipts`, 'grns'],
    [`/tenants/${T}/putaway/tasks`, 'putaway'],
    [`/tenants/${T}/replenishment/batch-alerts`, 'batch-alerts'],
    [`/tenants/${T}/eway/bills`, 'eway'],
    [`/tenants/${T}/invoices`, 'invoices'],
  ])('a tenant-scoped drill (%s) carries list=%s and its query warehouse only', (apiPath, list) => {
    const href = drillHref({ apiPath, query: { warehouseId: W } })!;
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('list')).toBe(list);
    expect(params.getAll('warehouseId')).toEqual([W]);
  });

  test('the three /compliance drills with identical keys are told apart by `list`', () => {
    const query = { warehouseId: W, from: '2026-10-05T18:30:00.000Z', to: '2026-10-06T10:00:00.000Z' };
    const eway = drillHref({ apiPath: `/tenants/${T}/eway/bills`, query })!;
    const invoices = drillHref({ apiPath: `/tenants/${T}/invoices`, query })!;
    expect(eway).not.toBe(invoices);
    expect(new URLSearchParams(eway.split('?')[1]).get('list')).toBe('eway');
    expect(new URLSearchParams(invoices.split('?')[1]).get('list')).toBe('invoices');
  });

  test('the filterless channels drill links the bare route', () => {
    expect(drillHref({ apiPath: `/tenants/${T}/channels/connections`, query: {} })).toBe('/channels');
  });

  test('an unknown apiPath renders no link', () => {
    expect(drillHref({ apiPath: '/tenants/x/unknown', query: { a: 'b' } })).toBeNull();
  });
});

describe('drillLinkHref — no link to a list the role cannot see (decision 5)', () => {
  const overReceipts = { apiPath: `/tenants/${T}/receiving/over-receipts`, query: { warehouseId: W } };
  const can = (role: UserRole) => (capability: Capability) => roleHasCapability(role, capability);

  test.each(['operator', 'accountant'] as const)('%s (no review.decide) gets no over-receipt link', (role) => {
    expect(drillLinkHref(overReceipts, can(role))).toBeNull();
  });

  test.each(['owner', 'ops_manager'] as const)('%s gets the over-receipt link', (role) => {
    expect(drillLinkHref(overReceipts, can(role))).toBe(drillHref(overReceipts));
  });

  test('an ungated drill links for every role', () => {
    const orders = { apiPath: `/tenants/${T}/warehouses/${W}/outbound/orders`, query: { status: 'accepted' } };
    expect(drillLinkHref(orders, can('operator'))).toBe(drillHref(orders));
  });

  test('a drill with no screen stays unlinked whatever the role', () => {
    const apiPath = `/tenants/${T}/warehouses/${W}/outbound/pack-failures`;
    expect(drillLinkHref({ apiPath, query: {} }, () => true)).toBeNull();
  });
});

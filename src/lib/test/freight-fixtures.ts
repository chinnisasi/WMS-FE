import type { FreightConsignmentViewDto, FreightLoadViewDto } from '@/lib/api/generated';

/** Story 4-9a — a load and its consignments in the as-built `FreightLoadView` shape (tests only). */
export const NOW = Date.parse('2026-10-30T10:30:00.000Z'); // 16:00 IST

export function consignment(over: Partial<FreightConsignmentViewDto> = {}): FreightConsignmentViewDto {
  return {
    id: 'c-1',
    orderId: 'o-1',
    orderLabel: 'SO-1',
    orderStatus: 'ready_to_dispatch',
    clientId: 'cl-a',
    clientCode: 'ACME',
    stopSeq: 1,
    consignmentRef: 'LD-0001/01',
    status: 'planned',
    consignee: { name: 'Buyer', city: 'Pune', state: 'MH', pincode: '411001' },
    lr: { number: null, date: null, terms: null },
    packages: { total: 15, pallets: 15, loaded: 15, staleScans: 0, packed: true },
    weightGrams: 9_840_000,
    gate: { state: 'ready', blocking: false },
    eway: { number: null, validUntil: null },
    invoice: null,
    loadException: null,
    complianceException: null,
    dispatchedAt: null,
    delivery: null,
    ...over,
  };
}

export function load(over: Partial<FreightLoadViewDto> = {}): FreightLoadViewDto {
  return {
    id: 'l-1',
    code: 'LD-0001',
    status: 'open',
    mode: 'ltl',
    warehouseId: 'w-1',
    transporter: { partnerId: 'p-1', name: 'VRL', snapshot: null },
    vehicle: { type: 'hcv', number: 'KA01AB1234', containerNumber: null, capacityKg: 20_000, reportedAt: null },
    driver: { name: 'Ravi', phone: '9876543210', licenceNumber: null },
    dockDoor: 'D-3',
    seals: [],
    note: null,
    loadingStartedAt: null,
    dispatchedAt: null,
    dispatchedBy: null,
    dispatchSource: null,
    partB: { required: false, confirmedAt: null, confirmedBy: null },
    capacityExceeded: false,
    totals: { consignments: 2, packages: 21, loaded: 21, pallets: 15, grossWeightGrams: 10_000_000, weightKnown: true, overCapacity: false },
    consignments: [
      consignment(),
      consignment({
        id: 'c-2',
        orderId: 'o-3',
        orderLabel: 'SO-3',
        clientId: 'cl-b',
        clientCode: 'GLOW',
        stopSeq: 2,
        consignmentRef: 'LD-0001/02',
        packages: { total: 6, pallets: 0, loaded: 6, staleScans: 0, packed: true },
      }),
    ],
    removed: [],
    sheet: [],
    cancel: null,
    createdBy: 'u-1',
    createdAt: '2026-10-30T08:00:00.000Z',
    ...over,
  };
}


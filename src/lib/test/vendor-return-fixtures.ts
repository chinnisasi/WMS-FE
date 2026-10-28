/**
 * Story 2-8b — fixtures in the server's shapes (UUIDv7 ids, base-unit
 * numbers), shared by the RTV lib and component suites.
 */
import type { ReturnableArmDto, ReturnableSourceDto, VendorReturnDto, VendorReturnSummaryDto } from '@/lib/api/generated';

export const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
export const WH = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
export const CLIENT = '0198f7a2-1b3c-7d4e-8f90-0000000000c9';
export const VENDOR = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
export const VENDOR_B = '0198f7a2-1b3c-7d4e-8f90-0000000000a2';
export const TRANSPORTER = '0198f7a2-1b3c-7d4e-8f90-0000000000a7';
export const SKU_A = '0198f7a2-1b3c-7d4e-8f90-00000000005a';
export const SKU_K = '0198f7a2-1b3c-7d4e-8f90-00000000005b';
export const BATCH_1 = '0198f7a2-1b3c-7d4e-8f90-0000000000b1';
export const GRN_LINE_L = '0198f7a2-1b3c-7d4e-8f90-0000000000e1';
export const GRN_LINE_M = '0198f7a2-1b3c-7d4e-8f90-0000000000e2';
export const RTV_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000f1';

export function source(patch: Partial<ReturnableSourceDto> = {}): ReturnableSourceDto {
  return {
    kind: 'receipt-damage',
    grnLineId: GRN_LINE_L,
    grnId: '0198f7a2-1b3c-7d4e-8f90-0000000000d1',
    grnCode: 'GRN-0007',
    poCode: 'PO-1001',
    vendorId: VENDOR,
    vendorName: 'Acme Foods',
    reason: 'crushed carton',
    receiptDamagedQty: 3,
    qcFailedQty: 2,
    claimedQty: 0,
    claimableQty: 5,
    receivedAt: '2026-10-20T05:00:00.000Z',
    ...patch,
  };
}

/** SKU-A batch B1 (each): 10 on hand, 4 claimed by RTV-0002 → 6 available; one PO source of Acme. */
export function armA(patch: Partial<ReturnableArmDto> = {}): ReturnableArmDto {
  return {
    skuId: SKU_A,
    skuCode: 'SKU-A',
    skuName: 'Almond butter 200g',
    uom: 'each',
    uomPrecision: 0,
    batchId: BATCH_1,
    batchCode: 'B1',
    batchExpiry: '2027-03-31T18:30:00.000Z',
    onHand: 10,
    claimed: 4,
    claimedBy: ['RTV-0002'],
    available: 6,
    sources: [source()],
    ...patch,
  };
}

/** SKU-K (kg, untracked): 2.5 on hand, no claims, a QC-fail source of a blind receipt (any vendor). */
export function armK(patch: Partial<ReturnableArmDto> = {}): ReturnableArmDto {
  return {
    skuId: SKU_K,
    skuCode: 'SKU-K',
    skuName: 'Cashews loose',
    uom: 'kg',
    uomPrecision: 3,
    batchId: null,
    batchCode: null,
    batchExpiry: null,
    onHand: 2.5,
    claimed: 0,
    claimedBy: [],
    available: 2.5,
    sources: [
      source({
        kind: 'qc-fail',
        grnLineId: GRN_LINE_M,
        grnCode: 'GRN-0009',
        poCode: null,
        vendorId: null,
        vendorName: null,
        reason: 'mould',
        receiptDamagedQty: 0,
        qcFailedQty: 2.5,
        claimableQty: 2.5,
      }),
    ],
    ...patch,
  };
}

export const VENDOR_PARTNER = {
  id: VENDOR,
  tenantId: T,
  code: 'V-ACME',
  name: 'Acme Foods',
  legalName: 'Acme Foods Pvt Ltd',
  gstin: '27AAACA1234A1Z5',
  pan: null,
  roles: ['vendor' as const],
  registeredAddress: { line1: '1 Mill Road', line2: null, city: 'Pune', stateCode: '27', pincode: '411001' },
  dispatchAddress: null,
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  status: 'active' as const,
  inactiveReason: null,
  links: [{ id: 'l-1', clientId: CLIENT, role: 'vendor' as const, active: true, isDefault: true, clientCode: 'GLOW' }],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

export function vendorReturn(patch: Partial<VendorReturnDto> = {}): VendorReturnDto {
  return {
    id: RTV_ID,
    code: 'RTV-0001',
    status: 'draft',
    warehouseId: WH,
    warehouse: {
      code: 'BLR',
      name: 'Bengaluru DC',
      gstin: '29AAAAA0000A1Z5',
      originAddress: { contactName: 'Dock lead', phone: '9845012345', line1: '12 Hosur Road', line2: null, city: 'Bengaluru', state: 'Karnataka', pincode: '560068' },
      operatorName: 'Priya Logistics',
      frozen: false,
    },
    clientId: CLIENT,
    client: {
      v: 1,
      code: 'GLOW',
      name: 'GlowCo',
      legalName: 'GlowCo Consumer Pvt Ltd',
      gstin: '29GLOWC1234G1Z5',
      registeredAddress: { line1: '4 Brigade Road', line2: 'Floor 3', city: 'Bengaluru', stateCode: '29', pincode: '560001' },
    },
    vendorId: VENDOR,
    vendor: {
      v: 1,
      code: 'V-ACME',
      name: 'Acme Foods',
      legalName: 'Acme Foods Pvt Ltd',
      gstin: '27AAACA1234A1Z5',
      stateCode: '27',
      registeredAddress: { line1: '1 Mill Road', line2: null, city: 'Pune', stateCode: '27', pincode: '411001' },
      dispatchAddress: null,
    },
    consigneeAddressKind: 'registered',
    consigneeAddress: { line1: '1 Mill Road', line2: null, city: 'Pune', stateCode: '27', pincode: '411001' },
    note: null,
    created: { by: 'u-1', byName: 'Priya', at: '2026-10-20T05:00:00.000Z' },
    picked: null,
    dispatch: null,
    cancellation: null,
    lines: [
      {
        id: '0198f7a2-1b3c-7d4e-8f90-0000000001a1',
        lineNo: 1,
        skuId: SKU_A,
        skuCode: 'SKU-A',
        skuName: 'Almond butter 200g',
        hsn: '20081910',
        uom: 'each',
        batchId: BATCH_1,
        batchCode: 'B1',
        batchExpiry: '2027-03-31T18:30:00.000Z',
        reasonCode: 'damaged',
        quantity: 5,
        pickedQuantity: null,
        source: { grnLineId: GRN_LINE_L, grnId: '0198f7a2-1b3c-7d4e-8f90-0000000000d1', grnCode: 'GRN-0007', poCode: 'PO-1001' },
      },
      {
        id: '0198f7a2-1b3c-7d4e-8f90-0000000001a2',
        lineNo: 2,
        skuId: SKU_K,
        skuCode: 'SKU-K',
        skuName: 'Cashews loose',
        hsn: null,
        uom: 'kg',
        batchId: null,
        batchCode: null,
        batchExpiry: null,
        reasonCode: 'quality-failure',
        quantity: 1.25,
        pickedQuantity: null,
        source: null,
      },
    ],
    totalQuantity: 6.25,
    totalPickedQuantity: null,
    ...patch,
  };
}

export function pickedReturn(): VendorReturnDto {
  const base = vendorReturn();
  return {
    ...base,
    status: 'picked',
    picked: { by: 'u-op', byName: 'Ravi', at: '2026-10-21T06:00:00.000Z', deviceId: 'd-1' },
    lines: base.lines.map((line, i) => ({ ...line, pickedQuantity: i === 0 ? 5 : 0 })),
    totalPickedQuantity: 5,
  };
}

export function dispatchedReturn(): VendorReturnDto {
  const picked = pickedReturn();
  return {
    ...picked,
    status: 'dispatched',
    warehouse: { ...picked.warehouse, frozen: true },
    dispatch: {
      by: 'u-1',
      byName: 'Priya',
      at: '2026-10-22T08:00:00.000Z',
      brandDocument: { type: 'challan', number: 'CH-77', date: '2026-10-22' },
      consignorGstin: '29GLOWC1234G1Z5',
      debitNoteNumber: 'DN-9',
      ewayBill: { number: '123456789012', date: '2026-10-22', validUntil: '2026-10-24' },
      transporterId: TRANSPORTER,
      transporter: { v: 1, code: 'TR-VRL', name: 'VRL Logistics', legalName: null, gstin: null, stateCode: null, registeredAddress: null, dispatchAddress: null },
      carrierName: null,
      vehicleNumber: 'KA01AB1234',
      trackingRef: 'AWB1234',
      packageCount: 1,
    },
  };
}

export function summaryOf(rtv: VendorReturnDto): VendorReturnSummaryDto {
  return {
    id: rtv.id,
    code: rtv.code,
    status: rtv.status,
    warehouseId: rtv.warehouseId,
    clientId: rtv.clientId,
    clientCode: rtv.client.code,
    clientName: rtv.client.name,
    vendorId: rtv.vendorId,
    vendorName: rtv.vendor.name,
    lineCount: rtv.lines.length,
    totalQuantity: rtv.totalQuantity,
    totalPickedQuantity: rtv.totalPickedQuantity,
    trackingRef: rtv.dispatch?.trackingRef ?? null,
    brandDocumentNumber: rtv.dispatch?.brandDocument.number ?? null,
    createdAt: rtv.created.at,
    pickedAt: rtv.picked?.at ?? null,
    dispatchedAt: rtv.dispatch?.at ?? null,
    cancelledAt: rtv.cancellation?.at ?? null,
  };
}

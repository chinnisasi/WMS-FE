/**
 * Story 4-7c — fixtures in the server's shapes (UUIDv7 ids, base-unit
 * numbers), shared by the RTC lib and component suites.
 */
import type {
  AwaitingDispositionDto,
  ClientDto,
  ClientReturnDto,
  ClientReturnSummaryDto,
  ReturnableToClientArmDto,
} from '@/lib/api/generated';

export const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
export const WH = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
export const CLIENT = '0198f7a2-1b3c-7d4e-8f90-0000000000c9';
export const CLIENT_B = '0198f7a2-1b3c-7d4e-8f90-0000000000ca';
export const TRANSPORTER = '0198f7a2-1b3c-7d4e-8f90-0000000000a7';
export const SKU_A = '0198f7a2-1b3c-7d4e-8f90-00000000005a';
export const SKU_D = '0198f7a2-1b3c-7d4e-8f90-00000000005d';
export const BATCH_1 = '0198f7a2-1b3c-7d4e-8f90-0000000000b1';
export const RRL_1 = '0198f7a2-1b3c-7d4e-8f90-0000000002a1';
export const RRL_2 = '0198f7a2-1b3c-7d4e-8f90-0000000002a2';
export const RRL_SERIAL = '0198f7a2-1b3c-7d4e-8f90-0000000002a3';
export const RTC_ID = '0198f7a2-1b3c-7d4e-8f90-0000000003f1';

/** A receipt line of RMA-0003 awaiting a decision: 4 of SKU-A batch B1, received resaleable. */
export function awaitingLine(patch: Partial<AwaitingDispositionDto> = {}): AwaitingDispositionDto {
  return {
    receiptLineId: RRL_1,
    receiptCode: 'RRN-0003',
    receivedAt: '2026-10-20T04:30:00.000Z',
    rmaId: '0198f7a2-1b3c-7d4e-8f90-0000000004a1',
    rmaCode: 'RMA-0003',
    orderReference: 'SHOP-1001',
    clientId: CLIENT,
    warehouseId: WH,
    skuId: SKU_A,
    skuCode: 'SKU-A',
    skuName: 'Almond butter 200g',
    uom: 'each',
    condition: 'resaleable',
    note: null,
    batchCode: 'B1',
    serialNumber: null,
    weightGrams: null,
    receivedQty: 4,
    openQty: 4,
    onHoldQty: 0,
    priorQuarantines: 0,
    lastReasonCode: null,
    ...patch,
  };
}

/** SKU-D (each, untracked) in DAMAGED: 3 on hand, 1 claimed by RTV-0002 → 2 available. */
export function damagedArm(patch: Partial<ReturnableToClientArmDto> = {}): ReturnableToClientArmDto {
  return {
    skuId: SKU_D,
    skuCode: 'SKU-D',
    skuName: 'Dented tin',
    uom: 'each',
    uomPrecision: 0,
    batchId: null,
    batchCode: null,
    batchExpiry: null,
    onHand: 3,
    claimedRtv: 1,
    claimedRtc: 0,
    claimedBy: ['RTV-0002'],
    available: 2,
    ...patch,
  };
}

/** The client master row (both addresses on file, active). */
export function glowClient(patch: Partial<ClientDto> = {}): ClientDto {
  return {
    id: CLIENT,
    tenantId: T,
    code: 'GLOW',
    name: 'GlowCo',
    status: 'active',
    systemOwned: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    taxDetails: { legalName: 'GlowCo Consumer Pvt Ltd', gstin: '29GLOWC1234G1Z5', pan: null },
    registeredAddress: { line1: '4 Brigade Road', line2: 'Floor 3', city: 'Bengaluru', stateCode: '29', pincode: '560001' },
    returnAddress: { contactName: 'Returns desk', phone: '9845000000', line1: '9 Peenya Ind. Area', line2: null, city: 'Bengaluru', state: 'Karnataka', pincode: '560058' },
    ...patch,
  } as ClientDto;
}

export function clientReturn(patch: Partial<ClientReturnDto> = {}): ClientReturnDto {
  return {
    id: RTC_ID,
    code: 'RTC-0001',
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
    consigneeAddressKind: 'return',
    consigneeAddress: {
      kind: 'return',
      contactName: 'Returns desk',
      phone: '9845000000',
      line1: '9 Peenya Ind. Area',
      line2: null,
      city: 'Bengaluru',
      state: 'Karnataka',
      stateCode: null,
      pincode: '560058',
    },
    note: null,
    created: { by: 'u-1', byName: 'Priya', at: '2026-10-20T05:00:00.000Z' },
    picked: null,
    dispatch: null,
    cancellation: null,
    lines: [
      {
        id: '0198f7a2-1b3c-7d4e-8f90-0000000003b1',
        lineNo: 1,
        source: 'returns',
        skuId: SKU_A,
        skuCode: 'SKU-A',
        skuName: 'Almond butter 200g',
        hsn: '20081910',
        uom: 'each',
        batchId: BATCH_1,
        batchCode: 'B1',
        batchExpiry: null,
        serialId: null,
        serialNumber: null,
        returnReceiptLineId: RRL_1,
        rmaId: '0198f7a2-1b3c-7d4e-8f90-0000000004a1',
        rmaCode: 'RMA-0003',
        orderReference: 'SHOP-1001',
        condition: 'opened',
        reasonCode: 'client-instruction',
        quantity: 4,
        pickedQuantity: null,
      },
      {
        id: '0198f7a2-1b3c-7d4e-8f90-0000000003b2',
        lineNo: 2,
        source: 'damaged',
        skuId: SKU_D,
        skuCode: 'SKU-D',
        skuName: 'Dented tin',
        hsn: null,
        uom: 'each',
        batchId: null,
        batchCode: null,
        batchExpiry: null,
        serialId: null,
        serialNumber: null,
        returnReceiptLineId: null,
        rmaId: null,
        rmaCode: null,
        orderReference: null,
        condition: null,
        reasonCode: 'damaged',
        quantity: 3,
        pickedQuantity: null,
      },
    ],
    totalQuantity: 7,
    totalPickedQuantity: null,
    ...patch,
  };
}

/** Picked: the returns line 3 of 4 (short), the damaged line whole. */
export function pickedClientReturn(): ClientReturnDto {
  const base = clientReturn();
  return {
    ...base,
    status: 'picked',
    picked: { by: 'u-op', byName: 'Ravi', at: '2026-10-21T06:00:00.000Z', deviceId: 'd-1' },
    lines: base.lines.map((line, i) => ({ ...line, pickedQuantity: i === 0 ? 3 : 3 })),
    totalPickedQuantity: 6,
  };
}

export function dispatchedClientReturn(): ClientReturnDto {
  const picked = pickedClientReturn();
  return {
    ...picked,
    status: 'dispatched',
    warehouse: { ...picked.warehouse, frozen: true },
    dispatch: {
      by: 'u-1',
      byName: 'Priya',
      at: '2026-10-22T08:00:00.000Z',
      brandDocument: { type: 'challan', number: 'CH-9', date: '2026-10-22' },
      consignorGstin: '29GLOWC1234G1Z5',
      consigneeGstin: null,
      declaredValuePaise: 1250050,
      ewayBill: null,
      transporterId: TRANSPORTER,
      transporter: { v: 1, code: 'TR-VRL', name: 'VRL Logistics', legalName: null, gstin: null, stateCode: null, registeredAddress: null, dispatchAddress: null },
      carrierName: null,
      vehicleNumber: null,
      trackingRef: '777',
      packageCount: 2,
    },
  };
}

export function rtcSummaryOf(rtc: ClientReturnDto): ClientReturnSummaryDto {
  return {
    id: rtc.id,
    code: rtc.code,
    status: rtc.status,
    warehouseId: rtc.warehouseId,
    clientId: rtc.clientId,
    clientCode: rtc.client.code,
    clientName: rtc.client.name,
    consigneeAddressKind: rtc.consigneeAddressKind,
    lineCount: rtc.lines.length,
    totalQuantity: rtc.totalQuantity,
    totalPickedQuantity: rtc.totalPickedQuantity,
    trackingRef: rtc.dispatch?.trackingRef ?? null,
    brandDocumentNumber: rtc.dispatch?.brandDocument.number ?? null,
    createdAt: rtc.created.at,
    pickedAt: rtc.picked?.at ?? null,
    dispatchedAt: rtc.dispatch?.at ?? null,
    cancelledAt: rtc.cancellation?.at ?? null,
  };
}

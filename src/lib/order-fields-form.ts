import { parseRupees } from '@/lib/rupees';
import { codAmountProblem, parseShipByDate } from '@/lib/order-fields';

/**
 * Story 4-2a — the order-fields part of a create form (staff and portal):
 * the draft as typed, and the parse that turns it into body keys BEFORE any
 * Idempotency-Key is minted, so a value the server would refuse is never
 * sent. Pure (no hook), so the portal may use it (`lib/portal-boundary`).
 *
 * Every key is sent ONLY when the viewer chose it — the backend hashes a field
 * as sent, so an untouched form keeps the pre-4-2a request bytes:
 *   - type: '' is "derive it" (B2B with a buyer GSTIN, else B2C);
 *   - priority: '' is the default (normal), never sent as 'normal';
 *   - ship-by: blank is none;
 *   - COD: unticked is prepaid; ticked needs an amount (rupees → paise).
 */
export interface OrderFieldsDraft {
  readonly orderType: '' | 'b2b' | 'b2c';
  readonly priority: '' | 'high' | 'urgent';
  readonly shipByDate: string;
  readonly cod: boolean;
  readonly codRupees: string;
}

export function emptyOrderFieldsDraft(): OrderFieldsDraft {
  return { orderType: '', priority: '', shipByDate: '', cod: false, codRupees: '' };
}

export interface OrderFieldsBody {
  orderType?: 'b2b' | 'b2c';
  priority?: 'high' | 'urgent';
  shipByDate?: string;
  codAmountPaise?: number;
}

/**
 * The draft → body keys, or the first problem. `hasBuyerGstin` is whether the
 * create sends a consignee GSTIN (an explicit B2C beside one is a 400).
 * `surface: 'portal'` refuses Urgent (the warehouse sets it — A12).
 */
export function parseOrderFieldsDraft(
  draft: OrderFieldsDraft,
  context: { readonly todayIst: string; readonly hasBuyerGstin: boolean; readonly surface: 'staff' | 'portal' },
): { body: OrderFieldsBody; problem: null } | { body: null; problem: string } {
  const body: OrderFieldsBody = {};
  if (draft.orderType !== '') {
    if (draft.orderType === 'b2c' && context.hasBuyerGstin) {
      return { body: null, problem: 'A buyer with a GSTIN is a business — choose B2B, or leave the type to be derived.' };
    }
    body.orderType = draft.orderType;
  }
  if (draft.priority !== '') {
    if (draft.priority === 'urgent' && context.surface === 'portal') {
      return { body: null, problem: 'Urgent priority is set by the warehouse — choose Normal or High.' };
    }
    body.priority = draft.priority;
  }
  const shipBy = parseShipByDate(draft.shipByDate, context.todayIst);
  if ('problem' in shipBy) return { body: null, problem: shipBy.problem };
  if (shipBy.date !== null) body.shipByDate = shipBy.date;
  if (draft.cod) {
    if (draft.codRupees.trim() === '') return { body: null, problem: 'Enter the amount to collect on delivery.' };
    const rupees = parseRupees(draft.codRupees);
    if ('problem' in rupees) return { body: null, problem: `Amount to collect: ${rupees.problem}` };
    const problem = codAmountProblem(rupees.paise);
    if (problem !== null) return { body: null, problem };
    body.codAmountPaise = rupees.paise;
  }
  return { body, problem: null };
}

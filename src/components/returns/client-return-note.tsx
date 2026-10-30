import type { ClientReturnDto } from '@/lib/api/generated';
import { clientReturnNoteModel } from '@/lib/client-returns';

import { ReturnDispatchNote } from '@/components/shared/return-dispatch-note';

/**
 * Story 4-7c (decision 14, A2, A9) — the printable "Return to Client —
 * Dispatch Note": 2-8b's shared note over the RTC's frozen values
 * (`clientReturnNoteModel`). Once dispatched it prints three copies
 * (Consignee / Transporter / Warehouse) of the shipped lines; before, a pick
 * list watermarked "DRAFT — not dispatched".
 */
export function ClientReturnNote({
  rtc,
  precisionOf,
}: {
  readonly rtc: ClientReturnDto;
  readonly precisionOf?: (skuId: string) => number | null;
}) {
  return <ReturnDispatchNote model={clientReturnNoteModel(rtc, precisionOf)} ariaLabel={`Dispatch note ${rtc.code}`} />;
}

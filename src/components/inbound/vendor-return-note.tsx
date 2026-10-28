import type { VendorReturnDto } from '@/lib/api/generated';
import { vendorReturnNoteModel } from '@/lib/vendor-returns';

import { ReturnDispatchNote } from '@/components/shared/return-dispatch-note';

/**
 * Story 2-8b (decision 10, A6, A7) — the printable "Return to Vendor —
 * Dispatch Note": the shared note (`components/shared/return-dispatch-note`)
 * over the RTV's frozen values (`vendorReturnNoteModel`). Once dispatched it
 * prints three copies (Vendor / Transporter / Warehouse) of the shipped
 * lines; before, a pick list watermarked "DRAFT — not dispatched".
 * `precisionOf` renders each line at its unit's declared precision when the
 * SKU is known (grouping only otherwise — never rounded).
 */
export function VendorReturnNote({
  rtv,
  precisionOf,
}: {
  readonly rtv: VendorReturnDto;
  readonly precisionOf?: (skuId: string) => number | null;
}) {
  return <ReturnDispatchNote model={vendorReturnNoteModel(rtv, precisionOf)} ariaLabel={`Dispatch note ${rtv.code}`} />;
}

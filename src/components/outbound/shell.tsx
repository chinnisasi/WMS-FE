'use client';

/**
 * What the Outbound surfaces share.
 *
 * Orders (4.2b) and waves (4.2c) each used to carry their own byte-identical
 * `Shell`, `ReadFailure` and six class constants — and, worse, their own
 * `useOutboundWarehouses()` call and their own `<select>`, so `/outbound`
 * rendered TWO warehouse pickers, walked the warehouse cursor chain twice per
 * load, and let a viewer read orders for one warehouse beside waves for
 * another with nothing on screen saying so.
 *
 * The warehouse is now resolved ONCE, by `outbound.tsx`, and passed in. This
 * file holds only what both surfaces draw with; each keeps its own data hooks,
 * its own capability and its own section.
 *
 * Story 21-11b moved the primitives themselves to `components/shared/surface.tsx`
 * so the client portal can draw with them without importing an operator
 * module. They are re-exported here, so this file's operator importers are
 * unchanged.
 */

export {
  buttonClass,
  inputClass,
  labelClass,
  primaryClass,
  ReadFailure,
  rowButtonClass,
  Section,
  selectClass,
} from '@/components/shared/surface';

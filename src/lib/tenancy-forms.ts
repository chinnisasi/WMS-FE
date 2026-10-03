import type { CreateWarehouseDto, RegisterTenantDto, WarehouseResponse } from '@/lib/api/generated';
import { parseGstinField } from '@/lib/gstin';
import { parseDestinationFields, type DestinationFields } from '@/lib/outbound-orders';

/**
 * The registration and warehouse-create request bodies (story 8-1c), built
 * from the parsed fields. Pure so they can be pinned without an App Router —
 * `RegisterForm` calls `useRouter()` and cannot render under `bun test` —
 * and so the "build the body from the parse" rule lives in one place: a
 * blank GSTIN is omitted from the body, never sent as `''`.
 */

export type BodyOrProblem<T> = { readonly body: T } | { readonly problem: string };

export function registerTenantBody(input: {
  readonly name: string;
  readonly ownerEmail: string;
  readonly password: string;
  readonly gstinText: string;
}): BodyOrProblem<RegisterTenantDto> {
  const gstin = parseGstinField(input.gstinText, 'Business GSTIN');
  if (gstin.problem !== null) return { problem: gstin.problem };
  return {
    body: {
      name: input.name,
      ownerEmail: input.ownerEmail,
      password: input.password,
      ...(gstin.gstin === undefined ? {} : { gstin: gstin.gstin }),
    },
  };
}

/**
 * Address first, then GSTIN — the order form's refusal order (lines →
 * address → GSTIN), so a form with two problems names the same one first on
 * either surface.
 */
export function warehouseBody(input: {
  readonly code: string;
  readonly name: string;
  readonly origin: DestinationFields;
  readonly gstinText: string;
}): BodyOrProblem<CreateWarehouseDto> {
  const address = parseDestinationFields(input.origin, 'origin');
  if (address.problem !== null) return { problem: address.problem };
  const gstin = parseGstinField(input.gstinText, 'Warehouse GSTIN');
  if (gstin.problem !== null) return { problem: gstin.problem };
  return {
    body: {
      code: input.code,
      name: input.name,
      origin: address.destination!,
      ...(gstin.gstin === undefined ? {} : { gstin: gstin.gstin }),
    },
  };
}

/**
 * The warehouse-created banner. It echoes the GSTIN the server STORED (the
 * response, never the request) when there is one, because it cannot be
 * changed afterwards — the viewer should see exactly what was kept.
 */
export function warehouseCreatedReason(
  warehouse: Pick<WarehouseResponse, 'code' | 'name' | 'gstin'>,
): string {
  const base = `${warehouse.code} ${warehouse.name} now appears in the sidebar switcher.`;
  return warehouse.gstin === null || warehouse.gstin === undefined
    ? base
    : `${base} GSTIN ${warehouse.gstin} — can't be changed later.`;
}

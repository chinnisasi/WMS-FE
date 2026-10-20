import type { CreateSkuDto, PatchSkuDto, SkuResponse } from '@/lib/api/generated';

/**
 * Story 1-6a — the SKU goods-type attributes on the web: the vocabulary
 * mirrors (the backend's `shared/primitives/goods-type.ts` tuples — its
 * `@IsIn` and DB CHECKs are the boundary), the labels, the handling badges,
 * and the edit and create forms' pure decisions (dependent resets, the DG →
 * hazard derivation the form shows before saving, the changed-only PATCH).
 *
 * The generated types drop `| null` on the nullable enums (the KNOWN-BAD
 * vendor behaviour — `sku-table.tsx`'s cast pattern); every read here treats
 * them as nullable, and a missing key as its default (a response replayed
 * from before 1-6a, or a hand-built fixture).
 */

export const DRUG_SCHEDULES = ['G', 'H', 'H1', 'X', 'C', 'C1', 'NDPS'] as const;

export const ALLERGENS = [
  'gluten-cereals',
  'crustaceans',
  'milk',
  'eggs',
  'fish',
  'peanuts',
  'tree-nuts',
  'soybean',
  'sulphite',
] as const;

export const FOOD_CATEGORIES = [
  'dairy',
  'meat-poultry-seafood',
  'fresh-produce',
  'bakery-cereals',
  'ready-to-eat',
  'beverages',
  'oils-fats',
  'spices-condiments',
  'confectionery',
  'packaged-dry-grocery',
  'infant-food',
  'other-food',
  'non-food',
] as const;

export const NON_FOOD = 'non-food';

export const DG_CLASSES = [
  '1.1',
  '1.2',
  '1.3',
  '1.4',
  '1.5',
  '1.6',
  '2.1',
  '2.2',
  '2.3',
  '3',
  '4.1',
  '4.2',
  '4.3',
  '5.1',
  '5.2',
  '6.1',
  '6.2',
  '7',
  '8',
  '9',
] as const;

export const DG_PACKING_GROUPS = ['I', 'II', 'III'] as const;

/** The classes that take no packing group (the packing-group select offers nothing for them). */
export const DG_CLASSES_WITHOUT_PACKING_GROUP: readonly string[] = [
  '1.1',
  '1.2',
  '1.3',
  '1.4',
  '1.5',
  '1.6',
  '2.1',
  '2.2',
  '2.3',
  '5.2',
  '6.2',
  '7',
];

/** Decision 3 — the hazard class a primary DG class sets. Class 8 chooses; the rest derive nothing. */
export const DG_HAZARD_MAP: Readonly<Record<string, string>> = {
  '1.1': 'explosive',
  '1.2': 'explosive',
  '1.3': 'explosive',
  '1.4': 'explosive',
  '1.5': 'explosive',
  '1.6': 'explosive',
  '2.1': 'gas',
  '2.2': 'gas',
  '2.3': 'gas',
  '3': 'flammable',
  '5.1': 'oxidizer',
  '6.1': 'toxic',
};

export const CORROSIVE_CLASS = '8';
export const CORROSIVE_HAZARDS = ['corrosive-acid', 'corrosive-base'] as const;
/** The class-8 hazard select's explicit "none" (null on the wire), distinct from its empty "choose" option. */
export const HAZARD_NONE = 'none';

export const MAX_STACK_LAYERS = 100;
export const MAX_DG_SUBSIDIARY_CLASSES = 2;

export const FOOD_CATEGORY_LABEL: Readonly<Record<(typeof FOOD_CATEGORIES)[number], string>> = {
  dairy: 'Dairy',
  'meat-poultry-seafood': 'Meat, poultry & seafood',
  'fresh-produce': 'Fresh produce',
  'bakery-cereals': 'Bakery & cereals',
  'ready-to-eat': 'Ready to eat',
  beverages: 'Beverages',
  'oils-fats': 'Oils & fats',
  'spices-condiments': 'Spices & condiments',
  confectionery: 'Confectionery',
  'packaged-dry-grocery': 'Packaged dry grocery',
  'infant-food': 'Infant food',
  'other-food': 'Other food',
  'non-food': 'Not food',
};

export const ALLERGEN_LABEL: Readonly<Record<(typeof ALLERGENS)[number], string>> = {
  'gluten-cereals': 'Cereals with gluten',
  crustaceans: 'Crustaceans',
  milk: 'Milk',
  eggs: 'Eggs',
  fish: 'Fish',
  peanuts: 'Peanuts',
  'tree-nuts': 'Tree nuts',
  soybean: 'Soybean',
  sulphite: 'Sulphite',
};

export function drugScheduleLabel(schedule: string): string {
  return schedule === 'NDPS' ? 'NDPS' : `Schedule ${schedule}`;
}

/** The goods-type fields a SKU (or a fixture) carries; any key may be missing. */
export type GoodsTypeView = Partial<
  Pick<
    SkuResponse,
    | 'drugSchedules'
    | 'allergens'
    | 'dgSubsidiaryClasses'
    | 'dgUnNumber'
    | 'highValue'
    | 'fragile'
    | 'maxStackLayers'
  >
> & {
  readonly foodCategory?: string | null;
  readonly dgClass?: string | null;
  readonly dgPackingGroup?: string | null;
};

/** "DG 3 (6.1) · UN1230 · PG II" — null when the SKU is not a dangerous good. */
export function dgBadge(sku: GoodsTypeView): string | null {
  const dgClass = sku.dgClass ?? null;
  const un = sku.dgUnNumber ?? null;
  if (dgClass === null || un === null) return null;
  const subs = sku.dgSubsidiaryClasses ?? [];
  const pg = sku.dgPackingGroup ?? null;
  return [`DG ${dgClass}${subs.length === 0 ? '' : ` (${subs.join(', ')})`}`, `UN${un}`, ...(pg === null ? [] : [`PG ${pg}`])].join(' · ');
}

/** "Do not stack" for 1, "Stacks ≤ n" above, null when unset. */
export function stackBadge(sku: GoodsTypeView): string | null {
  const layers = sku.maxStackLayers ?? null;
  if (layers === null) return null;
  return layers === 1 ? 'Do not stack' : `Stacks ≤ ${layers}`;
}

/**
 * The handling warnings, in a fixed order: Fragile, High value, the DG
 * badge, the stack limit. Empty when there is nothing to warn about.
 */
export function handlingBadges(sku: GoodsTypeView | null | undefined): string[] {
  if (sku === null || sku === undefined) return [];
  const badges: string[] = [];
  if (sku.fragile === true) badges.push('Fragile');
  if (sku.highValue === true) badges.push('High value');
  const dg = dgBadge(sku);
  if (dg !== null) badges.push(dg);
  const stack = stackBadge(sku);
  if (stack !== null) badges.push(stack);
  return badges;
}

/** The SKU table's Handling cell: the badges joined, or the house em-dash. */
export function handlingCell(sku: GoodsTypeView): string {
  const badges = handlingBadges(sku);
  return badges.length === 0 ? '—' : badges.join(' · ');
}

// ── the forms ────────────────────────────────────────────────────────────────

/** The goods-type fields as a form holds them (strings until submit; '' = unset). */
export interface GoodsTypeDraft {
  readonly drugSchedules: readonly string[];
  readonly foodCategory: string;
  readonly allergens: readonly string[];
  readonly dgUnNumber: string;
  readonly dgClass: string;
  readonly dgSubsidiaryClasses: readonly string[];
  readonly dgPackingGroup: string;
  readonly highValue: boolean;
  readonly fragile: boolean;
  readonly maxStackLayers: string;
}

export function emptyGoodsTypeDraft(): GoodsTypeDraft {
  return {
    drugSchedules: [],
    foodCategory: '',
    allergens: [],
    dgUnNumber: '',
    dgClass: '',
    dgSubsidiaryClasses: [],
    dgPackingGroup: '',
    highValue: false,
    fragile: false,
    maxStackLayers: '',
  };
}

export function goodsTypeDraftOf(sku: GoodsTypeView): GoodsTypeDraft {
  return {
    drugSchedules: [...(sku.drugSchedules ?? [])],
    foodCategory: sku.foodCategory ?? '',
    allergens: [...(sku.allergens ?? [])],
    dgUnNumber: sku.dgUnNumber ?? '',
    dgClass: sku.dgClass ?? '',
    dgSubsidiaryClasses: [...(sku.dgSubsidiaryClasses ?? [])],
    dgPackingGroup: sku.dgPackingGroup ?? '',
    highValue: sku.highValue ?? false,
    fragile: sku.fragile ?? false,
    maxStackLayers: sku.maxStackLayers === null || sku.maxStackLayers === undefined ? '' : String(sku.maxStackLayers),
  };
}

/** Allergens need a food category that is set and is not non-food. */
export function allergensAllowed(draft: GoodsTypeDraft): boolean {
  return draft.foodCategory !== '' && draft.foodCategory !== NON_FOOD;
}

/** The allergens group's hint while it is disabled, or null when it is enabled. */
export function allergensHint(draft: GoodsTypeDraft): string | null {
  if (draft.foodCategory === '') return 'Choose a food category to declare allergens.';
  if (draft.foodCategory === NON_FOOD) return 'A non-food SKU carries no allergens.';
  return null;
}

/** Whether the packing-group select offers anything for this class. */
export function takesPackingGroup(dgClass: string): boolean {
  return dgClass !== '' && !DG_CLASSES_WITHOUT_PACKING_GROUP.includes(dgClass);
}

/** A food category pick: empty or non-food clears the allergens. */
export function withFoodCategory(draft: GoodsTypeDraft, foodCategory: string): GoodsTypeDraft {
  const next = { ...draft, foodCategory };
  return allergensAllowed(next) ? next : { ...next, allergens: [] };
}

/**
 * A DG class pick: clearing it clears the UN number, the subsidiaries and the
 * packing group; a class without a packing group drops it; a subsidiary
 * equal to the new primary is dropped.
 */
export function withDgClass(draft: GoodsTypeDraft, dgClass: string): GoodsTypeDraft {
  if (dgClass === '') {
    return { ...draft, dgClass, dgUnNumber: '', dgSubsidiaryClasses: [], dgPackingGroup: '' };
  }
  return {
    ...draft,
    dgClass,
    dgPackingGroup: takesPackingGroup(dgClass) ? draft.dgPackingGroup : '',
    dgSubsidiaryClasses: draft.dgSubsidiaryClasses.filter((entry) => entry !== dgClass),
  };
}

/** Toggle one entry of a checkbox group, kept sorted. */
export function toggled(list: readonly string[], value: string, on: boolean): string[] {
  const set = new Set(list);
  if (on) set.add(value);
  else set.delete(value);
  return [...set].sort();
}

/**
 * Decision 7 as the hazard select sees it, for the RESULTING DG class:
 * - `derived` — a mapped class sets the hazard; the select is disabled
 *   showing it, with the hint "Set by DG class 3";
 * - `corrosive` — class 8 offers acid, base or none, nothing else;
 * - `free` — as before 1-6a: any class, or "No rule".
 */
export type HazardControl =
  | { readonly kind: 'derived'; readonly value: string; readonly hint: string }
  | { readonly kind: 'corrosive' }
  | { readonly kind: 'free' };

export function hazardControl(dgClass: string): HazardControl {
  const mapped = DG_HAZARD_MAP[dgClass];
  if (mapped !== undefined) return { kind: 'derived', value: mapped, hint: `Set by DG class ${dgClass}` };
  if (dgClass === CORROSIVE_CLASS) return { kind: 'corrosive' };
  return { kind: 'free' };
}

/**
 * The hazard select's value when the DG class moves to `dgClass`. Class 8
 * starts on the stored corrosive, on "none" when the SKU already is class 8
 * with none (its stored choice), else on the empty "choose" option. A free
 * class re-shows the STORED hazard (decision 7 keeps it). A derived class's
 * select is disabled; its value is the derived one.
 */
export function hazardSelectFor(
  dgClass: string,
  stored: { readonly dgClass: string; readonly hazardClass: string },
): string {
  const control = hazardControl(dgClass);
  if (control.kind === 'derived') return control.value;
  if (control.kind === 'corrosive') {
    if ((CORROSIVE_HAZARDS as readonly string[]).includes(stored.hazardClass)) return stored.hazardClass;
    if (stored.dgClass === CORROSIVE_CLASS && stored.hazardClass === '') return HAZARD_NONE;
    return '';
  }
  return stored.hazardClass;
}

/**
 * The hazard key a save sends, from the select's value: `undefined` (omit —
 * the server keeps or derives it), a class, `null` (none / no rule), or a
 * problem keeping the form unsent.
 * - derived: omitted — the server derives it (and the form already showed it);
 * - corrosive: "choose" is refused; acid, base or none are sent whenever they
 *   differ from the stored hazard OR the SKU is moving into class 8 (a stored
 *   null hazard moving into 8 must still name "none", or the server answers
 *   dg-hazard-required);
 * - free: the class, '' = null, sent only when it differs from the stored one.
 */
export function hazardToSend(
  dgClass: string,
  select: string,
  stored: { readonly dgClass: string; readonly hazardClass: string },
): { readonly value: string | null | undefined; readonly problem: string | null } {
  const control = hazardControl(dgClass);
  if (control.kind === 'derived') return { value: undefined, problem: null };
  if (control.kind === 'corrosive') {
    if (select === '') {
      return { value: undefined, problem: 'DG class 8 needs its hazard class — choose corrosive acid, corrosive base or none.' };
    }
    const next = select === HAZARD_NONE ? null : select;
    const changed = (next ?? '') !== stored.hazardClass || stored.dgClass !== CORROSIVE_CLASS;
    return { value: changed ? next : undefined, problem: null };
  }
  if (select === stored.hazardClass) return { value: undefined, problem: null };
  return { value: select === '' ? null : select, problem: null };
}

const UN_INPUT = /^(UN)?\d{4}$/i;

/** `UN1203` / `un1203` / `1203` → `1203`; '' stays ''. */
export function canonicalUnNumber(raw: string): string {
  const trimmed = raw.trim();
  return UN_INPUT.test(trimmed) ? trimmed.slice(-4) : trimmed;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((value, i) => value === y[i]);
}

/** The goods-type keys of a PATCH or create body. */
export type GoodsTypeBody = Pick<
  PatchSkuDto,
  | 'drugSchedules'
  | 'foodCategory'
  | 'allergens'
  | 'dgUnNumber'
  | 'dgClass'
  | 'dgSubsidiaryClasses'
  | 'dgPackingGroup'
  | 'highValue'
  | 'fragile'
  | 'maxStackLayers'
>;

/** The draft's values as the wire carries them, or the sentence keeping the form unsent. */
function parsedDraft(draft: GoodsTypeDraft):
  | { readonly ok: true; readonly unNumber: string | null; readonly stack: number | null }
  | { readonly ok: false; readonly problem: string } {
  const un = draft.dgUnNumber.trim();
  if (un !== '' && !UN_INPUT.test(un)) return { ok: false, problem: 'UN number must be four digits, e.g. 1203 or UN1203.' };
  if (draft.dgClass !== '' && un === '') return { ok: false, problem: 'A dangerous good needs its UN number.' };
  if (draft.dgClass === '' && un !== '') return { ok: false, problem: 'A UN number needs its DG class.' };
  const stackRaw = draft.maxStackLayers.trim();
  if (stackRaw !== '' && (!/^\d+$/.test(stackRaw) || Number(stackRaw) < 1 || Number(stackRaw) > MAX_STACK_LAYERS)) {
    return { ok: false, problem: `Stack limit must be a whole number from 1 to ${MAX_STACK_LAYERS} (1 = do not stack).` };
  }
  if (draft.dgSubsidiaryClasses.length > MAX_DG_SUBSIDIARY_CLASSES) {
    return { ok: false, problem: `A dangerous good takes at most ${MAX_DG_SUBSIDIARY_CLASSES} subsidiary classes.` };
  }
  return { ok: true, unNumber: un === '' ? null : canonicalUnNumber(un), stack: stackRaw === '' ? null : Number(stackRaw) };
}

/**
 * The edit PATCH's goods-type keys: ONLY the fields that changed. Arrays
 * compare as sorted sets, the UN number without its prefix, '' and null as
 * equal. The casts answer the generated types dropping `| null` on the
 * nullable enums (the clear verb rides as null).
 */
export function goodsTypePatch(
  sku: GoodsTypeView,
  draft: GoodsTypeDraft,
): { readonly body: GoodsTypeBody; readonly problem: string | null } {
  const parsed = parsedDraft(draft);
  if (!parsed.ok) return { body: {}, problem: parsed.problem };
  const current = goodsTypeDraftOf(sku);
  const body: Record<string, unknown> = {};
  if (!sameSet(draft.drugSchedules, current.drugSchedules)) body['drugSchedules'] = [...draft.drugSchedules].sort();
  if (draft.foodCategory !== current.foodCategory) body['foodCategory'] = draft.foodCategory === '' ? null : draft.foodCategory;
  if (!sameSet(draft.allergens, current.allergens)) body['allergens'] = [...draft.allergens].sort();
  if ((parsed.unNumber ?? '') !== canonicalUnNumber(current.dgUnNumber)) body['dgUnNumber'] = parsed.unNumber;
  if (draft.dgClass !== current.dgClass) body['dgClass'] = draft.dgClass === '' ? null : draft.dgClass;
  if (!sameSet(draft.dgSubsidiaryClasses, current.dgSubsidiaryClasses)) {
    body['dgSubsidiaryClasses'] = [...draft.dgSubsidiaryClasses].sort();
  }
  if (draft.dgPackingGroup !== current.dgPackingGroup) body['dgPackingGroup'] = draft.dgPackingGroup === '' ? null : draft.dgPackingGroup;
  if (draft.highValue !== current.highValue) body['highValue'] = draft.highValue;
  if (draft.fragile !== current.fragile) body['fragile'] = draft.fragile;
  if ((parsed.stack === null ? '' : String(parsed.stack)) !== current.maxStackLayers) body['maxStackLayers'] = parsed.stack;
  return { body: body as GoodsTypeBody, problem: null };
}

/**
 * The create body's goods-type keys: `highValue` and `fragile` always sent
 * (like `batchTracked`); blank nullables and empty arrays dropped (like
 * `hazardClass`).
 */
export function goodsTypeCreateFields(
  draft: GoodsTypeDraft,
): { readonly body: Pick<CreateSkuDto, keyof GoodsTypeBody>; readonly problem: string | null } {
  const parsed = parsedDraft(draft);
  if (!parsed.ok) return { body: {}, problem: parsed.problem };
  const body: Record<string, unknown> = {};
  if (draft.drugSchedules.length > 0) body['drugSchedules'] = [...draft.drugSchedules].sort();
  if (draft.foodCategory !== '') body['foodCategory'] = draft.foodCategory;
  if (draft.allergens.length > 0) body['allergens'] = [...draft.allergens].sort();
  if (parsed.unNumber !== null) body['dgUnNumber'] = parsed.unNumber;
  if (draft.dgClass !== '') body['dgClass'] = draft.dgClass;
  if (draft.dgSubsidiaryClasses.length > 0) body['dgSubsidiaryClasses'] = [...draft.dgSubsidiaryClasses].sort();
  if (draft.dgPackingGroup !== '') body['dgPackingGroup'] = draft.dgPackingGroup;
  body['highValue'] = draft.highValue;
  body['fragile'] = draft.fragile;
  if (parsed.stack !== null) body['maxStackLayers'] = parsed.stack;
  return { body: body as Pick<CreateSkuDto, keyof GoodsTypeBody>, problem: null };
}

/** The two decision-7 refusal codes, in the form's words (the server's detail when it has one). */
export function dgHazardReason(code: 'dg-hazard-mismatch' | 'dg-hazard-required', detail: string | undefined): string {
  if (code === 'dg-hazard-mismatch') {
    return detail ?? 'The hazard class does not match the DG class — a mapped DG class sets it.';
  }
  return detail ?? 'DG class 8 needs its hazard class — choose corrosive acid, corrosive base or none.';
}

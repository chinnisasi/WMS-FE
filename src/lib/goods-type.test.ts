import { describe, expect, test } from 'bun:test';

import {
  allergensHint,
  dgBadge,
  emptyGoodsTypeDraft,
  goodsTypeCreateFields,
  goodsTypeDraftOf,
  goodsTypePatch,
  handlingBadges,
  handlingCell,
  hazardControl,
  hazardSelectFor,
  hazardToSend,
  HAZARD_NONE,
  takesPackingGroup,
  toggled,
  withDgClass,
  withFoodCategory,
  type GoodsTypeView,
} from './goods-type';

/** Story 1-6a — the goods-type lib: badges, dependent resets, the hazard derivation the form shows, the changed-only PATCH. */
describe('handlingBadges', () => {
  test('the full set, in order: Fragile, High value, DG, stack', () => {
    expect(
      handlingBadges({
        fragile: true,
        highValue: true,
        dgClass: '3',
        dgUnNumber: '1230',
        dgSubsidiaryClasses: ['6.1'],
        dgPackingGroup: 'II',
        maxStackLayers: 1,
      }),
    ).toEqual(['Fragile', 'High value', 'DG 3 (6.1) · UN1230 · PG II', 'Do not stack']);
  });

  test('stack above 1 reads "Stacks ≤ n"; DG without subsidiaries or packing group stays short', () => {
    expect(handlingBadges({ maxStackLayers: 4, dgClass: '9', dgUnNumber: '3480' })).toEqual(['DG 9 · UN3480', 'Stacks ≤ 4']);
    expect(dgBadge({ dgClass: '3', dgUnNumber: '1203', dgSubsidiaryClasses: ['6.1', '8'] })).toBe('DG 3 (6.1, 8) · UN1203');
  });

  test('missing keys read as defaults; a SKU with no goods-type data renders nothing, and the cell an em-dash', () => {
    const legacy = {} as GoodsTypeView;
    expect(handlingBadges(legacy)).toEqual([]);
    expect(handlingBadges(undefined)).toEqual([]);
    expect(handlingBadges({ fragile: false, highValue: false, dgClass: null, dgUnNumber: null, maxStackLayers: null })).toEqual([]);
    expect(handlingCell(legacy)).toBe('—');
    expect(handlingCell({ fragile: true, maxStackLayers: 2 })).toBe('Fragile · Stacks ≤ 2');
  });

  test('capture-only fields (drug schedule, food, allergens) are never badges', () => {
    expect(handlingBadges({ drugSchedules: ['H'], foodCategory: 'dairy', allergens: ['milk'] })).toEqual([]);
  });
});

describe('the form decisions', () => {
  test('a food category of empty or non-food clears the allergens; a food keeps them', () => {
    const draft = { ...emptyGoodsTypeDraft(), foodCategory: 'dairy', allergens: ['milk'] };
    expect(withFoodCategory(draft, 'non-food').allergens).toEqual([]);
    expect(withFoodCategory(draft, '').allergens).toEqual([]);
    expect(withFoodCategory(draft, 'beverages').allergens).toEqual(['milk']);
    expect(allergensHint({ ...draft, foodCategory: '' })).toBe('Choose a food category to declare allergens.');
    expect(allergensHint({ ...draft, foodCategory: 'non-food' })).toBe('A non-food SKU carries no allergens.');
    expect(allergensHint(draft)).toBeNull();
  });

  test('clearing the DG class clears the UN number, subsidiaries and packing group; a class without a PG drops it', () => {
    const draft = { ...emptyGoodsTypeDraft(), dgClass: '3', dgUnNumber: '1203', dgSubsidiaryClasses: ['6.1'], dgPackingGroup: 'II' };
    expect(withDgClass(draft, '')).toMatchObject({ dgClass: '', dgUnNumber: '', dgSubsidiaryClasses: [], dgPackingGroup: '' });
    expect(withDgClass(draft, '2.1')).toMatchObject({ dgClass: '2.1', dgUnNumber: '1203', dgPackingGroup: '' });
    expect(withDgClass(draft, '6.1').dgSubsidiaryClasses).toEqual([]);
    expect(takesPackingGroup('7')).toBe(false);
    expect(takesPackingGroup('3')).toBe(true);
    expect(takesPackingGroup('')).toBe(false);
    expect(toggled(['milk'], 'eggs', true)).toEqual(['eggs', 'milk']);
    expect(toggled(['eggs', 'milk'], 'milk', false)).toEqual(['eggs']);
  });

  test('a mapped class sets the hazard and disables it with the hint; class 8 chooses; the rest are free', () => {
    expect(hazardControl('3')).toEqual({ kind: 'derived', value: 'flammable', hint: 'Set by DG class 3' });
    expect(hazardControl('1.4')).toMatchObject({ kind: 'derived', value: 'explosive' });
    expect(hazardControl('8')).toEqual({ kind: 'corrosive' });
    expect(hazardControl('9')).toEqual({ kind: 'free' });
    expect(hazardControl('')).toEqual({ kind: 'free' });
  });

  test('class 8 starts on "choose" unless the stored value is a corrosive (or already none on class 8); a free class re-shows the stored hazard', () => {
    expect(hazardSelectFor('8', { dgClass: '', hazardClass: '' })).toBe('');
    expect(hazardSelectFor('8', { dgClass: '3', hazardClass: 'flammable' })).toBe('');
    expect(hazardSelectFor('8', { dgClass: '', hazardClass: 'corrosive-base' })).toBe('corrosive-base');
    expect(hazardSelectFor('8', { dgClass: '8', hazardClass: '' })).toBe(HAZARD_NONE);
    expect(hazardSelectFor('9', { dgClass: '3', hazardClass: 'flammable' })).toBe('flammable');
    expect(hazardSelectFor('3', { dgClass: '', hazardClass: 'toxic' })).toBe('flammable');
  });

  test('hazardToSend: derived omits; class 8 refuses "choose" and names none on the way in; free sends only a change', () => {
    expect(hazardToSend('3', 'flammable', { dgClass: '', hazardClass: 'toxic' })).toEqual({ value: undefined, problem: null });
    expect(hazardToSend('8', '', { dgClass: '', hazardClass: '' }).problem).toContain('choose');
    expect(hazardToSend('8', HAZARD_NONE, { dgClass: '', hazardClass: '' })).toEqual({ value: null, problem: null });
    expect(hazardToSend('8', HAZARD_NONE, { dgClass: '8', hazardClass: '' })).toEqual({ value: undefined, problem: null });
    expect(hazardToSend('8', 'corrosive-acid', { dgClass: '8', hazardClass: 'corrosive-base' })).toEqual({ value: 'corrosive-acid', problem: null });
    expect(hazardToSend('9', 'flammable', { dgClass: '3', hazardClass: 'flammable' })).toEqual({ value: undefined, problem: null });
    expect(hazardToSend('', '', { dgClass: '', hazardClass: 'toxic' })).toEqual({ value: null, problem: null });
    expect(hazardToSend('', 'gas', { dgClass: '', hazardClass: '' })).toEqual({ value: 'gas', problem: null });
  });
});

describe('goodsTypePatch — only what changed', () => {
  const sku: GoodsTypeView = {
    drugSchedules: ['C', 'H'],
    foodCategory: 'dairy',
    allergens: ['eggs', 'milk'],
    dgUnNumber: '1203',
    dgClass: '3',
    dgSubsidiaryClasses: [],
    dgPackingGroup: 'II',
    highValue: false,
    fragile: true,
    maxStackLayers: 4,
  };

  test('an untouched draft sends nothing; reordered arrays, the UN prefix and ""/null are equal', () => {
    expect(goodsTypePatch(sku, goodsTypeDraftOf(sku))).toEqual({ body: {}, problem: null });
    const reordered = { ...goodsTypeDraftOf(sku), drugSchedules: ['H', 'C'], allergens: ['milk', 'eggs'], dgUnNumber: 'UN1203' };
    expect(goodsTypePatch(sku, reordered).body).toEqual({});
    expect(goodsTypePatch({}, emptyGoodsTypeDraft()).body).toEqual({});
  });

  test('each changed field rides; a clear sends null', () => {
    const draft = {
      ...goodsTypeDraftOf(sku),
      foodCategory: '',
      allergens: [],
      dgClass: '9',
      dgUnNumber: '3480',
      dgPackingGroup: '',
      highValue: true,
      maxStackLayers: '',
    };
    expect(goodsTypePatch(sku, draft).body as Record<string, unknown>).toEqual({
      foodCategory: null,
      allergens: [],
      dgClass: '9',
      dgUnNumber: '3480',
      dgPackingGroup: null,
      highValue: true,
      maxStackLayers: null,
    });
  });

  test('a malformed UN number, an orphan UN number or a stack outside 1–100 keeps the form unsent', () => {
    expect(goodsTypePatch(sku, { ...goodsTypeDraftOf(sku), dgUnNumber: '12' }).problem).toContain('UN number');
    expect(goodsTypePatch(sku, { ...goodsTypeDraftOf(sku), dgClass: '', dgUnNumber: '1203' }).problem).toContain('DG class');
    expect(goodsTypePatch(sku, { ...goodsTypeDraftOf(sku), maxStackLayers: '0' }).problem).toContain('Stack limit');
    expect(goodsTypePatch(sku, { ...goodsTypeDraftOf(sku), maxStackLayers: '101' }).problem).toContain('Stack limit');
  });
});

describe('goodsTypeCreateFields', () => {
  test('the flags always ride; blank nullables and empty arrays are dropped', () => {
    expect(goodsTypeCreateFields(emptyGoodsTypeDraft())).toEqual({ body: { highValue: false, fragile: false }, problem: null });
    expect(
      goodsTypeCreateFields({
        ...emptyGoodsTypeDraft(),
        drugSchedules: ['H', 'C'],
        dgClass: '3',
        dgUnNumber: 'un1230',
        dgSubsidiaryClasses: ['6.1'],
        fragile: true,
        maxStackLayers: '1',
      }).body,
    ).toEqual({ drugSchedules: ['C', 'H'], dgClass: '3', dgUnNumber: '1230', dgSubsidiaryClasses: ['6.1'], highValue: false, fragile: true, maxStackLayers: 1 });
  });
});

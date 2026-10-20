/**
 * Catalog master-data change events, same broadcaster pattern as zones.ts:
 * the Settings catalog surfaces (import wizard, SKU inline edit) notify, and
 * every SKUs/checklist reader subscribes and refetches. One event covers both
 * — imports create SKUs, edits mutate them, and both feed the checklist's
 * catalog step.
 */

/** Fired on `window` after a catalog mutation so readers refetch. */
export const CATALOG_CHANGED_EVENT = 'wms-catalog-changed';

export function notifyCatalogChanged(): void {
  window.dispatchEvent(new Event(CATALOG_CHANGED_EVENT));
}
/**
 * Story 1-4 — every column the catalog import's fixed header admits, in the
 * backend's order (`import.command.ts` REQUIRED_COLUMNS + OPTIONAL_COLUMNS):
 * the import card's help lists exactly these, so a column the server takes is
 * never missing from the help (an unknown column refuses the whole file).
 */
export const CATALOG_IMPORT_REQUIRED_COLUMNS = ['sku_code', 'name', 'uom', 'gst_rate'] as const;
export const CATALOG_IMPORT_OPTIONAL_COLUMNS = [
  'uom_conversions',
  'hsn',
  'batch_tracked',
  'serial_tracked',
  'catch_weight_tracked',
  'weight_grams',
  'length_mm',
  'width_mm',
  'height_mm',
  'country_of_origin',
  'reorder_point',
  'reorder_qty',
  'barcode',
  'product',
  'variant_values',
  'kit_components',
  'storage_class',
  'hazard_class',
  'abc_class',
  'shelf_life_days',
  'barcodes',
  // Story 1-6a — the goods-type columns, appended after `barcodes`.
  'drug_schedules',
  'food_category',
  'allergens',
  'dg_un_number',
  'dg_class',
  'dg_subsidiary_classes',
  'dg_packing_group',
  'high_value',
  'fragile',
  'max_stack_layers',
] as const;

/** The help sentence's column list. */
export function catalogImportColumnsLabel(): string {
  return [...CATALOG_IMPORT_REQUIRED_COLUMNS, ...CATALOG_IMPORT_OPTIONAL_COLUMNS].join(', ');
}

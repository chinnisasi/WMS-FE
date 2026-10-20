'use client';

import { useId } from 'react';

import {
  ALLERGEN_LABEL,
  ALLERGENS,
  allergensAllowed,
  allergensHint,
  CORROSIVE_HAZARDS,
  DG_CLASSES,
  DG_PACKING_GROUPS,
  DRUG_SCHEDULES,
  drugScheduleLabel,
  FOOD_CATEGORIES,
  FOOD_CATEGORY_LABEL,
  HAZARD_NONE,
  hazardControl,
  MAX_DG_SUBSIDIARY_CLASSES,
  takesPackingGroup,
  toggled,
  withDgClass,
  withFoodCategory,
  type GoodsTypeDraft,
} from '@/lib/goods-type';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';

/**
 * Story 1-6a — the goods-type controls the SKU edit form and the create card
 * share. Every dependent reset is a `src/lib/goods-type.ts` decision (pinned
 * there); this renders them. Checkbox groups are `fieldset`/`legend` (the
 * client-contacts precedent); the disabled allergens group carries its hint
 * by `aria-describedby`.
 */
export function GoodsTypeFields({
  draft,
  onChange,
  onDgClassChange,
}: {
  draft: GoodsTypeDraft;
  onChange: (next: GoodsTypeDraft) => void;
  /** Called with the new class after a DG class pick, so the form can move its hazard select. */
  onDgClassChange?: (dgClass: string) => void;
}) {
  const id = useId();
  const allergensOn = allergensAllowed(draft);
  const hint = allergensHint(draft);
  const pgOffered = takesPackingGroup(draft.dgClass);
  return (
    <div className="flex flex-col gap-3 rounded-sm border border-(--border) p-3">
      <div className="text-xs font-medium text-(--muted-foreground)">Goods type and handling</div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={draft.fragile} onChange={(e) => onChange({ ...draft, fragile: e.target.checked })} />
          Fragile
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={draft.highValue} onChange={(e) => onChange({ ...draft, highValue: e.target.checked })} />
          High value
        </label>
        <label className="flex items-center gap-2 text-xs">
          <span>Stack limit (layers)</span>
          <input
            className={`${inputClass} w-24`}
            type="text"
            inputMode="numeric"
            value={draft.maxStackLayers}
            onChange={(e) => onChange({ ...draft, maxStackLayers: e.target.value })}
            placeholder="—"
            aria-describedby={`${id}-stack-hint`}
          />
          <span id={`${id}-stack-hint`} className="text-(--muted-foreground)">
            1 = do not stack
          </span>
        </label>
      </div>

      <fieldset className="flex flex-wrap gap-3" aria-labelledby={`${id}-drug`}>
        <legend id={`${id}-drug`} className={labelClass}>
          Drug schedules
        </legend>
        {DRUG_SCHEDULES.map((schedule) => (
          <label key={schedule} className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={draft.drugSchedules.includes(schedule)}
              onChange={(e) => onChange({ ...draft, drugSchedules: toggled(draft.drugSchedules, schedule, e.target.checked) })}
            />
            {drugScheduleLabel(schedule)}
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1 sm:w-72">
        <span className={labelClass}>Food category</span>
        <select className={inputClass} value={draft.foodCategory} onChange={(e) => onChange(withFoodCategory(draft, e.target.value))}>
          <option value="">Not set</option>
          {FOOD_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {FOOD_CATEGORY_LABEL[category]}
            </option>
          ))}
        </select>
      </label>

      <fieldset
        className="flex flex-wrap gap-3"
        aria-labelledby={`${id}-allergens`}
        disabled={!allergensOn}
        {...(hint === null ? {} : { 'aria-describedby': `${id}-allergens-hint` })}
      >
        <legend id={`${id}-allergens`} className={labelClass}>
          Allergens (FSSAI)
        </legend>
        {ALLERGENS.map((allergen) => (
          <label key={allergen} className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={draft.allergens.includes(allergen)}
              onChange={(e) => onChange({ ...draft, allergens: toggled(draft.allergens, allergen, e.target.checked) })}
            />
            {ALLERGEN_LABEL[allergen]}
          </label>
        ))}
        {hint === null ? null : (
          <span id={`${id}-allergens-hint`} className="w-full text-xs text-(--muted-foreground)">
            {hint}
          </span>
        )}
      </fieldset>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>DG class</span>
          <select
            className={inputClass}
            value={draft.dgClass}
            onChange={(e) => {
              onChange(withDgClass(draft, e.target.value));
              onDgClassChange?.(e.target.value);
            }}
          >
            <option value="">Not dangerous goods</option>
            {DG_CLASSES.map((dgClass) => (
              <option key={dgClass} value={dgClass}>
                {dgClass}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>UN number</span>
          <input
            className={inputClass}
            value={draft.dgUnNumber}
            onChange={(e) => onChange({ ...draft, dgUnNumber: e.target.value })}
            disabled={draft.dgClass === ''}
            maxLength={6}
            placeholder="UN1203"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Packing group</span>
          <select
            className={inputClass}
            value={pgOffered ? draft.dgPackingGroup : ''}
            onChange={(e) => onChange({ ...draft, dgPackingGroup: e.target.value })}
            disabled={!pgOffered}
          >
            <option value="">{pgOffered || draft.dgClass === '' ? 'None' : `None for class ${draft.dgClass}`}</option>
            {pgOffered
              ? DG_PACKING_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))
              : null}
          </select>
        </label>
      </div>

      <fieldset className="flex flex-wrap gap-3" aria-labelledby={`${id}-subs`} disabled={draft.dgClass === ''}>
        <legend id={`${id}-subs`} className={labelClass}>
          Subsidiary DG classes (up to {MAX_DG_SUBSIDIARY_CLASSES})
        </legend>
        {DG_CLASSES.filter((dgClass) => dgClass !== draft.dgClass).map((dgClass) => (
          <label key={dgClass} className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={draft.dgSubsidiaryClasses.includes(dgClass)}
              disabled={!draft.dgSubsidiaryClasses.includes(dgClass) && draft.dgSubsidiaryClasses.length >= MAX_DG_SUBSIDIARY_CLASSES}
              onChange={(e) =>
                onChange({ ...draft, dgSubsidiaryClasses: toggled(draft.dgSubsidiaryClasses, dgClass, e.target.checked) })
              }
            />
            {dgClass}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

/**
 * Story 1-6a — the hazard select under decision 7: a mapped DG class shows
 * the derived class, disabled, with "Set by DG class 3"; class 8 offers
 * acid, base or none behind an empty "choose" option; otherwise every class
 * plus "No rule".
 */
export function HazardSelect({
  dgClass,
  value,
  onChange,
  hazardClasses,
}: {
  dgClass: string;
  value: string;
  onChange: (value: string) => void;
  hazardClasses: readonly string[];
}) {
  const id = useId();
  const control = hazardControl(dgClass);
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className={labelClass}>Hazard class</span>
      {control.kind === 'derived' ? (
        <>
          <select className={inputClass} value={control.value} disabled aria-describedby={`${id}-hint`} onChange={() => undefined}>
            <option value={control.value}>{control.value}</option>
          </select>
          <span id={`${id}-hint`} className="text-xs text-(--muted-foreground)">
            {control.hint}
          </span>
        </>
      ) : control.kind === 'corrosive' ? (
        <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {CORROSIVE_HAZARDS.map((hazard) => (
            <option key={hazard} value={hazard}>
              {hazard}
            </option>
          ))}
          <option value={HAZARD_NONE}>none</option>
        </select>
      ) : (
        <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">No rule</option>
          {hazardClasses.map((hazard) => (
            <option key={hazard} value={hazard}>
              {hazard}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}

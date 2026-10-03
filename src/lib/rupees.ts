/**
 * The ONE rupee grammar (story 8-1, shared by 8-1c). Lives in its own module
 * so both `invoices.ts` (the pricing panel) and `outbound-orders.ts` (the
 * order form's per-line rate) parse rupees through the same function without
 * an import cycle — `invoices.ts` already imports `outbound-orders.ts`.
 */

/**
 * The operator's rupee text → integer paise, or a problem. `^\d+(\.\d{1,2})?$`
 * and string arithmetic — never `Number()` on the whole string, which accepts
 * `1e3` and `0x10` and would turn `0.07` into a float before the multiply.
 * A third decimal is refused (paise are the floor), never rounded.
 */
export function parseRupees(text: string): { paise: number } | { problem: string } {
  const trimmed = text.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (match === null) {
    return { problem: 'Enter a rupee amount like 125 or 125.50 (at most two decimal places).' };
  }
  const rupees = Number(match[1]);
  const paise = rupees * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) {
    return { problem: 'That amount is too large.' };
  }
  return { paise };
}

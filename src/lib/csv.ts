/**
 * CSV helpers shared by the client-generated downloads (the catalog import
 * error report, 1.4; the HSN summary, 8-2a). Moved out of
 * `import-catalog.tsx` so both files quote exactly the same way.
 */

/**
 * One quoted CSV field. Spreadsheet applications execute a leading =, +, -
 * or @ as a formula — and (story 21-5b) a leading tab or carriage return is
 * stripped by some importers to reveal one — so all six are neutralized with
 * a leading apostrophe; a cell can never become an injection vector.
 * Embedded quotes are doubled. TEXT only: a number goes through
 * `csvNumber`, which a guard would corrupt (`-40` must stay a number).
 */
export function csvField(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replaceAll('"', '""')}"`;
}

/**
 * One NUMBER cell, written plain and never guarded (story 21-5b): a signed
 * decimal string (`12`, `-40`, `1234.567`) is emitted as-is so a spreadsheet
 * reads a number. Anything that is not exactly such a decimal falls back to
 * the guarded text field — the guard is skipped only for a value that cannot
 * carry a formula.
 */
export function csvNumber(value: string | number): string {
  const text = String(value);
  return /^-?\d+(\.\d+)?$/.test(text) ? text : csvField(text);
}

/**
 * Hands `text` to the browser as a file download. The caller decides the
 * bytes — including whether a BOM leads (the error report adds one for
 * Excel; the HSN summary must not, the GST offline tool matches its header
 * exactly).
 */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // Firefox needs the anchor in the document before click(); Safari can
  // reclaim the object URL before the click lands, so revoke on a timer
  // instead of inline.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * CSV helpers shared by the client-generated downloads (the catalog import
 * error report, 1.4; the HSN summary, 8-2a). Moved out of
 * `import-catalog.tsx` so both files quote exactly the same way.
 */

/**
 * One quoted CSV field. Spreadsheet applications execute a leading =, +, -
 * or @ as a formula — neutralize it so a cell can never become an injection
 * vector. Embedded quotes are doubled.
 */
export function csvField(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${guarded.replaceAll('"', '""')}"`;
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

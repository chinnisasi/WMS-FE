/**
 * Theme persistence — the single source for the storage contract between the
 * pre-paint init script (src/app/layout.tsx) and ThemeToggle (sidebar, mobile
 * menu). Both sides must agree on the key and the value vocabulary or the
 * choice silently stops persisting.
 */
export const THEME_STORAGE_KEY = 'wms-theme';

export type StoredTheme = 'dark' | 'light';

export function readStoredTheme(): StoredTheme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredTheme(theme: StoredTheme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // private mode — theme simply won't persist
  }
}
/**
 * Brand delta from DESIGN.md — the single TS source for the hues so tests can
 * pin them. globals.css mirrors these values; do not introduce a second hue.
 */
export const BRAND = {
  primary: '#1e4e8c',
  primaryForeground: '#ffffff',
  accent: '#16794c',
  accentForeground: '#ffffff',
  warning: '#b45309',
  warningForeground: '#ffffff',
  primaryDark: '#7fa7db',
  primaryForegroundDark: '#0a1a2a',
  accentDark: '#4cc38a',
  accentForegroundDark: '#07210f',
  warningDark: '#f0a860',
  warningForegroundDark: '#1f1002',
} as const;

export const RADIUS_SCALE = { sm: 4, md: 6, lg: 8 } as const;

export const KPI_STYLE = {
  fontSize: 28,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
} as const;

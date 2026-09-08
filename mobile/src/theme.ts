import { useColorScheme } from 'react-native';

/**
 * Platform-theme mapping of the shared brand hues (DESIGN.md).
 *
 * Brand accents map from the DESIGN.md token layer in both appearances;
 * neutral surfaces/labels are explicit light/dark pairs (the OS scheme
 * decides). Dark-mode fills always pair with their dark-foreground tokens —
 * white on dark fills fails AA and is forbidden.
 */
export const brand = {
  primaryLight: '#1E4E8C',
  primaryForegroundLight: '#FFFFFF',
  accentLight: '#16794C',
  accentForegroundLight: '#FFFFFF',
  warningLight: '#B45309',
  warningForegroundLight: '#FFFFFF',
  destructiveLight: '#B3261E',
  destructiveForegroundLight: '#FFFFFF',
  primaryDark: '#7FA7DB',
  primaryForegroundDark: '#0A1A2A',
  accentDark: '#4CC38A',
  accentForegroundDark: '#07210F',
  warningDark: '#F0A860',
  warningForegroundDark: '#1F1002',
  destructiveDark: '#F2B8B5',
  destructiveForegroundDark: '#2B0503',
} as const;

export interface AppTheme {
  readonly background: string;
  readonly label: string;
  readonly secondaryLabel: string;
  readonly primary: string;
  readonly primaryForeground: string;
  readonly accent: string;
  readonly accentForeground: string;
  readonly warning: string;
  readonly warningForeground: string;
  readonly destructive: string;
  readonly destructiveForeground: string;
}

const light: AppTheme = {
  background: '#FFFFFF',
  label: '#1C1B1F',
  secondaryLabel: '#605D64',
  primary: brand.primaryLight,
  primaryForeground: brand.primaryForegroundLight,
  accent: brand.accentLight,
  accentForeground: brand.accentForegroundLight,
  warning: brand.warningLight,
  warningForeground: brand.warningForegroundLight,
  destructive: brand.destructiveLight,
  destructiveForeground: brand.destructiveForegroundLight,
};

const dark: AppTheme = {
  background: '#09090B',
  label: '#FAFAFA',
  secondaryLabel: '#A1A1AA',
  primary: brand.primaryDark,
  primaryForeground: brand.primaryForegroundDark,
  accent: brand.accentDark,
  accentForeground: brand.accentForegroundDark,
  warning: brand.warningDark,
  warningForeground: brand.warningForegroundDark,
  destructive: brand.destructiveDark,
  destructiveForeground: brand.destructiveForegroundDark,
};

export function useAppTheme(): AppTheme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}

/**
 * Scan-banner states are never color-only: each pairs a fill with a glyph +
 * word (WCAG 1.4.1 — color-blind operators read the glyph). The active theme
 * picks the dark-variant fill pairs.
 */
export const scanStates = {
  accepted: { glyph: '✓', word: 'Accepted' },
  queued: { glyph: '↻', word: 'Queued' },
  rejected: { glyph: '✕', word: 'Rejected' },
  quarantined: { glyph: '⚠', word: 'Held for review' },
} as const;

export type ScanState = keyof typeof scanStates;

/** Title-1-class semibold — the largest text on any task screen. */
export const type = {
  scanResult: { fontSize: 28, fontWeight: '600' as const },
  body: { fontSize: 16 },
} as const;
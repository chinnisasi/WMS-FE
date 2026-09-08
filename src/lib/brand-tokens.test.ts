import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BRAND, KPI_STYLE, RADIUS_SCALE } from './brand-tokens';

/**
 * Pins the token layer to DESIGN.md (ux-WMS-Meta-2026-09-08) — the
 * authoritative source. A failing test here means a second brand hue or a
 * drifted radius crept into the codebase.
 */
const CSS = readFileSync(join(import.meta.dir, '../app/globals.css'), 'utf8');

describe('design-token layer vs DESIGN.md', () => {
  test('brand delta hues match DESIGN.md exactly', () => {
    expect(BRAND.primary).toBe('#1e4e8c');
    expect(BRAND.primaryForeground).toBe('#ffffff');
    expect(BRAND.accent).toBe('#16794c');
    expect(BRAND.accentForeground).toBe('#ffffff');
    expect(BRAND.warning).toBe('#b45309');
    expect(BRAND.warningForeground).toBe('#ffffff');
  });

  test('dark-mode foreground pairs match DESIGN.md (never white on dark fills)', () => {
    expect(BRAND.primaryDark).toBe('#7fa7db');
    expect(BRAND.primaryForegroundDark).toBe('#0a1a2a');
    expect(BRAND.accentDark).toBe('#4cc38a');
    expect(BRAND.accentForegroundDark).toBe('#07210f');
    expect(BRAND.warningDark).toBe('#f0a860');
    expect(BRAND.warningForegroundDark).toBe('#1f1002');
  });

  test('globals.css mirrors the brand hues for both themes', () => {
    // Positional: each variable must carry the right value inside the right
    // block — a light/dark swap elsewhere in the file must fail here.
    // '.dark' also matches the @custom-variant line — anchor on the block.
    const rootBlock = CSS.slice(CSS.indexOf(':root'), CSS.indexOf('.dark {'));
    const darkBlock = CSS.slice(CSS.indexOf('.dark {'), CSS.indexOf('@theme'));
    const lightVars: Record<string, string> = {
      '--primary': BRAND.primary,
      '--primary-foreground': BRAND.primaryForeground,
      '--accent': BRAND.accent,
      '--accent-foreground': BRAND.accentForeground,
      '--warning': BRAND.warning,
      '--warning-foreground': BRAND.warningForeground,
    };
    const darkVars: Record<string, string> = {
      '--primary': BRAND.primaryDark,
      '--primary-foreground': BRAND.primaryForegroundDark,
      '--accent': BRAND.accentDark,
      '--accent-foreground': BRAND.accentForegroundDark,
      '--warning': BRAND.warningDark,
      '--warning-foreground': BRAND.warningForegroundDark,
    };
    for (const [v, hex] of Object.entries(lightVars)) {
      expect(rootBlock).toContain(`${v}: ${hex}`);
    }
    for (const [v, hex] of Object.entries(darkVars)) {
      expect(darkBlock).toContain(`${v}: ${hex}`);
    }
  });

  test('no hue exists outside the token set (no second brand hue, no gradients)', () => {
    const allowed = new Set([
      ...Object.values(BRAND),
      // shadcn-inherited zinc surface scale + destructive + focus ring (primary)
      '#ffffff', '#18181b', '#f4f4f5', '#71717a', '#a1a1aa', '#dc2626', '#e4e4e7',
      '#09090b', '#fafafa', '#27272a', '#d4d4d8', '#ef4444',
      // zinc foregrounds used inside dark pairs
      ...Object.values(BRAND).map((h) => h.toLowerCase()),
    ]);
    const hexes = CSS.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const unknown = hexes.filter((h) => !allowed.has(h.toLowerCase()));
    expect(unknown).toEqual([]);
    expect(CSS).not.toMatch(/gradient\(/);
  });

  test('radius scale is 4/6/8px', () => {
    expect(RADIUS_SCALE).toEqual({ sm: 4, md: 6, lg: 8 });
    expect(CSS).toContain('--radius-sm: 4px');
    expect(CSS).toContain('--radius-md: 6px');
    expect(CSS).toContain('--radius-lg: 8px');
  });

  test('kpi style is 28px semibold tabular numerals', () => {
    expect(KPI_STYLE).toEqual({ fontSize: 28, fontWeight: 600, fontVariantNumeric: 'tabular-nums' });
    expect(CSS).toContain('font-variant-numeric: tabular-nums');
  });
});

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
    for (const hex of Object.values(BRAND)) {
      expect(CSS).toContain(hex);
    }
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
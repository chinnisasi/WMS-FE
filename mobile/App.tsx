import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { fetchHealth, type HealthResponse } from './src/api';
import { scanStates, useAppTheme, type } from './src/theme';

/**
 * Health screen — the Story 1.1 mobile boot check. The scan-banner block
 * demonstrates the platform-theme mapping of the brand hues with the
 * glyph + word pairing (never color-only).
 */
export default function App(): React.JSX.Element {
  const theme = useAppTheme();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchHealth()
      .then((h) => {
        if (!cancelled) setHealth(h);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'unknown error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Scan-accepted is the one loud element on the screen (DESIGN.md) — green
  // fill + glyph + word, dark-variant foreground pair, never color-only.
  const banner = { ...scanStates.accepted, color: theme.accent, foreground: theme.accentForeground };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.label }]}>WMS Scan Client</Text>

        <View style={[styles.banner, { backgroundColor: banner.color }]}>
          <Text style={[styles.bannerGlyph, { color: banner.foreground }]}>{banner.glyph}</Text>
          <View style={styles.bannerWords}>
            <Text style={[styles.bannerWord, { color: banner.foreground }]}>{banner.word}</Text>
            <Text style={[styles.bannerDetail, { color: banner.foreground }]}>
              {health
                ? `api ${health.status} · ${health.service}`
                : error
                  ? `api unreachable — ${error}`
                  : 'checking api…'}
            </Text>
          </View>
        </View>

        {health === null && error === null ? <ActivityIndicator /> : null}

        <Text style={[styles.sectionLabel, { color: theme.secondaryLabel }]}>
          Brand hues (platform theme mapping)
        </Text>
        {(
          [
            ['primary', theme.primary],
            ['accent', theme.accent],
            ['warning', theme.warning],
          ] as const
        ).map(([name, hex]) => (
          <View key={name} style={styles.swatchRow}>
            <View style={[styles.swatch, { backgroundColor: hex }]} />
            <Text style={[styles.swatchLabel, { color: theme.label }]}>
              {name} · {hex}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  title: {
    ...type.scanResult,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 6,
    minHeight: 96,
    padding: 16,
  },
  bannerGlyph: {
    fontSize: 32,
    fontWeight: '600',
  },
  bannerWords: {
    flex: 1,
  },
  bannerWord: {
    fontSize: 20,
    fontWeight: '600',
  },
  bannerDetail: {
    ...type.body,
    marginTop: 2,
  },
  sectionLabel: {
    ...type.body,
    marginTop: 8,
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  swatch: {
    width: 48,
    height: 24,
    borderRadius: 4,
  },
  swatchLabel: {
    fontVariant: ['tabular-nums'],
  },
});
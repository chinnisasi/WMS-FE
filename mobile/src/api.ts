/**
 * Thin API access for the health screen. The base URL comes from Expo's
 * env mechanism (EXPO_PUBLIC_* vars are inlined into the bundle).
 */
// `||` (not `??`) so a set-but-empty env var falls back to the default
// instead of producing a relative-URL fetch on device.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000/api/v1';

export interface HealthResponse {
  status: string;
  service: string;
  time: string;
}

export async function fetchHealth(): Promise<HealthResponse> {
  // Hard 5s ceiling so the banner reports "unreachable" instead of hanging.
  const res = await fetch(`${API_BASE_URL}/health`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    throw new Error(`health check failed: ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}

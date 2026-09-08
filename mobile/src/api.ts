/**
 * Thin API access for the health screen. The base URL comes from Expo's
 * env mechanism (EXPO_PUBLIC_* vars are inlined into the bundle).
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export interface HealthResponse {
  status: string;
  service: string;
  time: string;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE_URL}/health`);
  if (!res.ok) {
    throw new Error(`health check failed: ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}
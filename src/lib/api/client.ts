import { client } from './generated/client.gen';
import { healthControllerHealth } from './generated/sdk.gen';

/**
 * Configures the generated client once. The base URL points at wms-be's
 * `/api/v1` shell; every typed function lives in ./generated (AD-8 — no
 * hand-written API types anywhere in wms-fe).
 */
const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

client.setConfig({
  baseUrl,
});

export { client };

export interface ApiHealth {
  status: string;
  service: string;
  time: string;
}

export async function fetchApiHealth(): Promise<ApiHealth> {
  const { data, error } = await healthControllerHealth();
  if (error) {
    throw new Error(`api health check failed: ${JSON.stringify(error)}`);
  }
  // The generated HealthResponse type is structurally ApiHealth.
  return data as ApiHealth;
}
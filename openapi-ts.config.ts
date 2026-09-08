import { defineConfig } from '@hey-api/openapi-ts';

/**
 * Generates the typed API client from wms-be's OpenAPI document (AD-8).
 * Run `bun run api:generate` after any backend contract change — never
 * hand-edit src/lib/api/generated, and never hand-write API types.
 */
export default defineConfig({
  input: '../../backend/wms-be/openapi/openapi.json',
  output: './src/lib/api/generated',
  plugins: ['@hey-api/client-fetch', '@hey-api/sdk', '@hey-api/typescript'],
});

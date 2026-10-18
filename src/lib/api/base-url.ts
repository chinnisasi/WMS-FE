/**
 * The wms-be `/api/v1` base every request composes from. Its own module so the
 * session-refresh path (which must call the API without the generated
 * client's interceptors) and the client config share one value.
 */
// `||` (not `??`) so a set-but-empty env var still falls back to the default.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api/v1';

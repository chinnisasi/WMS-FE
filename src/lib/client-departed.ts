/**
 * Story 1-2a — the words every surface shows for a 409 `client-departed`
 * (work refused for a client that has left). A leaf module with no imports,
 * so every reason mapper — `outbound-orders.ts` included, which `clients.ts`
 * itself imports — can use it without an import cycle. Re-exported from
 * `clients.ts`.
 */
export const CLIENT_DEPARTED_REASON =
  'This client has departed and takes no new work — an owner can reactivate it in Settings → Clients.';

import { afterEach, describe, expect, test } from 'bun:test';

import { ApiProblem, fetchApiRegisterTenant } from './client';

/**
 * Error-mapping contract for the API wrappers: a problem+json body becomes
 * an `ApiProblem` carrying the machine-readable `code` (what the forms
 * branch on), not prose and not a generic Error. Network behavior is
 * stubbed at `fetch` — the generated client is a fetch wrapper.
 */
function stubFetch(status: number, body: unknown): void {
  (globalThis as Record<string, unknown>).fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).fetch;
});

describe('ApiProblem error mapping', () => {
  test('problem+json body → ApiProblem with the machine-readable code', async () => {
    stubFetch(409, {
      code: 'duplicate-email',
      title: 'Owner email already registered',
      status: 409,
      detail: 'An account for priya@example.com already exists.',
    });
    try {
      await fetchApiRegisterTenant(
        { name: 'Priya Spices', ownerEmail: 'priya@example.com', password: 'secret-password' },
        '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiProblem);
      const problem = error as ApiProblem;
      expect(problem.code).toBe('duplicate-email');
      expect(problem.status).toBe(409);
      expect(problem.detail).toContain('priya@example.com');
    }
  });

  test('non-problem error body → ApiProblem with the fallback code', async () => {
    stubFetch(500, { message: 'boom' });
    try {
      await fetchApiRegisterTenant(
        { name: 'Priya Spices', ownerEmail: 'priya@example.com', password: 'secret-password' },
        '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiProblem);
      expect((error as ApiProblem).code).toBe('request-failed');
    }
  });
});
// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
//
// What an over-budget request costs, counted in database queries.
//
// The three routes that take an Idempotency-Key claim a row in Postgres before they run, and until
// 2026-11-25 their rate limiter lived inside `run` — after the claim. So a caller who was already
// over budget, or who never meant to sign anything, still spent two writes on the shared database
// with every request (the claim, then its release), with nothing cheap in front of them. The
// limiter is now admitted first. This measures that at the routes themselves, by counting the
// queries that reach the pool.

import { Pool } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { BUDGETS, resetRateLimits } from '../lib/rate-limit';
import { closeDatabase, useTestDatabase } from './helpers/database';

useTestDatabase();

const { POST: publish } = await import('../app/api/posts/route');
const { POST: submit } = await import('../app/api/checkout/submit/route');

afterAll(closeDatabase);

const ORIGIN = 'https://weir.social';

const post = (path: string, ip: string, key: string, body: string): Request =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'x-real-ip': ip, 'idempotency-key': key, 'content-type': 'application/json' },
    body,
  });

describe('an Idempotency-Key request that is over budget', () => {
  it('POST /api/posts: is refused before anything reaches the database', async () => {
    resetRateLimits();
    const ip = '203.0.113.210';
    const queries = vi.spyOn(Pool.prototype, 'query');
    try {
      for (let i = 0; i < BUDGETS.write.limit; i += 1) {
        const admitted = await publish(post('/api/posts', ip, `k-${i}`, '{"author":"0x1"}'));
        expect(admitted.status).not.toBe(429);
      }
      // The budget was spent on requests that were admitted, and those did reach the database.
      expect(queries.mock.calls.length).toBeGreaterThan(0);

      queries.mockClear();
      const over = await publish(post('/api/posts', ip, 'k-over', '{"author":"0x1"}'));
      expect(over.status).toBe(429);
      expect(queries).not.toHaveBeenCalled();
    } finally {
      queries.mockRestore();
    }
  });

  it('POST /api/checkout/submit: is refused by the memory half of its limiter, before the ledger', async () => {
    resetRateLimits();
    const ip = '203.0.113.211';
    const queries = vi.spyOn(Pool.prototype, 'query');
    try {
      for (let i = 0; i < BUDGETS.simulate.limit; i += 1) {
        const admitted = await submit(post('/api/checkout/submit', ip, `k-${i}`, '{}'));
        expect(admitted.status).not.toBe(429);
      }

      queries.mockClear();
      const over = await submit(post('/api/checkout/submit', ip, 'k-over', '{}'));
      expect(over.status).toBe(429);
      expect(queries).not.toHaveBeenCalled();
    } finally {
      queries.mockRestore();
    }
  });
});

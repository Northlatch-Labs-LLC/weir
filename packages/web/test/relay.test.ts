// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it , vi } from 'vitest';

vi.setConfig({ testTimeout: 15_000 });
import { closeDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const [key, ...rest] = line.split('=');
  if (key?.startsWith('PROJECTX_SOCIAL_') && process.env[key] === undefined) {
    process.env[key] = rest.join('=').trim();
  }
}

const { submitSigned } = await import('../lib/checkout');

afterAll(closeDatabase);

function bytesNobodyQuoted(): string {
  return Buffer.from(`never-issued-${randomUUID()}`).toString('base64');
}

const digestOf = (bytes: string): Buffer => createHash('sha256').update(bytes).digest();

async function pretendWeQuoted(bytes: string, expiresAtMs: number): Promise<void> {
  await testDb().query(
    `INSERT INTO issued_quotes (digest, expires_at_ms) VALUES ($1, $2)
     ON CONFLICT (digest) DO UPDATE SET expires_at_ms = EXCLUDED.expires_at_ms`,
    [digestOf(bytes), expiresAtMs],
  );
}

describe('the transaction relay', () => {
  it('refuses bytes it never quoted', async () => {
    const result = await submitSigned({ bytes: bytesNobodyQuoted(), signature: 'AA==' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.detail).toContain('not quoted by this deployment');
  });

  it('accepts a quote it issued, and spends it', async () => {
    const bytes = bytesNobodyQuoted();
    await pretendWeQuoted(bytes, Date.now() + 60_000);

    const first = await submitSigned({ bytes, signature: 'AA==' });
    if (!first.ok) expect(first.failure.detail).not.toContain('not quoted by this deployment');

    const rows = await testDb().query('SELECT 1 FROM issued_quotes WHERE digest = $1', [
      digestOf(bytes),
    ]);
    expect(rows.rowCount).toBe(0);

    const second = await submitSigned({ bytes, signature: 'AA==' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.failure.detail).toContain('not quoted by this deployment');
  });

  it('refuses a quote that has expired', async () => {
    const bytes = bytesNobodyQuoted();
    await pretendWeQuoted(bytes, Date.now() - 1);

    const result = await submitSigned({ bytes, signature: 'AA==' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.detail).toContain('expired');
  });
});

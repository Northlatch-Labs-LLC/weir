// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { afterEach, describe, expect, it, vi } from 'vitest';

process.env['PROJECTX_WALRUS_AGGREGATOR_URL'] = 'https://aggregator.invalid';

const { readBlob } = await import('../lib/walrus');

const BLOB = 'A'.repeat(43);

function streamOf(totalBytes: number, chunk = 64 * 1024, headers: Record<string, string> = {}) {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunk, totalBytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size));
    },
  });
  return new Response(body, { status: 200, headers });
}

afterEach(() => vi.unstubAllGlobals());

describe('a blob within the ceiling', () => {
  it('is returned whole', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamOf(3 * 1024 * 1024)));

    const result = await readBlob(BLOB);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.byteLength).toBe(3 * 1024 * 1024);
  });

  it('is reassembled in order across chunks', async () => {
    const parts = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const p of parts) controller.enqueue(p);
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));

    const result = await readBlob(BLOB);

    expect(result.ok).toBe(true);
    if (result.ok) expect([...result.value]).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('a blob over the ceiling', () => {
  it('is refused even when it declares nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamOf(20 * 1024 * 1024)));

    const result = await readBlob(BLOB);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.detail).toMatch(/exceeds/);
  });

  it('is refused early when it declares its size honestly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamOf(1024, 1024, { 'content-length': String(64 * 1024 * 1024) })),
    );

    const result = await readBlob(BLOB);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.detail).toMatch(/declares/);
  });

  it('is refused when it UNDERSTATES its size, which the header check cannot catch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamOf(20 * 1024 * 1024, 64 * 1024, { 'content-length': '10' })),
    );

    const result = await readBlob(BLOB);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.detail).toMatch(/exceeds/);
  });
});

describe('the deadline', () => {
  it('is passed to fetch, so a silent aggregator cannot hold the request open', async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(init);
        return streamOf(16);
      }),
    );

    await readBlob(BLOB);

    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports an abort as transport, not as a malformed blob', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
      }),
    );

    const result = await readBlob(BLOB);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('transport');
  });
});

describe('a body that is not there at all', () => {
  it('is a transport failure rather than an empty blob', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));

    const result = await readBlob(BLOB);

    expect(result.ok).toBe(false);
  });
});

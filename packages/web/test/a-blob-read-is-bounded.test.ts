// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * A blob read has a deadline and a ceiling.
 *
 * # The defect this pins
 *
 * `readBlob` called `fetch` with no timeout and `arrayBuffer()` with no cap, against COMMUNITY
 * aggregators. That choice is deliberate and correct — reads need no publisher and cost nothing —
 * and it means nobody here operates the server on the other end. Nobody is paged when one degrades,
 * and a slow aggregator is indistinguishable from a stopped one.
 *
 * `fetch` has no default timeout, so the request lived as long as the socket did: a serverless
 * invocation billed to its own ceiling, holding a connection nothing would close. And a blob id is
 * a hash of content this deployment did not necessarily create, so the size of what came back was
 * whatever the other end chose to send.
 *
 * # Why the size check streams
 *
 * `content-length` is a claim made by a server we do not run. It can be absent under chunked
 * encoding, it can be wrong, and a hostile one can understate it — so it is a free early exit, not
 * the guard. The guard counts what actually arrives and stops mid-transfer, which `arrayBuffer()`
 * cannot do: by the time it returns, the allocation has already happened.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

process.env['PROJECTX_WALRUS_AGGREGATOR_URL'] = 'https://aggregator.invalid';

const { readBlob } = await import('../lib/walrus');

/** A valid-looking blob id, so nothing is refused before the read under test. */
const BLOB = 'A'.repeat(43);

/** A body delivered in chunks, so the streaming count is what decides — not one big buffer. */
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
    // The concatenation is hand-written, so a bug there would corrupt every sealed body rather
    // than failing loudly. Asserted with content, not just a length.
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
    /*
      The case that matters. No content-length at all — chunked encoding, or a server that simply
      omits it — so the header check cannot fire and only the streaming count can refuse.
    */
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
    // A lying header is exactly why the streaming count exists rather than a header check alone.
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

    // Asserted on the signal reaching fetch rather than by waiting fifteen seconds for one to fire.
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports an abort as transport, not as a malformed blob', async () => {
    // A timeout is the network failing, not the content being wrong. Reported as the former so a
    // caller retries rather than concluding the blob is bad.
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

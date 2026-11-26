// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
//
// A body that is not JSON is the caller's mistake. Until 2026-11-25 thirty-five routes read it with
// `request.json()` inside a `try` whose `catch` wrote to error_events and answered 500, so any
// unauthenticated caller could add rows to the one table the error alarm reads. These tests hold
// the reader to the three things that fix depends on: the status is the client's, nothing is
// thrown for the route's `catch` to record, and the size limit counts bytes rather than trusting
// a header.

import { describe, expect, it } from 'vitest';
import { MAX_JSON_BODY_BYTES, readJsonBody, tooLarge } from '../lib/body-limit';

const post = (init: RequestInit): Request => new Request('https://weir.social/api/x', { method: 'POST', ...init });

async function streamOf(chunks: string[], delay = 0): Promise<Request> {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  // No Content-Length: a streamed body carries none, which is the case tooLarge cannot see.
  return new Request('https://weir.social/api/x', { method: 'POST', body, duplex: 'half' } as RequestInit);
}

describe('readJsonBody', () => {
  it('hands back what was sent, when it is JSON', async () => {
    const read = await readJsonBody(post({ body: '{"a":1,"b":["x"]}' }));
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toEqual({ a: 1, b: ['x'] });
  });

  it('answers a body that is not JSON as 400, for the caller', async () => {
    const read = await readJsonBody(post({ body: '{"sender":' }));
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.response.status).toBe(400);
      expect(await read.response.json()).toEqual({ error: 'the body is not JSON' });
    }
  });

  it('answers the single value null as 400, because a route reading a field from it throws', async () => {
    const read = await readJsonBody(post({ body: 'null' }));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.response.status).toBe(400);
  });

  it('answers an empty body as 400 rather than throwing on undefined', async () => {
    for (const init of [{ body: '' }, { body: '   \n' }, {}] as RequestInit[]) {
      const read = await readJsonBody(post(init));
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.response.status).toBe(400);
    }
  });

  it('does not throw, so a route’s catch has nothing to record as a failure', async () => {
    for (const init of [{ body: 'not json at all' }, { body: '' }, { body: '[1,' }] as RequestInit[]) {
      await expect(readJsonBody(post(init))).resolves.toBeTruthy();
    }
  });

  it('refuses a body past the limit from its declared length', async () => {
    const read = await readJsonBody(
      post({ headers: { 'content-length': String(MAX_JSON_BODY_BYTES + 1) }, body: '{}' }),
    );
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.response.status).toBe(413);
  });

  it('counts the bytes when no length is declared, and stops reading once past the limit', async () => {
    const fourMb = 'x'.repeat(4 * 1024 * 1024);
    let pulls = 0;
    const encoder = new TextEncoder();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(encoder.encode('x'.repeat(256 * 1024)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request('https://weir.social/api/x', { method: 'POST', body, duplex: 'half' } as RequestInit);

    const read = await readJsonBody(request, 1024 * 1024);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.response.status).toBe(413);
    // Five 256 KB chunks are enough to pass 1 MB; the reader must not have drained a stream
    // that never ends. The whole point of counting is that the limit holds without a header.
    expect(pulls).toBeLessThanOrEqual(7);
    expect(cancelled).toBe(true);
    void fourMb;
  });

  it('lets a route name a smaller limit, and a larger one', async () => {
    const small = await readJsonBody(post({ body: '{"a":"12345"}' }), 8);
    expect(small.ok).toBe(false);
    const large = await readJsonBody(post({ body: '{"a":"12345"}' }), 64);
    expect(large.ok).toBe(true);
  });

  it('answers a body that ends early as 400, not as JSON', async () => {
    const request = new Request('https://weir.social/api/x', {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"a":'));
          controller.error(new TypeError('terminated'));
        },
      }),
      duplex: 'half',
    } as RequestInit);
    const read = await readJsonBody(request);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.response.status).toBe(400);
  });

  it('accepts a streamed body with no Content-Length when it is within the limit', async () => {
    const read = await readJsonBody(await streamOf(['{"a":', '"bcdef"}']));
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toEqual({ a: 'bcdef' });
  });
});

describe('tooLarge', () => {
  it('sees only a declared length, which is why the reader counts as well', async () => {
    expect(tooLarge(await streamOf(['{}']), 1)).toBeNull();
    expect(tooLarge(post({ headers: { 'content-length': '2' }, body: '{}' }), 1)?.status).toBe(413);
  });
});

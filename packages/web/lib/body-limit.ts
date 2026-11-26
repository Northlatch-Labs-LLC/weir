// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';
import { NextResponse } from 'next/server';

export function tooLarge(request: Request, maxBytes: number): NextResponse | null {
  const declared = request.headers.get('content-length');
  if (declared === null) return null;

  const length = Number(declared);
  if (!Number.isFinite(length) || length < 0) return null;

  if (length > maxBytes) {
    return NextResponse.json(
      { error: `this request declares ${length} bytes; the limit is ${maxBytes}` },
      { status: 413 },
    );
  }
  return null;
}

/// The most JSON any route here has a reason to receive. A public post carries a body of up to
/// 100,000 characters — about 640 KB in the worst case, where every character is JSON-escaped —
/// and nothing else comes close. Vercel caps a request body at 4.5 MB, but that is the platform's
/// limit, not this application's, and a deployment that is not on Vercel has none.
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

export type JsonBody =
  | { ok: true; value: unknown }
  /** The body was the caller's mistake and has already been answered. Return `response`. */
  | { ok: false; response: NextResponse };

function refusal(error: string, status: number): JsonBody {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

/*
  Read a JSON body for a route, and answer a bad one as the caller's mistake.

  WHY THIS EXISTS. Until 2026-11-25 every JSON route read its body with `request.json()` inside a
  `try` whose `catch` did two things: wrote a row to error_events, and answered 500. A body that is
  not JSON — one truncated byte, an empty request, a form posted to a JSON route — is not a server
  failure, and answering it as one was wrong twice over. The status lied to a well-behaved client
  that then retried a request that would never work; and the row was a write any unauthenticated
  caller could make to the one table the hourly error alarm reads, so noise could bury a real
  failure. Fifty routes did it, which is why the fix is one function and not fifty edits to a
  catch block.

  What counts as the caller's mistake, and is answered 400 without being recorded:
    - not JSON, empty, or the single value `null`
    - a body that could not be read to the end (the connection closed mid-request)
  What is answered 413, also unrecorded:
    - a body past the limit, whether or not it declared a Content-Length. `tooLarge` above reads
      the declared length, which a chunked request does not send; this counts the bytes instead.

  Anything else a route throws is untouched by this function and still reaches its own `catch`.
*/
export async function readJsonBody(
  request: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<JsonBody> {
  const declared = tooLarge(request, maxBytes);
  if (declared !== null) return { ok: false, response: declared };

  let text: string;
  try {
    text = await readWithin(request, maxBytes);
  } catch (error) {
    if (error instanceof TooLarge) {
      return refusal(`this request is past the limit of ${maxBytes} bytes`, 413);
    }
    return refusal('the body could not be read to the end, so nothing was done', 400);
  }

  if (text.trim() === '') return refusal('a JSON body is required', 400);

  try {
    const value: unknown = JSON.parse(text);
    // `null` parses, and then throws in the first route that reads a field from it — which is the
    // 500 this function exists to prevent. No route here has a reason to receive it.
    if (value === null) return refusal('a JSON object is required', 400);
    return { ok: true, value };
  } catch {
    return refusal('the body is not JSON', 400);
  }
}

class TooLarge extends Error {}

/// The body as text, or TooLarge once more than `maxBytes` have arrived — at which point the
/// stream is cancelled rather than read to the end, so the limit is on memory and not on trust.
async function readWithin(request: Request, maxBytes: number): Promise<string> {
  if (request.body === null) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TooLarge();
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

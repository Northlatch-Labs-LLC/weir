// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';
import { NextResponse } from 'next/server';

/**
 * Refuse an over-large request before its body is read.
 *
 * # The order is the whole point
 *
 * `request.formData()` and `request.json()` buffer the entire body before returning, so a size
 * check that runs on the parsed result has already paid for the bytes it is about to refuse. The
 * upload route checked `file.size > MAX_BYTES` — correctly — one line after `await
 * request.formData()` had read the whole thing into memory. An eight-gigabyte body was refused
 * having already been received.
 *
 * `Content-Length` is a claim by the caller, not a fact, and it is checked here as a claim: a
 * request that DECLARES more than the limit is refused without reading, which stops the honest
 * mistake and the lazy attack. A request that lies about its length is not stopped by this and is
 * not meant to be — that is what the check on the parsed size is for, and it stays where it is.
 * The two are layers, not alternatives.
 *
 * Returns a response to return, or `null` to carry on — the same shape as `rateLimit`, because a
 * guard returning a boolean is one forgotten `return` away from admitting everything.
 */
export function tooLarge(request: Request, maxBytes: number): NextResponse | null {
  const declared = request.headers.get('content-length');
  if (declared === null) return null;

  const length = Number(declared);
  // A malformed header is not a refusal: it is a header we cannot read, and the parsed-size check
  // downstream is what catches a body that turns out to be too big.
  if (!Number.isFinite(length) || length < 0) return null;

  if (length > maxBytes) {
    return NextResponse.json(
      { error: `this request declares ${length} bytes; the limit is ${maxBytes}` },
      { status: 413 },
    );
  }
  return null;
}

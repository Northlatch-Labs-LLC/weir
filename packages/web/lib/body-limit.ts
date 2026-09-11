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

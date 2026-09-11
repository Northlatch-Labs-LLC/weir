// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { fail, ok, type Reading } from './reading.js';

export function decodeObjectBytes(
  content: unknown,
  source: string,
): Reading<Uint8Array | null> {
  if (content === undefined || content === null) return ok(null);

  const raw =
    typeof content === 'object' && content !== null && 'value' in content
      ? (content as { value?: unknown }).value
      : content;

  if (raw === undefined || raw === null) return ok(null);
  if (raw instanceof Uint8Array) return ok(raw);

  if (typeof raw === 'string') {
    if (raw === '') return ok(null);
    try {
      const binary = atob(raw);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return ok(bytes);
    } catch (error) {
      return fail(
        'malformed',
        source,
        `object content was a string but not base64: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (Array.isArray(raw)) {
    if (!raw.every((byte) => typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      return fail('malformed', source, 'object content was an array but not of bytes');
    }
    return ok(Uint8Array.from(raw as number[]));
  }

  if (typeof raw === 'object') {
    const values = Object.values(raw as Record<string, unknown>);
    if (values.length === 0) return ok(null);
    if (!values.every((byte) => typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      return fail('malformed', source, 'object content was an object but not array-like bytes');
    }
    return ok(Uint8Array.from(values as number[]));
  }

  return fail('malformed', source, `object content was a ${typeof raw}, which cannot be bytes`);
}

export function decodeObjectBytesAtLeast(
  content: unknown,
  minimumBytes: number,
  source: string,
): Reading<Uint8Array | null> {
  const decoded = decodeObjectBytes(content, source);
  if (!decoded.ok) return decoded;
  if (decoded.value === null) return decoded;
  if (decoded.value.length < minimumBytes) {
    return fail(
      'malformed',
      source,
      `object content decoded to ${decoded.value.length} bytes, expected at least ${minimumBytes}`,
    );
  }
  return decoded;
}

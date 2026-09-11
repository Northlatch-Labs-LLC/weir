// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { MANIFEST_HEADERS, servedManifest } from '@/lib/agent-manifest';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const served = await servedManifest(originOf(request));
  const { manifest } = served;
  const whole = manifest.unavailable === null && manifest.money?.platform != null;

  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': whole ? 'public, max-age=60' : 'no-store',
    'access-control-allow-origin': '*',
    'access-control-expose-headers': [
      MANIFEST_HEADERS.digest,
      MANIFEST_HEADERS.etag,
      MANIFEST_HEADERS.jws,
      'x-weir-manifest',
      'x-weir-manifest-version',
    ].join(', '),
    [MANIFEST_HEADERS.digest]: served.contentDigest,
    [MANIFEST_HEADERS.etag]: served.etag,
    'x-weir-manifest': manifest.manifest,
    'x-weir-manifest-version': String(manifest.version),
  };

  if (served.jws !== null) headers[MANIFEST_HEADERS.jws] = served.jws;

  return new Response(served.body, { headers });
}

function originOf(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (host === null || host.trim() === '') return url.origin;
  return `${proto === undefined || proto === '' ? url.protocol.replace(':', '') : proto}://${host.trim()}`;
}

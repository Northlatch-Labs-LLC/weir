// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const SECURITY_TXT = `Contact: mailto:abuse@weir.social
Expires: 2027-09-04T00:00:00Z
Policy: https://weir.social/security
Preferred-Languages: en
Canonical: https://weir.social/.well-known/security.txt
`;

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  return new Response(SECURITY_TXT, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}

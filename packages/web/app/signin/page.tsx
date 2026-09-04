// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { DesignSignin } from '@/components/design/Signin';

/**
 * Outside the `(app)` group: somebody signing in has no session yet, so the application shell would
 * be a menu of things they cannot reach. The design gives this page the public chrome.
 *
 * `next` is where Google returns them. It is read here and handed down rather than derived in the
 * component, and `safeNext` keeps it to a same-site path — an open redirect on a sign-in page is how
 * a phishing link borrows your domain.
 */
export const metadata: Metadata = {
  title: titleFor('/signin'),
  description:
    'Sign in with Google or connect a Sui wallet. Either way you get a Sui address only you control, and Weir never holds it.',
};

export const dynamic = 'force-dynamic';

/**
 * Only a path on this site, never an absolute URL.
 *
 * A value beginning `//` is protocol-relative and leaves the origin, so it is refused along with
 * anything not starting with a single `/`.
 */
export function safeNext(raw: string | undefined): string {
  if (raw === undefined) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export default async function SigninPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <DesignSignin nextPath={safeNext(next)} />;
}

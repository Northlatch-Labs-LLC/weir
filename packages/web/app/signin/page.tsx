// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { SigninScreen } from '@/components/app/SigninScreen';

export const metadata: Metadata = {
  title: titleFor('/signin'),
  description:
    'Sign in with Google or connect a Sui wallet. Either way ends the same: a Sui address your keys sign for.',
};

export const dynamic = 'force-dynamic';

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
  return <SigninScreen nextPath={safeNext(next)} />;
}

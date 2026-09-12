// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { fold } from '@projectx-social/sdk';
import { provenReader } from '@/lib/read-session';
import { FeedView } from '@/components/feed/FeedView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Feed',
  description: 'Posts from the creators on Weir. A paid post opens when your wallet holds the unlock or the subscription for it.',
};

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ reader?: string; view?: string }>;
}) {
  const { reader, view } = await searchParams;
  /*
    The feed is for signed-in readers. Home is where a reader signs in; the feed is where they go
    after. A reader with no proved session is sent to sign in and returned here.
  */
  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  if (viewer === null) redirect('/signin?next=/feed');
  return <FeedView reader={reader} requested={view} />;
}

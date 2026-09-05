// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
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
  return <FeedView reader={reader} requested={view} />;
}

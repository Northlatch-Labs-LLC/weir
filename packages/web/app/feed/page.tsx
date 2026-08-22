// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { Metadata } from 'next';
import { FeedView } from '@/components/feed/FeedView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Feed',
  description: 'Posts from the creators on Weir. Paid bodies stay locked until an unlock or a subscription held by your address says otherwise.',
};

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ reader?: string; view?: string }>;
}) {
  const { reader, view } = await searchParams;
  return <FeedView reader={reader} requested={view} />;
}

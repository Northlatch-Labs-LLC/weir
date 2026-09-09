// Built-by: @projectx.sui · Co-authored-by: Claude
import { FeedView } from '@/components/feed/FeedView';

export const dynamic = 'force-dynamic';

/**
 * The front door is the product.
 *
 * `/` used to fork: a marketing landing for a guest, the feed for a member. That fork is why the
 * front page carried a second header and a footer belonging to a website rather than to this
 * application — and it meant the first thing a new reader saw was an argument for the place
 * instead of the place.
 *
 * It is the feed for everyone now. A guest gets the public sample, in the same frame, with the
 * wallet control in the rail where it is on every other route. `components/design/landing-data`
 * still exists and is one import away if a marketing page is wanted again — at its own address,
 * not at this one.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ reader?: string; view?: string }>;
}) {
  const { reader, view } = await searchParams;
  return <FeedView reader={reader} requested={view} />;
}

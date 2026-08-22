// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { fold } from '@projectx-social/sdk';
import { provenReader } from '@/lib/read-session';
import { LandingData } from '@/components/design/landing-data';
import { FeedView } from '@/components/feed/FeedView';

export const dynamic = 'force-dynamic';

/**
 * The front door.
 *
 * `/` is two things: the landing for somebody who has just arrived, and the feed for somebody who
 * is signed in. The test is generous in the *guest* direction — a proved session or a connected
 * wallet (`?reader=`) means "here to use the product" and gets the feed; anybody else gets the
 * argument for it. A failed session read therefore shows marketing, which leaks nothing.
 *
 * The feed's own address is `/feed`, where a guest can also see the public sample.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ reader?: string; view?: string }>;
}) {
  const { reader, view } = await searchParams;
  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  if (viewer === null && reader === undefined) {
    return <LandingData signedIn={false} myHandle={null} />;
  }
  return <FeedView reader={reader} requested={view} />;
}

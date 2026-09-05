// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { fold } from '@projectx-social/sdk';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { ChestsData } from '@/components/design/chests-data';

/** `/chests` — donation boxes. Public: a guest can read them and is routed to sign in to give. */
export const metadata: Metadata = {
  title: titleFor('/chests'),
  description: 'Give a creator any amount, once, on chain. The platform fee comes off at settlement; the rest is theirs and it does not come back.',
};

export const dynamic = 'force-dynamic';

export default async function ChestsPage() {
  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  const handle =
    viewer === null
      ? null
      : fold(
          await accountHandle(viewer),
          (value) => value,
          () => null,
        );

  return <ChestsData signedIn={viewer !== null} myHandle={handle} />;
}

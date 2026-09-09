// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { fold } from '@projectx-social/sdk';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { MessagesScreen } from '@/components/app/MessagesScreen';
import { Discovery } from '@/components/shell/Discovery';

/**
 * `/messages` — private messages.
 *
 * The page reads only what the frame needs to name the account: the proved session and its handle.
 * The conversation itself is read inside `Messages`, over signed requests, because reading a thread
 * requires proof rather than an address anybody can type.
 */
export const metadata: Metadata = { title: titleFor('/messages') };

export const dynamic = 'force-dynamic';

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ reader?: string }>;
}) {
  const { reader } = await searchParams;

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

  return (
    <MessagesScreen
      discovery={<Discovery />}
      viewerAddress={viewer}
      viewerHandle={handle}
      {...(reader === undefined ? {} : { reader })}
    />
  );
}

// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { fold } from '@projectx-social/sdk';
import { titleFor } from '@/lib/site-map';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { StudioScreen } from '@/components/app/StudioScreen';
import { Discovery } from '@/components/shell/Discovery';

export const metadata: Metadata = { title: titleFor('/studio') };

export const dynamic = 'force-dynamic';

/**
 * Creator studio.
 *
 * The page reads who is asking — proved, never claimed — and hands the frame their handle. The
 * composer beneath it is unchanged: it is the code that prices a post on chain and seals a body,
 * and it waits for a wallet on its own terms.
 *
 * A visitor with no wallet still gets the whole explanation rather than a form they cannot use,
 * which is the split `/join` and `/creator` already make.
 */
export default async function Studio({
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
    <StudioScreen
      discovery={<Discovery />}
      viewerAddress={viewer}
      viewerHandle={handle}
      {...(reader === undefined ? {} : { reader })}
    />
  );
}

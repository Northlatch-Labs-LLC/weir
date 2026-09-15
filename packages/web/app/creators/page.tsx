// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { titleFor } from '@/lib/site-map';
import { createClient, fold, readPlatform } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { CreatorsScreen } from '@/components/app/CreatorsScreen';

export const metadata: Metadata = {
  title: titleFor('/creators'),
  description: 'Memberships, pools and chests: how a page earns on Weir.',
};

export const dynamic = 'force-dynamic';

export default async function CreatorsPage() {
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

  /*
    Earn is two different screens wearing one name. To somebody who has no account it is the case
    for having one. To somebody who holds a handle it is their creator section, and that already
    exists at /creator: opening the vault, the tiers, opening and closing the page, each simulated
    and signed. Sending them to the page that sells the idea instead is how a creator ends up with
    a handle, a page, and no way to be paid for it.
  */
  if (handle !== null) redirect('/creator');

  const config = siteConfig();
  const client = config.ok ? createClient(config.value) : null;
  const platform =
    client === null || !config.ok
      ? null
      : fold(
          await readPlatform(client, config.value),
          (value) => value,
          () => null,
        );

  return (
    <CreatorsScreen
      viewerAddress={viewer}
      viewerHandle={handle}
      feeBps={platform === null ? null : Number(platform.feeBps)}
    />
  );
}

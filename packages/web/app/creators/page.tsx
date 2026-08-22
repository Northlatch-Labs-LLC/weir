// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { createClient, fold, readPlatform } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { DesignJoin } from '@/components/design/Join';

export const metadata: Metadata = { title: titleFor('/creators') };

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
    <DesignJoin
      signedIn={viewer !== null}
      myHandle={handle}
      feeBps={platform === null ? null : Number(platform.feeBps)}
    />
  );
}

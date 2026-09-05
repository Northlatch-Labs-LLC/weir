// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { fold } from '@projectx-social/sdk';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { VaultData } from '@/components/design/vault-data';
import { AccountTabs } from '@/components/shell/AccountTabs';

/** `/vault` — My Vault. The reader's own object, read from the chain and rendered verbatim. */
export const metadata: Metadata = { title: titleFor('/vault') };

export const dynamic = 'force-dynamic';

export default async function VaultPage() {
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
    <>
      <AccountTabs />
      <VaultData viewer={viewer} myHandle={handle} />
    </>
  );
}

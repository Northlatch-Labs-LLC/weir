// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { fold } from '@projectx-social/sdk';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { SecurityData } from '@/components/design/security-data';

/** `/security` — the page a sceptic reads. Public, so it sits outside the application shell. */
export const metadata: Metadata = { title: titleFor('/security') };

export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
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

  return <SecurityData signedIn={viewer !== null} myHandle={handle} />;
}

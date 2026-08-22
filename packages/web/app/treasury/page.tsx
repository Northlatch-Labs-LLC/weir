// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { fold } from '@projectx-social/sdk';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { TreasuriesData } from '@/components/design/treasuries-data';

/** `/treasury` — the deposit stays yours; the yield doesn't. Public. */
export const metadata: Metadata = { title: titleFor('/treasury') };

export const dynamic = 'force-dynamic';

export default async function TreasuriesPage() {
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

  return <TreasuriesData signedIn={viewer !== null} myHandle={handle} />;
}

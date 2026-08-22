// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { fold } from '@projectx-social/sdk';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { ExploreData } from '@/components/design/explore-data';

/**
 * Moved out of the `(app)` group: this is a surface a visitor reaches before signing in, and the
 * design gives it full-width chrome rather than the application shell.
 *
 * The session is *proved*, never claimed. A failed read renders guest chrome, which is the locked
 * direction — guest chrome shown to a signed-in reader is a small indignity; signed-in chrome shown
 * to somebody we could not identify is a leak.
 */
export const metadata: Metadata = { title: titleFor('/explore') };

export const dynamic = 'force-dynamic';

export default async function ExplorePage() {
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

  return <ExploreData signedIn={viewer !== null} myHandle={handle} />;
}

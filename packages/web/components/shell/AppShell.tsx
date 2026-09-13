// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { fold } from '@projectx-social/sdk';
import { Reveals } from '@/components/shell/Reveals';
import { Discovery } from '@/components/shell/Discovery';
import { ChromeRouter } from '@/components/shell/ChromeRouter';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { avatarUrl } from '@/lib/avatar';
import { findProfileByOwner } from '@/lib/content';

export { isPublicPage, carriesItsOwnFrame, normalisePath } from '@/components/shell/ChromeRouter';

export async function AppShell({ children }: { children: React.ReactNode }) {
  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  const myHandle =
    viewer === null
      ? null
      : fold(
          await accountHandle(viewer),
          (value) => value,
          () => null,
        );

  const myFace = viewer === null ? null : avatarUrl((await findProfileByOwner(viewer))?.imageBlobId ?? null);

  return (
    <>
      <Reveals />
      <ChromeRouter
        viewer={
          viewer === null
            ? { signedIn: false }
            : { signedIn: true, address: viewer, handle: myHandle, displayName: myHandle, avatarUrl: myFace }
        }
        discovery={<Discovery />}
      >
        {children}
      </ChromeRouter>
    </>
  );
}

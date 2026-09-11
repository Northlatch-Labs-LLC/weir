// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { fold } from '@projectx-social/sdk';
import { Reveals } from '@/components/design/Reveals';
import { Discovery } from '@/components/shell/Discovery';
import { ChromeRouter } from '@/components/shell/ChromeRouter';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';

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

  return (
    <>
      {/* The scroll entrance the older pages run. Without it a `data-reveal` section stays at
          opacity 0 — invisible, not merely unanimated. It stays until those sections are gone. */}
      <Reveals />
      <ChromeRouter
        viewer={
          viewer === null
            ? { signedIn: false }
            : { signedIn: true, address: viewer, handle: myHandle, displayName: myHandle }
        }
        discovery={<Discovery />}
      >
        {children}
      </ChromeRouter>
    </>
  );
}

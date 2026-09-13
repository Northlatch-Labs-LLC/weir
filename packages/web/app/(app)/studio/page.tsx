// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { fold } from '@projectx-social/sdk';
import { titleFor } from '@/lib/site-map';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { StudioScreen } from '@/components/app/StudioScreen';
import { Discovery } from '@/components/shell/Discovery';

export const metadata: Metadata = {
  title: titleFor('/studio'),
  description: 'Write a post, choose who can read it, and publish it under your own signature.',
};

export const dynamic = 'force-dynamic';

export default async function Studio() {

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
    />
  );
}

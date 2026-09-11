'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import type { ReactNode } from 'react';
import NextLink from 'next/link';
import { ColumnHeader } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';
import { Messages } from '@/components/Messages';

export function MessagesScreen({
  viewerAddress,
  viewerHandle,
  reader,
  discovery,
}: {
  viewerAddress: string | null;
  viewerHandle: string | null;
  reader?: string | undefined;
  discovery?: ReactNode;
}) {
  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({ signedIn: true, address: viewerAddress, handle: viewerHandle, displayName: viewerHandle } as const);

  const aside: ReactNode = (
    <>
      <section className="w-card">
        <h3>How the encryption works</h3>
        <p>
          Your encryption key is derived from one wallet signature and never leaves this tab. This
          site stores ciphertext and a key envelope for each participant.
        </p>
        <p>
          Your public key lives in a shared registry on Sui. Only your own address can write your
          entry and anyone can read it, including you, directly from the chain. Publishing it is a
          transaction, so it costs a little gas once.
        </p>
      </section>

      <section className="w-card">
        <h3>What it does not cover</h3>
        <p>
          Metadata is not encrypted: who you message, when, and how often. A message to someone who
          has not published a key is sent in plaintext, and each message says which it is.
        </p>
        <p>
          Rotating your key makes everything sent to the old one unreadable. The derivation relies
          on a signature being reproducible, so it works with a keypair wallet and not with zkLogin,
          whose signatures change every session.
        </p>
      </section>

      <p style={{ margin: '4px 2px 0', fontFamily: 'var(--w-sans)', fontSize: 12, lineHeight: 1.7, color: 'var(--w-ink-6)' }}>
        <NextLink href="/alerts">Alerts</NextLink> · <NextLink href="/vault">Vault</NextLink> ·{' '}
        <NextLink href="/security">Security</NextLink> · Built on Sui
      </p>
    </>
  );

  return (
    <AppFrame
      viewer={viewer}
      reader={reader}
      aside={
        <>
          {aside}
          {discovery}
        </>
      }
    >
      <ColumnHeader title="Messages" sub="encrypted in your browser" />

      {/* Fills the room between header and footer — see `.w-fill`. */}
      <div className="w-fill" style={{ padding: '18px 20px 32px' }}>
        <Messages />
      </div>
    </AppFrame>
  );
}

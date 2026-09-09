'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Messages, in the application frame.
 *
 * # The conversation itself is not re-drawn here
 *
 * `Messages` is mounted unchanged. It holds the key derivation, the four-state key lookup and the
 * send path — and the thing that path is careful about is that a message is never silently sent in
 * plaintext when the sender was shown the word "encrypted". Re-typing that markup onto new class
 * names would put every one of those decisions back in play for a change that is about chrome. So
 * the frame moved and the component did not.
 *
 * # What the frame supplies and what it does not
 *
 * The rail's account is the proved session read on the server. The signer inside `Messages` is the
 * wallet in this browser, and they are separate facts: the frame naming an address does not sign
 * anything, and `Messages` still asks for a signature per action.
 */

import type { ReactNode } from 'react';
import NextLink from 'next/link';
import { ColumnHeader } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';
import { Messages } from '@/components/Messages';

export function MessagesScreen({
  viewerAddress,
  viewerHandle,
  reader,
}: {
  viewerAddress: string | null;
  viewerHandle: string | null;
  reader?: string | undefined;
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
    <AppFrame viewer={viewer} reader={reader} aside={aside}>
      <ColumnHeader title="Messages" sub="encrypted in your browser" />

      <div style={{ padding: '18px 20px 32px' }}>
        <Messages />
      </div>
    </AppFrame>
  );
}

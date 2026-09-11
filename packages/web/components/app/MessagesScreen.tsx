'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
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
  discovery,
}: {
  viewerAddress: string | null;
  viewerHandle: string | null;
  reader?: string | undefined;
  /**
   * The discovery column, read on the server and handed down.
   *
   * A server component passed as a prop into a client one: this screen cannot read the store
   * itself, and the rail is the same rail every other wrapped route gets. Optional, so a test or a
   * caller without it renders the page's own cards and nothing else.
   */
  discovery?: ReactNode;
}) {
  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({ signedIn: true, address: viewerAddress, handle: viewerHandle, displayName: viewerHandle } as const);


  /*
    The page's own cards, and then the people.

    These four screens pass an `aside`, and an `aside` REPLACES the discovery column rather than
    joining it — so `/vault`, `/studio`, `/alerts` and `/messages` were the only wrapped routes with
    no faces on them at all, and 337 to 715 pixels of empty ground under one explanatory card. The
    discovery rail is read on the server and handed down as `discovery`, so it renders beneath the
    page's own cards instead of replacing them.
  */
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

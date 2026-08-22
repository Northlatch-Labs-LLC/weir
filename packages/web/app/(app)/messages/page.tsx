// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { Messages } from '@/components/Messages';
import { PageHead } from '@/components/design/PageHead';
import { AccountTabs } from '@/components/shell/AccountTabs';

export const metadata: Metadata = { title: titleFor('/messages') };

export const dynamic = 'force-dynamic';

export default function MessagesPage() {
  return (
    <>
      {/* Chrome from `AppFrame`; `PageHead` restores the `h1` the retired title bar used to supply. */}
      <PageHead
        kicker="Your account"
        title="Encrypted in your browser, when both of you"
        accent="hold a key."
        lede="Private messages, encrypted in your browser. Only you and the person you write to can read them — not this server, not anyone else."
      />
      <AccountTabs />

      <Messages />

      <div data-reveal className="note" style={{ marginTop: 28 }}>
        <span className="lbl">How the encryption works</span>
        <p>
          Your encryption key is derived from one wallet signature and never leaves this tab. The
          server stores ciphertext and a key envelope for each participant, and holds nothing that
          can open either.
        </p>
        <p style={{ marginTop: 10 }}>
          Your <strong>public</strong> key lives in a shared registry on Sui, not in this server's
          database. Only your own address can write your entry, and anyone can read it — including
          you, directly from the chain. That is what stops this site from hiding your key
          from someone trying to write to you, which would quietly push them back to plaintext with
          nothing looking wrong. Publishing it is a transaction, so it costs a little gas once.
        </p>
      </div>

      <div data-reveal className="note warn" style={{ marginTop: 12 }}>
        <span className="lbl">What it still does not cover</span>
        <p>
          <strong>Metadata is not encrypted.</strong> Who you message, when, and how often is
          visible to whoever operates this site, and encrypting the words does not change
          that. Messages sent to someone who has not published a key are sent in plaintext, and each
          message says which it is. Rotating your key makes everything sent to the old one
          unreadable — there is no re-wrapping, because nothing here can re-wrap without your key.
          And because the derivation relies on a signature being reproducible, it works with a
          keypair wallet and <strong>not with zkLogin</strong>, whose signatures change every
          session.
        </p>
      </div>
    </>
  );
}

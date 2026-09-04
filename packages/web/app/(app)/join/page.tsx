// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { JoinFlow } from '@/components/JoinFlow';
import { PageHead } from '@/components/design/PageHead';
import { readProtocol } from '@/lib/chain';
import { fold } from '@projectx-social/sdk';

export const metadata: Metadata = {
  title: titleFor('/join'),
  description:
    'Pick a handle and claim it on chain. Gas only, no password, no email; nobody can take the account away.',
};

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;

export default async function Join({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  /*
    A referrer is accepted only if it is shaped like an address. Anything else is dropped rather
    than passed through: the value is written into the account permanently and there is no setter,
    so a malformed one would abort the registration, and a plausible-but-wrong one would attribute
    someone's referral revenue to a stranger for the life of the account.
  */
  const referrer = ref !== undefined && SUI_ADDRESS.test(ref) ? ref : null;

  const protocol = await readProtocol();

  return (
    <>
      {/*
        This route is reachable without an account by definition — it is where somebody gets one —
        so it renders inside the guest frame, one centred column with no dashboard rail around it.
      */}
      <PageHead
        kicker="Join"
        title="An account is an object you"
        accent="hold."
        lede="Pick a handle and claim it on chain. No password and no email: your account is an object only your address holds, so it cannot be sold, lent or taken."
      />


        {/*
          What this page is for, rendered on the server for everybody.

          `JoinFlow` is a client component that shows nothing until a wallet is connected, so a
          visitor arriving here — including from the front page's "Become a creator" button — read a
          heading and a blank column. The gate was hiding this explanation as well as the form.

          Server-rendered rather than another signed-out branch inside the flow: it is the same
          answer for everyone, it is what a shared link or a search result should show, and it does
          not depend on anything the browser has to resolve first.
        */}
        <div data-reveal className="card" style={{ marginTop: 'var(--space-20)' }}>
          <h2 style={{ marginTop: 0 }}>What you get, and what it costs</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            A handle is a <span className="mono">SocialAccount</span> object on Sui that your address
            owns. It is your name here, <span className="mono">@yourname</span>, and the thing the
            contracts check before anyone can subscribe to you, tip you or unlock what you publish.
          </p>
          <div style={{ display: 'grid', gap: 'var(--space-16)', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <div className="stat">
              <span className="k">What it costs</span>
              <span className="v" style={{ fontSize: 'var(--text-h4)' }}>Gas only</span>
            </div>
            <div className="stat">
              <span className="k">Who can take it away</span>
              <span className="v" style={{ fontSize: 'var(--text-h4)' }}>Nobody</span>
            </div>
            {/*
              This said "A wallet", and it was not true.

              `zkLoginSignerAdapter` in `components/SignerProvider.tsx` returns a full `ActiveSigner`
              labelled "Google" — a zkLogin session can claim a handle exactly as a wallet session
              can, and `/signin` offers that path first. So this line stated a requirement the code
              does not have, and contradicted the page the visitor had just come from.
            */}
            <div className="stat">
              <span className="k">What you need first</span>
              <span className="v" style={{ fontSize: 'var(--text-h4)' }}>Google or a wallet</span>
            </div>
          </div>
          {/*
            What "gas" is, said once, for the reader who has never paid any.

            "Gas only" is accurate and answers nothing: somebody arriving from outside crypto cannot
            tell whether that means a cent or fifty dollars.

            No figure is quoted, deliberately. Gas is price times the amount a particular transaction
            uses, and both move; a number printed here would be a measurement nobody took. The order
            of magnitude is safe to state and is what the question is actually asking.
          */}
          <p style={{ color: 'var(--text-secondary)', marginTop: 'var(--space-16)', marginBottom: 0 }}>
            Gas is what Sui charges to write your account to the chain: a fraction of a cent, paid to
            the network&rsquo;s validators rather than to us. Your wallet shows the exact amount before
            you approve it, and nothing is charged if you decline.
          </p>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 0, marginTop: 'var(--space-16)' }}>
            Registering does not make you a creator; that is a separate decision, and opening a
            vault comes later. An account on its own lets you follow, comment, subscribe and be paid
            back from a vault you support.
          </p>
        </div>


      {/*
        Registration, on its own.
      */}
      <div style={{ marginTop: 24 }}>
        <JoinFlow referrer={referrer} />
      </div>

      {fold(
        protocol,
        (snapshot) =>
          snapshot.platform.creationPaused ? (
            <div data-reveal className="note crit" style={{ marginTop: 20 }}>
              <span className="lbl">Registration is paused on chain</span>
              <p>
                The platform has <span className="mono">creation_paused</span> set, so{' '}
                <span className="mono">account::open</span> will abort. This is read from the
                Platform object, not from a setting here — nothing in this application can override
                it.
              </p>
            </div>
          ) : null,
        (failure) => (
          <div data-reveal className="note crit" style={{ marginTop: 20 }}>
            <span className="lbl">Could not read this: {failure.kind}</span>
            <p>
              The platform&rsquo;s terms could not be read, so this page cannot tell you whether
              registration is currently open. {failure.detail}
            </p>
          </div>
        ),
      )}

      <div data-reveal className="note" style={{ marginTop: 20 }}>
        <span className="lbl">What claiming a handle actually does</span>
        <p>
          It writes your address into a shared registry on Sui and mints you an account object.
          Handles are unique, first come, and rejected rather than normalised: asking for{' '}
          <span className="mono">Alice</span> does not quietly give you{' '}
          <span className="mono">alice</span>. One account per address, enforced by the contract.
        </p>
      </div>

      <footer>
        Registration is free. The protocol&rsquo;s creation fee applies to creator vaults, not to
        identities. A signup paywall on a social product leaves nobody to sell to.
      </footer>
        </>
  );
}

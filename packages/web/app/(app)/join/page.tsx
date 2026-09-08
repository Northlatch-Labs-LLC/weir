// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { JoinFlow } from '@/components/JoinFlow';
import { PageHead } from '@/components/design/PageHead';
import { readProtocol } from '@/lib/chain';
import { fold } from '@projectx-social/sdk';

export const metadata: Metadata = {
  title: titleFor('/join'),
  description:
    'Pick a handle and claim it on chain. No password, no email, and it is free.',
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
        title="Pick your name"
        lede="Pick a handle and claim it on chain. No password, no email, and it is yours."
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
            Your handle is your name here &mdash; <span className="mono">@yourname</span>. You own it
            outright, and it is what people subscribe to, tip, and unlock.
          </p>
          <div style={{ display: 'grid', gap: 'var(--space-16)', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            {/*
              These read "What it costs / Gas only" and "Who can take it away / Nobody".

              The first is jargon: somebody outside crypto cannot tell whether gas is a cent or
              fifty dollars, and the paragraph below already explains it properly. The second raises
              a threat in order to deny it — a question the reader had not asked, answered in the
              defensive register, on the page where they are deciding to sign up.
            */}
            <div className="stat">
              <span className="k">Price</span>
              <span className="v" style={{ fontSize: 'var(--text-h4)' }}>Free</span>
            </div>
            <div className="stat">
              <span className="k">Yours to keep</span>
              <span className="v" style={{ fontSize: 'var(--text-h4)' }}>Always</span>
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
                New handles are paused right now. This is set on chain, so nothing on this site
                can override it. It lifts when the platform reopens.
              </p>
            </div>
          ) : null,
        (failure) => (
          <div data-reveal className="note crit" style={{ marginTop: 20 }}>
            <span className="lbl">This did not load</span>
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

      {/*
        The sentence that followed this said "a signup paywall on a social product leaves nobody to
        sell to" — our reasoning about our own pricing, printed on the page where somebody is
        deciding to join. Nobody explains their business model to a customer mid-signup. What they
        need is the price, which is nothing.
      */}
      <footer>Creating an account is free.</footer>
        </>
  );
}

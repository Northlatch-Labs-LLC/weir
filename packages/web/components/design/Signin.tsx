'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { PageHead } from '@/components/design/PageHead';
import { Fragment, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/design/icons';
import { useSigner } from '@/components/SignerProvider';

export function DesignSignin({ nextPath = '/' }: { nextPath?: string }) {
  const {
    wallets: usable,
    unusableWallets,
    signInWithGoogle,
    connectWallet,
    signer,
    accountChoice,
  } = useSigner();
  const router = useRouter();

  /*
    Return the reader to where they were going.

    This page has always said "After signing in you return to /c/heron", and for a wallet it never
    did: `safeNext` sanitised the parameter, six assertions covered it, `signInWithGoogle` used it —
    and the wallet branch called `connectWallet` and stopped. The reader signed in their extension
    and sat on the sign-in page.

    It waits for the signer rather than firing on the connect, because `connectWallet` resolves when
    the extension answers and the signer arrives on the next render. And it waits for
    `accountChoice` to clear: a wallet holding several addresses asks which one, and navigating out
    from under that question picks for them.

    Not gated on the read-content signature. That is a separate step with its own control in the
    header, and holding the reader here until they give it would be the same dead end wearing a
    different hat.

    `replace`, not `push`: signing in is not a place in the reader's history, and a back button that
    returns them to a sign-in page they have already used reads as the sign-in having failed.
  */
  useEffect(() => {
    if (signer === null || accountChoice !== null) return;
    router.replace(nextPath);
  }, [signer, accountChoice, nextPath, router]);

  const wallets = [
    ...usable.map((w) => ({
      name: w.name,
      icon: <Icon name="wallet" size={16} />,
      state: 'detected',
      onClick: () => void connectWallet(w),
    })),
    ...unusableWallets.map((w) => ({
      name: w.name,
      icon: <Icon name="wallet" size={16} />,
      state: w.missing.length === 0 ? 'unusable' : `missing ${w.missing.join(', ')}`,
      onClick: () => {},
    })),
  ];

  const onSignInZk = () => void signInWithGoogle(nextPath);

  return (
    <>
          <div className="weir-page" style={{ maxWidth: '36rem', marginInline: 'auto', padding: '4rem 1.5rem 6rem' }}>
            <PageHead
              centered
              kicker="Sign in"
              title="Sign in, and the"
              accent="address is yours."
              lede="Either path ends the same way: a real Sui address, and your keys are what sign for it. Nothing to remember, nothing to reset."
            />
            <div style={{ display: 'grid', gap: '1.5rem' }}>
              <div style={{ background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '1.5rem' }}>
                <h3 style={{ margin: '0 0 0.5rem', fontFamily: '\'Geist\',sans-serif', fontWeight: '600', fontSize: '1.1875rem' }}>Sign in with Google</h3>
                <p style={{ margin: '0 0 1.25rem', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', maxWidth: '62ch', textWrap: 'pretty' }}>Sign in the way you would anywhere else and you get a Sui address of your own. No seed phrase to write down, nothing to install. Google never learns the address, and the chain never learns the Google account. The technique is called zkLogin: a salt held on our server, a proof made by a prover, both named in the docs.</p>
                <button className="dh-f2bac7c4" type="button" onClick={onSignInZk} style={{ padding: '0.7rem 1.35rem', borderRadius: '10px', font: '600 0.9375rem \'Geist\',sans-serif', lineHeight: '1', background: 'var(--crest,#8be3c6)', color: 'var(--bg,#04161d)', border: '1px solid transparent', cursor: 'pointer', boxShadow: '0 0 22px -6px rgba(var(--crest-rgb,139,227,198),0.5)', transition: 'transform 0.12s ease,background-color 0.12s ease,box-shadow 0.18s ease' }}>Continue with Google</button>
              </div>
              <div style={{ background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '1.5rem' }}>
                <h3 style={{ margin: '0 0 0.5rem', fontFamily: '\'Geist\',sans-serif', fontWeight: '600', fontSize: '1.1875rem' }}>Connect a Sui wallet</h3>
                <p style={{ margin: '0 0 1.25rem', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', maxWidth: '62ch', textWrap: 'pretty' }}>Already keep your own keys? Connect directly over the Wallet Standard.</p>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {(wallets ?? []).map((w, i) => (<Fragment key={i}>
                    <button className="dh-05de5f5a" type="button" onClick={w.onClick} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%', textAlign: 'left', background: 'var(--line-2,var(--line-2,#123039))', border: '1px solid var(--line,#1c3d47)', borderRadius: '10px', padding: '0.7rem 1rem', color: 'var(--ink,#dce9e6)', font: '500 0.9375rem \'Geist\',sans-serif', cursor: 'pointer', transition: 'border-color 0.12s ease,transform 0.12s ease' }}>
                      <span aria-hidden="true" style={{ width: '1.75rem', height: '1.75rem', borderRadius: '6px', flexShrink: '0', background: 'var(--bg,#04161d)', border: '1px solid var(--line,#1c3d47)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--crest,#8be3c6)' }}>{w.icon}</span>
                      <span>{w.name}</span>
                      <span style={{ marginLeft: 'auto', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>{w.state}</span>
                    </button>
                  </Fragment>))}
                </div>
              </div>
            </div>
            <p style={{ margin: '2rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>After signing in you return to {nextPath === '/' ? 'the home page' : <span style={{ fontFamily: 'var(--weir-mono)', color: 'var(--crest,#8be3c6)' }}>{nextPath}</span>}.</p>
            <p style={{ margin: '0.75rem 0 0', paddingTop: '1.25rem', borderTop: '1px solid var(--line,#1c3d47)', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', maxWidth: '62ch', textWrap: 'pretty' }}>Running an agent? It does not sign in here; it declares itself with two signatures. <a href="/agents" style={{ color: 'var(--crest,#8be3c6)' }}>How to declare it →</a></p>
          </div>
    </>
  );
}

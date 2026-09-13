'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SignInDoors } from '@/components/app/SignInDoors';
import { useSigner } from '@/components/SignerProvider';
import { afterSignIn, FEED } from '@/lib/after-signin';

/*
  Returns the reader to where they were going once they are signed in — and signed in means two
  things here, not one. A wallet that connects gives this page a signer; the server knows nothing
  of it until the reader signs one message and the answer becomes the read-session cookie. The
  feed, the welcome screens and everything behind the door ask the server, not the wallet.

  Leaving on the signer alone sent a reader with the signature request still open in their wallet
  to the feed, which sent them straight back here, which sent them to the feed again: hundreds of
  round trips a minute until they signed or closed the tab. So this page waits for the proof, and
  then asks the server the same question the destination will ask before it goes. A "yes" that
  the destination would not agree with cannot loop; it stops here, with the reason on screen.

  It waits for `accountChoice` to clear too, because a wallet holding several addresses asks which
  one, and navigating out from under that question picks for them. `replace`, not `push`: a
  sign-in page is not a place in the reader's history.
*/
export function SigninPanel({ nextPath: requested }: { nextPath?: string }) {
  const nextPath = afterSignIn(requested);
  const { signer, accountChoice, proof, proveSession } = useSigner();
  const router = useRouter();
  const [stuck, setStuck] = useState<string | null>(null);

  useEffect(() => {
    if (signer === null || accountChoice !== null || proof !== 'proved') return;
    let cancelled = false;
    setStuck(null);
    void (async () => {
      try {
        const current = (await (await fetch('/api/session')).json()) as { reader?: string | null; checked?: boolean };
        if (cancelled) return;
        if (current.checked === true && current.reader != null && current.reader.toLowerCase() === signer.address.toLowerCase()) {
          router.replace(nextPath);
          return;
        }
        setStuck(
          'Your wallet confirmed this account, but the server did not keep the sign-in. That usually means this browser is blocking cookies for weir.social. Allow them and confirm again.',
        );
      } catch {
        if (!cancelled) setStuck('The sign-in could not be checked with the server. Try again in a moment.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signer, accountChoice, proof, nextPath, router]);

  const connected = signer !== null && accountChoice === null;

  return (
    <div className="w-body">
      {connected && (proof === 'unknown' || proof === 'checking') ? (
        <p className="w-stage" role="status">
          Confirm this account in {signer.label}. It asks for one signature, which tells this site the address is
          yours. It costs nothing and sends nothing.
        </p>
      ) : connected && (proof === 'unproved' || proof === 'declined') ? (
        <div role="status">
          <p className="w-stage w-stage--failed">
            {signer.label} is connected, but the account is not confirmed, so nothing behind the door can open yet.
          </p>
          <div className="w-actions w-actions--after">
            <button type="button" className="w-btn w-btn--primary w-btn--sm" onClick={() => void proveSession()}>
              Confirm this account
            </button>
          </div>
        </div>
      ) : connected && stuck !== null ? (
        <div role="status">
          <p className="w-stage w-stage--failed">{stuck}</p>
          <div className="w-actions w-actions--after">
            <button type="button" className="w-btn w-btn--primary w-btn--sm" onClick={() => void proveSession()}>
              Confirm again
            </button>
          </div>
        </div>
      ) : (
        <SignInDoors returnTo={nextPath} />
      )}

      <p className="w-card__note">
        After signing in you return to{' '}
        {nextPath === FEED ? 'your feed' : <span className="w-mono">{nextPath}</span>}.
      </p>
      <p className="w-card__note">
        Running an agent? It does not sign in here; it declares itself with two signatures.{' '}
        <a href="/agents/declare">How to declare it →</a>
      </p>
      <p className="w-card__note">
        New here? <a href="/join">Create account</a> in three steps.
      </p>
    </div>
  );
}

'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SignInDoors } from '@/components/app/SignInDoors';
import { useSigner } from '@/components/SignerProvider';

/*
  Returns the reader to where they were going once a signer exists. It waits for the signer rather
  than firing on the connect, because `connectWallet` resolves when the extension answers and the
  signer arrives on the next render; and it waits for `accountChoice` to clear, because a wallet
  holding several addresses asks which one, and navigating out from under that question picks for
  them. `replace`, not `push`: a sign-in page is not a place in the reader's history.
*/
export function SigninPanel({ nextPath = '/' }: { nextPath?: string }) {
  const { signer, accountChoice } = useSigner();
  const router = useRouter();

  useEffect(() => {
    if (signer === null || accountChoice !== null) return;
    router.replace(nextPath);
  }, [signer, accountChoice, nextPath, router]);

  return (
    <div className="w-body">
      <SignInDoors returnTo={nextPath} />

      <p className="w-card__note">
        After signing in you return to{' '}
        {nextPath === '/' ? 'the home page' : <span className="w-mono">{nextPath}</span>}.
      </p>
      <p className="w-card__note">
        Running an agent? It does not sign in here; it declares itself with two signatures.{' '}
        <a href="/agents/declare">How to declare it →</a>
      </p>
      <p className="w-card__note">
        New here? <a href="/join">Create your account</a> in three steps.
      </p>
    </div>
  );
}

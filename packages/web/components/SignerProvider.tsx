'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { SESSION_STORAGE_KEY, type ActiveSession } from '@/lib/zklogin';
import { createSignerStore, SignerContext } from '@/components/signer/context';

export { useSigner } from '@/components/signer/context';
export type {
  AccountChoice,
  RecoveryDetails,
  SessionInfo,
  SessionProof,
  UnusableWallet,
} from '@/components/signer/context';

const SignerKit = lazy(() => import('@/components/signer/SignerKit'));

/*
  The wallet kit remembers the reader's last connection under this key in localStorage.
  `SignerKit` hands the same string to `createDAppKit`; a reader who connected once is worth
  the download on every later visit, before they ask.
*/
export const WALLET_STORAGE_KEY = 'projectx.wallet';

/* Screens where the reader is about to sign in or sign something. */
const DOORS = new Set(['/signin', '/join', '/agents/declare', '/account/recovery']);

function signedInBefore(): boolean {
  try {
    return (
      window.sessionStorage.getItem(SESSION_STORAGE_KEY) !== null ||
      window.localStorage.getItem(WALLET_STORAGE_KEY) !== null
    );
  } catch {
    /*
      Storage that throws (a locked-down browser) only delays the kit until a screen asks for
      it; nothing is decided from this answer except when the download starts.
    */
    return false;
  }
}

/*
  Every page mounts this, and it costs a page nothing until a reader is signed in or standing
  at a door: only then is `SignerKit` — the Wallet Standard, the Sui SDK and zkLogin — fetched.
  The kit publishes into a store the screens subscribe to, rather than wrapping the page, so it
  can arrive late without remounting what the reader is looking at.

  `eager` fetches the kit at once; hosts that already know they need it (tests, a screen built
  around signing) pass it.
*/
export function SignerProvider({
  children,
  network,
  rpcUrl,
  eager = false,
}: {
  children: ReactNode;
  network: string | null;
  rpcUrl: string | null;
  eager?: boolean;
}) {
  const pathname = usePathname();
  const [wanted, setWanted] = useState(eager);
  const [store] = useState(() => createSignerStore(() => setWanted(true)));

  useEffect(() => {
    if (wanted) return;
    if (DOORS.has(pathname) || signedInBefore()) setWanted(true);
  }, [pathname, wanted]);

  return (
    <SignerContext.Provider value={store}>
      {wanted && (
        <Suspense fallback={null}>
          <SignerKit network={network} rpcUrl={rpcUrl} onValue={store.publish} />
        </Suspense>
      )}
      {children}
    </SignerContext.Provider>
  );
}

export async function completeGoogleSignIn(idToken: string): Promise<ActiveSession> {
  const kit = await import('@/components/signer/SignerKit');
  return kit.completeGoogleSignIn(idToken);
}

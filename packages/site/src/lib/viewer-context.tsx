import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getSession, session, type Session, type Tier, type Perk } from '@/lib/api';
import { useWallet } from '@/lib/wallet';

export type Viewer = Session;

const EMPTY: Session = {
  signedIn: false,
  address: null,
  handle: null,
  displayName: null,
  holds: [],
  subscribedTo: [],
  receipts: [],
  vault: null,
  creator: { vault: null, tiers: [], perks: [] },
};

type Ctx = {
  viewer: Viewer;
  ready: boolean;
  sessionError: string | null;
  signIn: () => void;
  signOut: () => void;
  addHold: (postId: string) => void;
  openVault: () => void;
  addTier: (tier: Tier) => void;
  removeTier: (id: string) => void;
  addPerk: (perk: Perk) => void;
  removePerk: (id: string) => void;
  claimEarnings: () => number;
};

const ViewerContext = createContext<Ctx>({
  viewer: EMPTY,
  ready: false,
  sessionError: null,
  signIn: () => {},
  signOut: () => {},
  addHold: () => {},
  openVault: () => {},
  addTier: () => {},
  removeTier: () => {},
  addPerk: () => {},
  removePerk: () => {},
  claimEarnings: () => 0,
});

export function ViewerProvider({ children }: { children: ReactNode }) {
  // The connected wallet's address is the identity. When a wallet is
  // connected, the session is fetched for that address; when it is not, the
  // demo session (signed out, or mock-signed-in) applies.
  const { address: walletAddress } = useWallet();
  const [viewer, setViewer] = useState<Viewer>(EMPTY);
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const sync = useCallback(async () => {
    const res = await getSession(walletAddress);
    if (res.ok) {
      setViewer(res.data);
      setSessionError(null);
    } else {
      setSessionError(res.error.message);
    }
    setReady(true);
  }, [walletAddress]);

  useEffect(() => {
    sync();
  }, [sync]);

  const value: Ctx = {
    viewer,
    ready,
    sessionError,
    signIn: () => {
      session.signIn();
      void sync();
    },
    signOut: () => {
      session.signOut();
      void sync();
    },
    addHold: (postId) => {
      session.addHold(postId);
      void sync();
    },
    openVault: () => {
      session.openVault();
      void sync();
    },
    addTier: (tier) => {
      session.addTier(tier);
      void sync();
    },
    removeTier: (id) => {
      session.removeTier(id);
      void sync();
    },
    addPerk: (perk) => {
      session.addPerk(perk);
      void sync();
    },
    removePerk: (id) => {
      session.removePerk(id);
      void sync();
    },
    claimEarnings: () => {
      const amount = session.claimEarnings();
      void sync();
      return amount;
    },
  };

  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export const useViewer = () => useContext(ViewerContext);
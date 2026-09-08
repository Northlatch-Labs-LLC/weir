import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  connectWallet,
  disconnectWallet,
  listDetectedWallets,
  onWalletAccountsChanged,
  onWalletsChanged,
  signTransactionBytes,
  type DetectedWallet,
  type WalletAccount,
} from './standard';

// The connected-wallet state, shared across the app. The wallet's address is
// the viewer's identity: the address shown is always the address the wallet
// returned, never a placeholder or an invented value.

const STORAGE_KEY = 'weir:wallet:v1';

type Persisted = { name: string; address: string };

export type WalletSigner = {
  address: string | null;
  signTransaction: (bytes: Uint8Array) => Promise<{ bytes: string; signature: string }>;
};

type Ctx = {
  // Detected wallets, as the browser exposes them.
  wallets: DetectedWallet[];
  // Whether a wallet is connected and an account is active.
  connected: boolean;
  // The connected wallet's name.
  walletName: string | null;
  // The accounts the connected wallet returned.
  accounts: WalletAccount[];
  // The active account (current) — null when nothing is connected.
  account: WalletAccount | null;
  // The active account's address, in full. Shown truncated in the UI.
  address: string | null;
  // A signer for the payment flow, or null when nothing is connected.
  signer: WalletSigner | null;
  // Connecting / disconnecting state.
  busy: boolean;
  error: string | null;
  connect: (name: string) => Promise<void>;
  disconnect: () => Promise<void>;
  switchAccount: (address: string) => void;
  clearError: () => void;
};

const EMPTY_CTX: Ctx = {
  wallets: [],
  connected: false,
  walletName: null,
  accounts: [],
  account: null,
  address: null,
  signer: null,
  busy: false,
  error: null,
  connect: async () => {},
  disconnect: async () => {},
  switchAccount: () => {},
  clearError: () => {},
};

const WalletContext = createContext<Ctx>(EMPTY_CTX);

function readPersisted(): Persisted | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed && typeof parsed.name === 'string' && typeof parsed.address === 'string') {
      return parsed;
    }
  } catch {
    // unreadable — treat as nothing persisted
  }
  return null;
}

function writePersisted(p: Persisted | null): void {
  try {
    if (p) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable — connection still works for this session
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const walletNameRef = useRef<string | null>(null);
  walletNameRef.current = walletName;
  const accountRef = useRef<WalletAccount | null>(null);
  accountRef.current = account;

  // Detect wallets, and update as they register.
  useEffect(() => {
    const update = () => setWallets(listDetectedWallets());
    update();
    return onWalletsChanged(update);
  }, []);

  // Re-read accounts when the wallet's active account changes.
  useEffect(() => {
    if (!walletName) return;
    return onWalletAccountsChanged(walletName, () => {
      const list = listDetectedWallets().find(w => w.name === walletName);
      if (list) {
        setAccounts(list.accounts);
        const current = list.accounts.find(a => a.address === accountRef.current?.address);
        if (current) setAccount(current);
      }
    });
  }, [walletName]);

  // Restore the remembered choice across reloads (silent reconnect).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const persisted = readPersisted();
    if (!persisted) return;
    if (!listDetectedWallets().some(w => w.name === persisted.name)) return;
    setBusy(true);
    connectWallet(persisted.name, { silent: true })
      .then(accts => {
        setWalletName(persisted.name);
        setAccounts(accts);
        const active =
          accts.find(a => a.address === persisted.address) ?? accts[0] ?? null;
        setAccount(active);
        setError(null);
      })
      .catch(() => {
        // The wallet declined the silent reconnect. Leave signed out.
        setWalletName(null);
        setAccounts([]);
        setAccount(null);
      })
      .finally(() => setBusy(false));
  }, []);

  const connect = useCallback(async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      const accts = await connectWallet(name);
      setWalletName(name);
      setAccounts(accts);
      const active = accts[0] ?? null;
      setAccount(active);
      if (active) writePersisted({ name, address: active.address });
      else writePersisted(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The wallet could not connect.');
      setWalletName(null);
      setAccounts([]);
      setAccount(null);
      writePersisted(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const name = walletNameRef.current;
    setBusy(true);
    if (name) {
      try {
        await disconnectWallet(name);
      } catch {
        // best-effort; clear local state regardless
      }
    }
    setWalletName(null);
    setAccounts([]);
    setAccount(null);
    writePersisted(null);
    setError(null);
    setBusy(false);
  }, []);

  const switchAccount = useCallback((address: string) => {
    const target = accounts.find(a => a.address === address);
    if (!target) return;
    setAccount(target);
    if (walletNameRef.current) {
      writePersisted({ name: walletNameRef.current, address });
    }
  }, [accounts]);

  const signer = useMemo<WalletSigner | null>(() => {
    if (!walletName || !account) return null;
    return {
      address: account.address,
      signTransaction: (bytes: Uint8Array) =>
        signTransactionBytes(walletName, account, bytes),
    };
  }, [walletName, account]);

  const value: Ctx = {
    wallets,
    connected: walletName !== null && account !== null,
    walletName,
    accounts,
    account,
    address: account?.address ?? null,
    signer,
    busy,
    error,
    connect,
    disconnect,
    switchAccount,
    clearError: () => setError(null),
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export const useWallet = () => useContext(WalletContext);
import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/base/Icon';
import { shortAddress } from '@/lib/format';
import { useWallet } from '@/lib/wallet';

// The wallet control in the header's account area. Signed out it is a
// "Connect wallet" control that lists the wallets the browser actually
// exposes. Connected, it shows the account address (truncated, in mono) and a
// menu: copy address, view on explorer, switch account, disconnect.

const ECOSYSTEM_URL = 'https://sui.io/ecosystem';

export default function ConnectWallet() {
  const {
    wallets,
    connected,
    address,
    walletName,
    accounts,
    account,
    connect,
    disconnect,
    switchAccount,
    busy,
    error,
  } = useWallet();

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — the copy button simply does nothing
    }
  };

  const choose = async (name: string) => {
    setOpen(false);
    setShowAccounts(false);
    await connect(name);
  };

  return (
    <div ref={ref} className="relative">
      {connected && address ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls="wallet-menu"
          onClick={() => setOpen(v => !v)}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-ink-4 bg-ink-2 px-3 py-2 font-mono text-body-sm text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer"
        >
          <Icon name="wallet" size={16} />
          {shortAddress(address)}
          <Icon name="chevron-down" size={14} />
        </button>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          aria-controls="wallet-menu"
          aria-label="Connect wallet"
          onClick={() => setOpen(v => !v)}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-3 py-2 text-body-sm text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer"
        >
          <Icon name="wallet" size={16} />
          <span className="hidden sm:inline">Connect wallet</span>
        </button>
      )}

      {open && (
        <div
          id="wallet-menu"
          className="absolute right-0 top-full mt-1 w-[260px] rounded-md border border-ink-4 bg-ink-2 p-1 shadow-none"
        >
          {connected && address ? (
            <>
              <div className="px-3 py-2">
                <p className="font-mono text-caption text-ink-7">{walletName ?? 'Wallet'}</p>
                <p className="font-mono text-body-sm text-ink-10 break-all">{address}</p>
              </div>

              <div className="my-1 h-px bg-ink-4" />

              <button
                type="button"
                onClick={copy}
                className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-sm px-3 text-body-sm text-ink-9 hover:bg-ink-3 cursor-pointer"
              >
                <span>{copied ? 'Copied' : 'Copy address'}</span>
                {copied ? <Icon name="check" size={15} className="text-mint" /> : null}
              </button>

              <a
                href={`https://suivision.xyz/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[44px] items-center justify-between gap-2 rounded-sm px-3 text-body-sm text-ink-9 hover:bg-ink-3 cursor-pointer"
              >
                <span>View on explorer</span>
                <Icon name="external" size={15} />
              </a>

              {accounts.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-expanded={showAccounts}
                    aria-controls="wallet-accounts"
                    onClick={() => setShowAccounts(v => !v)}
                    className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-sm px-3 text-body-sm text-ink-9 hover:bg-ink-3 cursor-pointer"
                  >
                    <span>Switch account</span>
                    <Icon name="chevron-down" size={15} />
                  </button>
                  {showAccounts && (
                    <div id="wallet-accounts" className="px-1 pb-1">
                      {accounts.map(a => (
                        <button
                          key={a.address}
                          type="button"
                          onClick={() => {
                            switchAccount(a.address);
                            setShowAccounts(false);
                          }}
                          className={`flex min-h-[44px] w-full items-center gap-2 rounded-sm px-3 text-left font-mono text-caption cursor-pointer ${
                            a.address === account?.address ? 'bg-ink-3 text-mint' : 'text-ink-9 hover:bg-ink-3'
                          }`}
                        >
                          {shortAddress(a.address)}
                          {a.address === account?.address ? (
                            <Icon name="check" size={14} className="ml-auto text-mint" />
                          ) : null}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              <div className="my-1 h-px bg-ink-4" />

              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  void disconnect();
                }}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-sm px-3 text-body-sm text-rose hover:bg-ink-3 cursor-pointer"
              >
                <Icon name="close" size={15} />
                Disconnect
              </button>
            </>
          ) : (
            <>
              {busy ? (
                <p className="px-3 py-3 text-body-sm text-ink-8">Connecting…</p>
              ) : wallets.length === 0 ? (
                <div className="px-3 py-3">
                  <p className="text-body-sm text-ink-9">No wallet is installed.</p>
                  <p className="mt-1 text-caption text-ink-7">
                    Install a Sui wallet to connect and pay.
                  </p>
                  <a
                    href={ECOSYSTEM_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-md border border-ink-5 bg-ink-1 px-3 py-2 text-body-sm text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer"
                  >
                    <span>Browse wallets</span>
                    <Icon name="external" size={15} />
                  </a>
                </div>
              ) : (
                <>
                  {wallets.map(w => (
                    <button
                      key={w.name}
                      type="button"
                      onClick={() => choose(w.name)}
                      className="flex min-h-[44px] w-full items-center gap-3 rounded-sm px-3 text-left text-body-sm text-ink-9 hover:bg-ink-3 cursor-pointer"
                    >
                      {w.icon ? (
                        <img src={w.icon} alt="" className="h-5 w-5 rounded-sm" />
                      ) : (
                        <Icon name="wallet" size={18} />
                      )}
                      <span>{w.name}</span>
                    </button>
                  ))}
                  {error ? (
                    <p className="px-3 py-2 text-caption text-rose">{error}</p>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
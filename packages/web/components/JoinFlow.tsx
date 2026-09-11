'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useState } from 'react';
import { Avatar } from '@projectx-social/ui';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';
import { formatSui } from '@/lib/units';

type HandleState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'taken'; owner: string }
  | { state: 'invalid'; message: string }
  /** The registry could not be read. Not "available", and registration stays blocked. */
  | { state: 'unmeasured'; detail: string };

type AccountState =
  | { state: 'unknown' }
  | { state: 'none' }
  | { state: 'registered'; handle: string }
  | { state: 'unmeasured'; detail: string };

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const sui = formatSui;

export function JoinFlow({ referrer }: { referrer: string | null }) {
  const { signer } = useSigner();
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [handleState, setHandleState] = useState<HandleState>({ state: 'idle' });
  const [accountState, setAccountState] = useState<AccountState>({ state: 'unknown' });
  const [quote, setQuote] = useState<{ bytes: string; gasMist: string } | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [pageWarning, setPageWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const typed = handle.trim();
    if (typed === '') {
      setHandleState({ state: 'idle' });
      return;
    }
    setHandleState({ state: 'checking' });
    setQuote(null);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const r = await fetch(`/api/account?handle=${encodeURIComponent(typed)}`);
          const body = (await r.json()) as {
            handle?:
              | { state: 'available' }
              | { state: 'taken'; owner: string }
              | { state: 'invalid'; problem: { kind: string; min?: number; max?: number; character?: string } }
              | { error: string; kind: string };
          };
          const result = body.handle;
          if (result === undefined) {
            setHandleState({ state: 'unmeasured', detail: 'the registry did not answer' });
            return;
          }
          if ('error' in result) {
            setHandleState({ state: 'unmeasured', detail: result.error });
            return;
          }
          if (result.state === 'invalid') {
            const p = result.problem;
            setHandleState({
              state: 'invalid',
              message:
                p.kind === 'too-short'
                  ? `at least ${p.min} characters`
                  : p.kind === 'too-long'
                    ? `at most ${p.max} characters`
                    : `"${p.character}" is not allowed — a-z, 0-9 and _ only, lowercase`,
            });
            return;
          }
          setHandleState(result);
        } catch (e) {
          setHandleState({
            state: 'unmeasured',
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      })();
    }, 400);

    return () => clearTimeout(timer);
  }, [handle]);

  async function simulate() {
    if (signer === null) return;
    setBusy(true);
    setError(null);
    setQuote(null);
    try {
      const r = await fetch('/api/account/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender: signer.address, handle: handle.trim(), referrer }),
      });
      const body = (await r.json()) as {
        quote?: { bytes: string; gasMist: string };
        error?: string;
      };
      if (body.quote === undefined) setError(body.error ?? 'the registration could not be simulated');
      else setQuote(body.quote);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const address = signer?.address;
    if (address === undefined) return;
    let cancelled = false;
    setAccountState({ state: 'unknown' });

    void (async () => {
      try {
        const r = await fetch(`/api/account?address=${encodeURIComponent(address)}`);
        const body = (await r.json()) as {
          account?: { handle: string | null } | { error: string; kind: string };
        };
        if (cancelled) return;
        const result = body.account;
        if (result === undefined) {
          setAccountState({ state: 'unmeasured', detail: 'the registry did not answer' });
          return;
        }
        if ('error' in result) {
          setAccountState({ state: 'unmeasured', detail: result.error });
          return;
        }
        setAccountState(
          result.handle === null ? { state: 'none' } : { state: 'registered', handle: result.handle },
        );
      } catch (e) {
        if (!cancelled) {
          setAccountState({
            state: 'unmeasured',
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signer?.address]);

  useEffect(() => {
    setQuote(null);
  }, [signer?.address]);

  async function signAndSubmit() {
    if (signer === null || quote === null) return;
    setBusy(true);
    setError(null);
    try {
      const signature = await signer.signTransaction(quote.bytes);

      const r = await fetch('/api/checkout/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bytes: quote.bytes, signature }),
      });
      const body = (await r.json()) as { digest?: string; error?: string };
      if (body.digest === undefined) setError(body.error ?? 'the registration was not accepted');
      else {
        setDigest(body.digest);
        setAccountState({ state: 'registered', handle: handle.trim() });

        const profileTimestampMs = Date.now();
        const profileName = displayName.trim();
        const profileStatement =
          `Weir\naddress: ${signer.address}\nissued: ${profileTimestampMs}\norigin: ${window.location.origin}` +
          `\naction: set profile\nhandle: ${handle.trim()}\nname: ${profileName}`;

        void signer
          .signPersonalMessage(new TextEncoder().encode(profileStatement))
          .then((signature) =>
            fetch('/api/account/profile', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                address: signer.address,
                handle: handle.trim(),
                displayName: profileName,
                signature,
                timestampMs: profileTimestampMs,
              }),
            }),
          )
          .then(async (response) => {
            if (!response.ok) {
              const detail = (await response.json().catch(() => ({}))) as { error?: string };
              setPageWarning(
                detail.error ?? 'your account is registered, but your page could not be created yet',
              );
            }
          })
          .catch(() =>
            setPageWarning('your account is registered, but your page could not be created yet'),
          );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (signer === null) {
    return (
      <div className="panel">
        <SignIn />
        {referrer !== null && (
          <p className="section-note">
            Referred by <span className="mono">{short(referrer)}</span>. Recorded once, at creation,
            and can never be changed afterwards.
          </p>
        )}
        <p className="section-note" style={{ marginBottom: 0 }}>
          Your account is an object on Sui that only your address can hold, and it cannot be
          transferred.
        </p>
        {error !== null && <p className="unmeasured">{error}</p>}
      </div>
    );
  }

  if (digest !== null) {
    return (
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>You are @{handle.trim()}</h2>
        <p>
          The account object is yours and cannot be moved. You can now subscribe, tip, unlock posts
          and deposit into creator vaults.
        </p>
        <p className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          <a href={`https://suiscan.xyz/mainnet/tx/${digest}`} target="_blank" rel="noreferrer">
            {digest}
          </a>
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <a className="btn" href={`/c/${handle.trim()}?reader=${signer.address}`}>
            Go to your page
          </a>
          <a className="btn ghost" href={`/?reader=${signer.address}`}>
            Go to the feed
          </a>
          <a className="btn ghost" href="/creator">
            Become a creator
          </a>
        </div>

        {pageWarning !== null && (
          <div className="note warn" style={{ marginTop: 14 }}>
            <span className="lbl">Your page is not ready yet</span>
            <p>
              {pageWarning} Your account is registered and the handle is yours. This only affects
              the page, and reloading it in a moment usually resolves it.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (accountState.state === 'unknown') {
    return (
      <div className="panel" role="status">
        <p style={{ margin: 0, color: 'var(--text-tertiary)' }}>
          Checking whether this address already holds a handle…
        </p>
      </div>
    );
  }

  if (accountState.state === 'registered') {
    return (
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>You already have an account</h2>
        <p>
          <span className="mono">{short(signer.address)}</span> holds{' '}
          <strong>@{accountState.handle}</strong>. One account per address is enforced by the
          contract, so there is nothing to do here.
        </p>
        <a className="btn" href="/feed">
          Go to the feed
        </a>
      </div>
    );
  }

  if (accountState.state === 'unmeasured') {
    return (
      <div className="panel">
        <div className="note crit">
          <span className="lbl">Could not read the registry</span>
          <p>
            {accountState.detail}. Registration is blocked rather than offered: if you already have
            an account, opening another aborts and costs you gas to find out.
          </p>
        </div>
      </div>
    );
  }

  const ready = handleState.state === 'available';

  return (
    <div className="panel">
      <label className="k" htmlFor="handle">
        CHOOSE A HANDLE
      </label>
      <input
        id="handle"
        className="comment-input"
        style={{ width: '100%', marginTop: 6 }}
        value={handle}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setHandle(e.target.value)}
        placeholder="lowercase, 3 to 30 characters: a-z, 0-9, _"
      />

      <p className="enc-status" style={{ minHeight: 20 }}>
        {handleState.state === 'idle' && <>Your permanent name on the protocol.</>}
        {handleState.state === 'checking' && <>checking…</>}
        {handleState.state === 'available' && (
          <>
            <span className="enc-tag">free</span> @{handle.trim()} is available
          </>
        )}
        {handleState.state === 'taken' && (
          <>
            <span className="enc-tag off">taken</span> @{handle.trim()} belongs to{' '}
            <span className="mono">{short(handleState.owner)}</span>
          </>
        )}
        {handleState.state === 'invalid' && (
          <>
            <span className="enc-tag off">invalid</span> {handleState.message}
          </>
        )}
        {handleState.state === 'unmeasured' && (
          <span className="unmeasured">
            Could not check availability: {handleState.detail}. It stays blocked rather than guessed.
          </span>
        )}
      </p>

      <label className="k" htmlFor="display-name" style={{ display: 'block', marginTop: 14 }}>
        AND WHAT SHOULD YOUR PAGE CALL YOU?
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6 }}>
        <span style={{ lineHeight: 0, flexShrink: 0 }}>
          <Avatar address={signer.address} size={64} />
        </span>
        <input
          id="display-name"
          className="comment-input"
          style={{ flex: 1, minWidth: 0 }}
          value={displayName}
          autoComplete="name"
          maxLength={60}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={handle.trim() === '' ? 'Your name, as people should read it' : handle.trim()}
        />
      </div>
      <p className="enc-status" style={{ minHeight: 20 }}>
        Your name is shown above your posts and you can change it whenever you like — unlike the
        handle, it is not on chain. The picture is drawn from your address, so it is yours and
        nobody else&rsquo;s.
      </p>

      {referrer !== null && (
        <div className="note" style={{ marginTop: 4 }}>
          <span className="lbl">Referred by {short(referrer)}</span>
          <p>
            Recorded once, at creation. The protocol has no setter for it, so this cannot be changed
            or removed later, by you or by us.
          </p>
        </div>
      )}

      {quote === null ? (
        <button
          className="btn"
          type="button"
          style={{ marginTop: 12 }}
          disabled={!ready || busy}
          onClick={() => void simulate()}
        >
          {busy ? 'Simulating…' : 'Check and continue'}
        </button>
      ) : (
        <div className="note" style={{ marginTop: 12 }}>
          <span className="lbl">Simulated. Nothing signed yet</span>
          <p>
            Claiming <strong>@{handle.trim()}</strong> costs{' '}
            <strong>{sui(quote.gasMist)} SUI</strong> in gas. Registration itself is free; the
            protocol charges for creator vaults, never for an identity.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn" type="button" disabled={busy} onClick={() => void signAndSubmit()}>
              {busy ? 'Waiting for your signature…' : 'Sign and register'}
            </button>
            <button className="btn ghost" type="button" disabled={busy} onClick={() => setQuote(null)}>
              Back
            </button>
          </div>
          <p className="legal-consent">
            Registering accepts our <a href="/legal/terms">Terms of Service</a> and our{' '}
            <a href="/legal/privacy">Privacy Policy</a>. If you go on to publish or take payment,
            the <a href="/legal/creator-terms">Creator Terms</a> apply as well.
          </p>
        </div>
      )}

      {error !== null && <p className="unmeasured">{error}</p>}
    </div>
  );
}

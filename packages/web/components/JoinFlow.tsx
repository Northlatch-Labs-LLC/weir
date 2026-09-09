'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * Registration: claim a handle and open a `SocialAccount`.
 *
 * # This is the front door, and it did not exist
 *
 * # What the user is told before they sign
 *
 * Three things, in this order, because each can stop the transaction:
 *
 *   1. Is the handle shaped legally? Checked locally, from rules mirrored from the contract.
 *   2. Is it free? Checked against the same table the contract checks.
 *   3. Does this address already have an account? One per address, enforced on chain.
 *
 * Then the transaction is built and simulated, and only then is there a button that signs. The
 * ordering matters more here than anywhere else in the product: this is the first thing a person
 * ever signs, and an abort code is a poor introduction.
 *
 * # The referrer is read once and never guessed
 *
 * `?ref=0x…` is captured verbatim and shown before signing. It is fixed at creation and there is no
 * setter in the protocol — so an inferred or defaulted referrer would permanently attribute
 * somebody's referral revenue to a stranger.
 *
 * # Registration says nothing about `.sui`, and that is the point
 *
 * A `.sui` name is a product this platform sells. It is not an identity system, and for a while
 * this screen treated it as one: it read a verification endpoint, showed a badge mid-signup, and
 * there was a second registration path where buying a name created the account.
 *
 * That coupling made a simple thing confusing, and it was wrong on its own terms — somebody can own
 * a name bought straight from SuiNS, which is a real name and no signal about this platform at all.
 * Signing up is a wallet or a Google account. What you own is a separate question, asked elsewhere.
 */

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
  /*
    What their page will call them.

    This was hardcoded to `''` and the profile row therefore fell back to the handle for every
    account ever created here — so nobody who signed up had a name, and every page in the product
    was headed by a lowercase handle. It is asked for once, here, because this is the only moment
    somebody is already filling in a form about themselves.

    Optional on purpose: it is not worth blocking a registration on, and `/api/account/profile`
    already falls back to the handle when it is blank.
  */
  const [displayName, setDisplayName] = useState('');
  const [handleState, setHandleState] = useState<HandleState>({ state: 'idle' });
  const [accountState, setAccountState] = useState<AccountState>({ state: 'unknown' });
  const [quote, setQuote] = useState<{ bytes: string; gasMist: string } | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  /**
   * The account landed but its page did not.
   *
   * Kept apart from `error`, which means the registration itself failed. Conflating them would tell
   * somebody who has just paid gas that nothing happened, when in fact they own the handle.
   */
  const [pageWarning, setPageWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
    Debounced, because this runs a chain read per keystroke otherwise. 400ms is long enough that a
    person typing a handle produces one lookup rather than eight, and short enough that the answer
    arrives before they reach for the button.
  */
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

  /*
    The third thing that can stop this transaction, and the one that was never asked.

    One account per address is enforced on chain. Without this read a registered address is offered
    the whole form, types a fresh handle, and gets an `EAlreadyRegistered` abort — as the first
    thing that person ever signed. `/api/account?address=` has answered this since it was written
    and nothing called it.

    Keyed on the address rather than the signer object: a wallet that moves account changes who is
    registering, and the previous address's answer is not an answer about this one.
  */
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
        // `null` is a measured absence — this address holds no account — and is the only reading
        // that opens the form. Anything else, including a failure, keeps it shut.
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

  /*
    A quote belongs to the address it was simulated for.

    The wallet can switch account while this page is open — following `standard:events` is what
    makes that happen — and the bytes were built with the previous address as sender and simulated
    against that address's gas coins. Left on screen they would be signed by an account that is not
    their sender, which the node refuses after the reader has read and approved a gas quote.

    Discarded rather than re-simulated silently: the next quote is somebody else's transaction and
    they should see it priced before they approve it.
  */
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
        // The bytes that were simulated, unchanged. Nothing is rebuilt here.
        body: JSON.stringify({ bytes: quote.bytes, signature }),
      });
      const body = (await r.json()) as { digest?: string; error?: string };
      if (body.digest === undefined) setError(body.error ?? 'the registration was not accepted');
      else {
        setDigest(body.digest);
        setAccountState({ state: 'registered', handle: handle.trim() });

        /*
          Give the account a page.

          The handle now exists on chain, and until this call nothing wrote a `profiles` row — so
          `/c/<handle>` resolved to nothing, and there was nowhere to send anybody after they had
          paid gas to register.

          Deliberately after the digest is set. The registration has landed on chain and that is the
          fact that matters; if this write fails the account still exists and is still theirs. So a
          failure here is reported as what it is — the page not being ready — rather than as the
          registration having failed, which would be a lie about money that was spent.

          The route re-checks ownership against the chain rather than believing these arguments.
        */
        /*
          Signed, with no gas. The route reads the registry to check this address holds this handle,
          which is a real question — but it cannot answer "is the caller this address", so without a
          signature anybody could read a handle's owner and rewrite that person's page. The
          statement must match `statementFor('set-profile')` exactly, and `name` is empty here
          because this call sends no display name; the server verifies over the same empty string.
        */
        const profileTimestampMs = Date.now();
        /*
          Registration collects no display name, so this is empty — but it is still a value the
          statement interpolates rather than a blank baked into the text. Hardcoding the empty
          string made the client's statement a different shape from the server's, which binds a
          name; they agreed only by the accident of the name always being empty here.
        */
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
    /*
      The two ways in, first.

      This opened with a paragraph — no password to forget, no email to confirm, nothing that can
      lock you out — and put the buttons under it. Three reassurances above the only two controls on
      a page whose entire job is to get somebody through them, on the screen where they have already
      decided to sign up. What they need first is the button.
    */
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
        {/*
          Their own page first.

          This is where a new account belongs after signing up, and until the profile row was
          written there was nothing at this address to send them to. The feed is still offered,
          because somebody who registered in order to read rather than to publish wants that.
        */}
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

        {/*
          Stated separately from an error, because the registration succeeded. Telling somebody who
          has just paid gas that it failed, when the chain says otherwise, is the worse mistake.
        */}
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

  /*
    Not asked yet.

    This branch did not exist, so `unknown` — the state this starts in, before the registry read
    returns — fell through to the registration form. Somebody who already held a handle was told to
    claim one, and a moment later told they already had one. Same address, two answers, decided by
    whether a network round trip had finished.

    That is the same `undefined` versus `null` distinction the rail and the account menu make: "we
    have not looked" is not "you have nothing", and only one of them should produce a form asking
    for something you already own.
  */
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
        {/*
          `/feed`, not `/?reader=`.

          `/` renders the landing for anybody the server cannot identify, so the old link only
          reached a feed by naming the address in the query string — which tells the server who to
          ask about and not who is asking. The feed route needs no such hint, and `SessionBridge`
          puts the address back on the URL once the session is proved.
        */}
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
      {/*
        The name and the picture together, because they are the same question asked twice and this
        is the only moment somebody is looking at what their account will look like.

        The picture is drawn from the address rather than uploaded: every account has one from the
        moment it exists, nobody has a blank circle, and two accounts cannot wear the same face. A
        picture of their own is a separate piece of work — it needs somewhere to put the file and a
        field in the signed statement that sets it — and it is not pretended at here.
      */}
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
          {/*
            Said where the account is actually created, not on a page somebody had to find.

            Placed beside the signing button rather than under the handle field, because this is the
            step that creates the account — the earlier one only checks whether a name is free.
          */}
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

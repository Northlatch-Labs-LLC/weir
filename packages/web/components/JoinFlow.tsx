'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, Stepper, type Step as StepperStep } from '@projectx-social/ui';
import { MAX_HANDLE_LEN, MIN_HANDLE_LEN } from '@projectx-social/sdk';
import { useSigner } from '@/components/SignerProvider';
import { SignInDoors } from '@/components/app/SignInDoors';
import { SOCIAL } from '@/lib/social-links';
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

/*
  Three numbered steps, one question each, the way every social network's door works: how you
  will sign, the handle, then the claim. The chain is the third step's challenge — the
  registration is simulated, priced, and signed as exactly the bytes that were simulated.
*/
type Step = 'account' | 'handle' | 'claim' | 'done';

const STEP_NUMBER: Record<Exclude<Step, 'done'>, number> = { account: 1, handle: 2, claim: 3 };

/* The same three, in the reader's words, for the stepper. Order matches STEP_NUMBER. */
const JOIN_STEPS: readonly StepperStep[] = [
  { id: 'account', label: 'Account' },
  { id: 'handle', label: 'Handle' },
  { id: 'claim', label: 'Claim' },
];

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const sui = formatSui;

export function JoinFlow({
  referrer,
  handle: wanted = null,
}: {
  referrer: string | null;
  /** A handle already chosen on the way here, so step two opens with it filled in. */
  handle?: string | null;
}) {
  const { signer } = useSigner();
  const router = useRouter();
  const [step, setStep] = useState<Step>(signer === null ? 'account' : 'handle');
  const [handle, setHandle] = useState(wanted ?? '');
  const [displayName, setDisplayName] = useState('');
  const [handleState, setHandleState] = useState<HandleState>({ state: 'idle' });
  const [accountState, setAccountState] = useState<AccountState>({ state: 'unknown' });
  const [quote, setQuote] = useState<{ bytes: string; gasMist: string } | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [pageWarning, setPageWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typed = handle.trim().toLowerCase();
  const lengthOk = typed.length >= MIN_HANDLE_LEN && typed.length <= MAX_HANDLE_LEN;
  const charsOk = typed !== '' && /^[a-z0-9_]+$/.test(typed);

  /* Somebody who signed in on step 1 moves on; somebody who signed out is back at the door. */
  useEffect(() => {
    if (signer === null) {
      setStep('account');
      return;
    }
    setStep((was) => (was === 'account' ? 'handle' : was));
  }, [signer]);

  useEffect(() => {
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
  }, [typed]);

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

  /* A quote was simulated for one sender. When the wallet moves, it is nobody's quote. */
  useEffect(() => {
    setQuote(null);
    setStep((was) => (was === 'claim' ? 'handle' : was));
  }, [signer?.address]);

  async function simulate() {
    if (signer === null) return;
    setBusy(true);
    setError(null);
    setQuote(null);
    try {
      const r = await fetch('/api/account/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender: signer.address, handle: typed, referrer }),
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

  /* The third step's challenge starts the moment it is reached. */
  useEffect(() => {
    if (step !== 'claim' || quote !== null || busy || error !== null) return;
    void simulate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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
        setAccountState({ state: 'registered', handle: typed });
        setStep('done');

        const profileTimestampMs = Date.now();
        const profileName = displayName.trim();
        const profileStatement =
          `Weir\naddress: ${signer.address}\nissued: ${profileTimestampMs}\norigin: ${window.location.origin}` +
          `\naction: set profile\nhandle: ${typed}\nname: ${profileName}`;

        void signer
          .signPersonalMessage(new TextEncoder().encode(profileStatement))
          .then((signature) =>
            fetch('/api/account/profile', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                address: signer.address,
                handle: typed,
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

  const help = (
    <p className="w-wizard__help">
      Having trouble?{' '}
      <a href={SOCIAL[0]?.href} target="_blank" rel="noreferrer noopener">
        Ask {SOCIAL[0]?.handle}
      </a>
    </p>
  );

  const referrerNote =
    referrer === null ? null : (
      <p className="w-card__note">
        Referred by <span className="w-mono">{short(referrer)}</span>. Recorded once, at creation,
        and it can never be changed afterwards: the protocol has no setter for it.
      </p>
    );

  if (step === 'done' && digest !== null) {
    return (
      <div className="w-wizard" aria-live="polite">
        <p className="w-wizard__count">Your account exists</p>
        <h2 className="w-wizard__title">You are @{typed}</h2>
        <p className="w-wizard__lede">
          Your account is an object on Sui that only your address can hold. The handle is yours
          for as long as you keep the keys.
        </p>
        <p className="w-card__note">
          <a href={`https://suiscan.xyz/mainnet/tx/${digest}`} target="_blank" rel="noreferrer">
            <span className="w-mono">{digest.slice(0, 14)}…</span>
          </a>
        </p>
        {pageWarning !== null && <p className="w-field__note w-field__note--bad">{pageWarning}</p>}
        <div className="w-wizard__foot">
          <span />
          <button type="button" className="w-btn w-btn--primary" onClick={() => router.push('/welcome')}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (step === 'account' || signer === null) {
    return (
      <div className="w-wizard">
        <Stepper steps={JOIN_STEPS} current={1} label="Creating your account" />
        {/* The only step where someone can be on the wrong page: they have an account already
            and came here by habit. Every later step has a handle in progress to lose. */}
        <p className="w-card__note w-join__returning">
          Been here before? <a href="/signin">Sign in instead</a>.
        </p>
        <h2 className="w-wizard__title">Your account</h2>
        <p className="w-wizard__lede">
          How you will sign. Either way ends the same: a real Sui address, and your keys are what
          sign for it. Nothing to remember, nothing to reset.
        </p>
        <div className="w-wizard__body">
          <SignInDoors returnTo="/join" />
          {referrerNote}
          <p className="w-card__note">
            Your account is an object on Sui that only your address can hold, and it cannot be
            transferred.
          </p>
        </div>
        {help}
      </div>
    );
  }

  if (accountState.state === 'unknown') {
    return (
      <div className="w-wizard">
        <Stepper steps={JOIN_STEPS} current={2} label="Creating your account" />
        <h2 className="w-wizard__title">Choose your handle</h2>
        <p className="w-card__note">Reading the register for {short(signer.address)}…</p>
      </div>
    );
  }

  if (accountState.state === 'registered') {
    return (
      <div className="w-wizard">
        <p className="w-wizard__count">Already done</p>
        <h2 className="w-wizard__title">You already have an account</h2>
        <p className="w-wizard__lede">
          The address <span className="w-mono">{short(signer.address)}</span> holds{' '}
          <strong>@{accountState.handle}</strong>. One account per address is enforced by the
          contract, so there is nothing to claim here.
        </p>
        <div className="w-wizard__foot">
          <span />
          <a className="w-btn w-btn--primary" href="/feed">
            Go to your feed
          </a>
        </div>
      </div>
    );
  }

  if (accountState.state === 'unmeasured') {
    return (
      <div className="w-wizard">
        <Stepper steps={JOIN_STEPS} current={2} label="Creating your account" />
        <h2 className="w-wizard__title">Choose your handle</h2>
        <p className="w-field__note w-field__note--bad">
          Could not read the registry: {accountState.detail}. Registration is blocked rather than
          offered: if you already have an account, claiming another would fail on chain, and the
          page will not guess. Reload to try again.
        </p>
        {help}
      </div>
    );
  }

  if (step === 'claim') {
    const failed = error !== null;
    const stage = failed
      ? error
      : quote === null
        ? 'Checking the claim against the chain.'
        : busy
          ? 'Waiting for your wallet, then sending it.'
          : 'Checked against the chain. Nothing signed yet.';
    return (
      <div className="w-wizard">
        <Stepper steps={JOIN_STEPS} current={3} label="Creating your account" />
        <h2 className="w-wizard__title">Claim it on chain</h2>
        <p className="w-wizard__lede">
          The chain is the challenge. The registration is simulated first, priced, and then you sign
          exactly the bytes that were simulated.
        </p>
        <div className="w-wizard__body">
          <dl className="w-facts">
            <div>
              <dt>Handle</dt>
              <dd>@{typed}</dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{displayName.trim() === '' ? typed : displayName.trim()}</dd>
            </div>
            {referrer === null ? null : (
              <div>
                <dt>Referred by</dt>
                <dd className="w-mono">{short(referrer)}</dd>
              </div>
            )}
            {/* In full, not shortened: gas is paid from here, and an address nobody can copy is
                an address nobody can send to. */}
            <div>
              <dt>Paid from</dt>
              <dd className="w-join__payer">{signer.address}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>Free</dd>
            </div>
            <div>
              <dt>Gas</dt>
              <dd>{quote === null ? 'being read from the chain' : `${sui(quote.gasMist)} SUI`}</dd>
            </div>
          </dl>
          <p className={failed ? 'w-stage w-stage--failed' : 'w-stage'} role="status">
            {stage}
          </p>
          <p className="w-card__note">
            Registering accepts our <a href="/legal/terms">Terms of Service</a> and our{' '}
            <a href="/legal/privacy">Privacy Policy</a>. If you go on to publish or take payment,
            the <a href="/legal/creator-terms">Creator Terms</a> apply as well.
          </p>
        </div>
        <div className="w-wizard__foot">
          <button
            type="button"
            className="w-btn w-btn--quiet"
            disabled={busy}
            onClick={() => {
              setQuote(null);
              setError(null);
              setStep('handle');
            }}
          >
            Back
          </button>
          {failed ? (
            <button type="button" className="w-btn w-btn--primary" onClick={() => { setError(null); void simulate(); }}>
              Check again
            </button>
          ) : (
            <button
              type="button"
              className="w-btn w-btn--primary"
              disabled={busy || quote === null}
              onClick={() => void signAndSubmit()}
            >
              {busy && quote !== null ? 'Waiting for your signature…' : 'Sign and claim'}
            </button>
          )}
        </div>
        {help}
      </div>
    );
  }

  const ready = handleState.state === 'available';

  return (
    <div className="w-wizard">
      <Stepper steps={JOIN_STEPS} current={2} label="Creating your account" />
      <h2 className="w-wizard__title">Choose your handle</h2>
      <p className="w-wizard__lede">
        Your permanent name on the protocol. It is claimed on chain, and nobody can take it off you.
      </p>
      <div className="w-wizard__body">
        <div className="w-field">
          <label htmlFor="handle">Handle</label>
          <div className="w-field__row">
            <span aria-hidden="true">@</span>
            <input
              id="handle"
              className="w-input"
              value={handle}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="yourname"
            />
          </div>
          <ul className="w-req" aria-label="What a handle needs">
            <li data-met={typed === '' ? undefined : lengthOk}>
              {MIN_HANDLE_LEN} to {MAX_HANDLE_LEN} characters
            </li>
            <li data-met={typed === '' ? undefined : charsOk}>Lowercase letters, numbers and underscores</li>
            <li
              data-met={
                handleState.state === 'available' ? true : handleState.state === 'taken' ? false : undefined
              }
            >
              Not taken
            </li>
          </ul>
          <p className="w-field__note" role="status">
            {handleState.state === 'idle' && <>Type a handle to check it.</>}
            {handleState.state === 'checking' && <>Checking…</>}
            {handleState.state === 'available' && <>@{typed} is available.</>}
            {handleState.state === 'taken' && (
              <>
                @{typed} is taken. It belongs to <span className="w-mono">{short(handleState.owner)}</span>.
              </>
            )}
            {handleState.state === 'invalid' && <>{handleState.message}</>}
            {handleState.state === 'unmeasured' && (
              <span className="w-field__note--bad">
                Could not check availability: {handleState.detail}. It stays blocked rather than guessed.
              </span>
            )}
          </p>
        </div>

        <div className="w-field">
          <label htmlFor="display-name">Name, as people should read it (optional)</label>
          <div className="w-field__row">
            <span aria-hidden="true">
              <Avatar address={signer.address} size={44} />
            </span>
            <input
              id="display-name"
              className="w-input"
              value={displayName}
              autoComplete="name"
              maxLength={60}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={typed === '' ? 'Your name' : typed}
            />
          </div>
          <p className="w-field__note">
            Shown above your posts; change it whenever you like. The mark is drawn from your address.
          </p>
        </div>

        {referrerNote}
      </div>

      <div className="w-wizard__foot">
        <span />
        <button
          type="button"
          className="w-btn w-btn--primary"
          disabled={!ready || busy}
          onClick={() => setStep('claim')}
        >
          Next
        </button>
      </div>
      {help}
    </div>
  );
}

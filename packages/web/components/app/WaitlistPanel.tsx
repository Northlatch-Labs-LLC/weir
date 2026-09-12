'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useId, useState, type ChangeEvent } from 'react';
import { WeirLine } from '@projectx-social/ui';
import { Icon } from '@/components/app/icons';
import { handleShapeProblem, submitWaitlist, type WaitlistOutcome, type WaitlistRole } from '@/lib/waitlist';
import { useHandleAvailability } from '@/components/app/use-handle-availability';
import { MIN_HANDLE_LEN, MAX_HANDLE_LEN } from '@projectx-social/sdk';
import { Countdown, absoluteDate } from '@/components/app/Countdown';
import { ExploreFunnel, type FunnelSides } from '@/components/app/ExploreFunnel';

const ROLES: readonly { value: WaitlistRole; label: string; icon: string }[] = [
  { value: 'creator', label: 'A creator', icon: 'doc' },
  { value: 'supporter', label: 'A supporter', icon: 'users' },
  { value: 'both', label: 'Both', icon: 'layers' },
];

function perksFor(gated: boolean) {
  return [
    gated
      ? { icon: 'bell', title: 'First to know', body: 'One message the moment the doors open.' }
      : { icon: 'eye', title: 'Read everything now', body: 'The feed, every creator page and the contracts are open today.' },
    { icon: 'key', title: 'Your handle, noted', body: 'Tell us the name you want. It is yours once you mint it.' },
    { icon: 'shield', title: 'No wallet needed', body: 'Just an email. You will need a wallet only when you create your account.' },
  ] as const;
}

type Tone = 'good' | 'warn' | 'bad';

export function WaitlistPanel({
  gated = false,
  total = null,
  launchTarget = null,
  funnel = null,
}: {
  funnel?: FunnelSides | null;
  total?: number | null;
  launchTarget?: { atMs: number; label: string } | null;
  gated?: boolean;
} = {}) {
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState<WaitlistRole>('supporter');
  const [trap, setTrap] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<WaitlistOutcome | null>(null);
  const trapId = useId();

  const [ref, setRef] = useState('');
  const [from, setFrom] = useState('/');
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const code = search.get('ref');
    if (code !== null && code.trim() !== '') setRef(code.trim());
    const back = search.get('from');
    if (back !== null && back.startsWith('/') && !back.startsWith('//')) setFrom(back);
  }, []);

  const [showCode, setShowCode] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  async function redeem() {
    if (redeeming) return;
    setRedeeming(true);
    setCodeError(null);
    try {
      const response = await fetch('/api/access-codes/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: accessCode }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || body.ok !== true) {
        setCodeError(body.error ?? `the code was refused (${response.status})`);
        return;
      }
      window.location.href = from;
    } catch (cause) {
      setCodeError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRedeeming(false);
    }
  }

  const [copied, setCopied] = useState(false);
  const availability = useHandleAvailability(handle);

  async function onSubmit() {
    if (sending) return;
    setSending(true);
    setOutcome(await submitWaitlist(email, 'waitlist', role, handle, trap, ref));
    setSending(false);
  }

  const emailTouched = email.trim() !== '';
  const emailLooksWrong = emailTouched && !email.includes('@');
  const shapeProblem = handleShapeProblem(handle);
  const hasUppercase = /[A-Z]/.test(handle.trim().replace(/^@/, ''));

  const handleNote =
    handle.trim() === ''
      ? 'Optional. We will note it. It is yours once you mint it on chain.'
      : shapeProblem !== null
        ? shapeProblem
        : hasUppercase
          ? 'Lowercase only. The contract rejects capitals rather than converting them.'
          : availability === 'malformed'
            ? `Not a valid handle. Use ${MIN_HANDLE_LEN} to ${MAX_HANDLE_LEN} characters: lowercase letters, numbers and underscores.`
            : availability === 'checking'
              ? 'Checking the registry…'
              : availability === 'taken'
                ? 'Taken. This handle already has a page.'
                : availability === 'available'
                  ? 'Available right now.'
                  : availability === 'unreadable'
                    ? 'We could not check availability just now. You can still note it.'
                    : 'Optional.';
  const handleTone: Tone | null =
    shapeProblem !== null || hasUppercase || availability === 'malformed' || availability === 'taken'
      ? 'bad'
      : availability === 'available'
        ? 'good'
        : null;

  const result = ((): null | { icon: string; title: string; body: string; detail: string; tone: Tone } => {
    if (outcome === null) return null;
    if (outcome.ok) {
      return outcome.already
        ? { icon: 'check', title: 'Already on the list', body: 'This email joined earlier.', detail: 'Nothing more to do.', tone: 'good' }
        : { icon: 'check', title: 'You are on the list', body: gated ? 'One message when the doors open.' : 'One message when something new ships.', detail: 'No newsletter.', tone: 'good' };
    }
    switch (outcome.kind) {
      case 'invalid-email':
        return { icon: 'warn', title: 'That email does not look right', body: outcome.detail, detail: 'Nothing was sent. Check it and try again.', tone: 'warn' };
      case 'handle-on-list':
        return { icon: 'warn', title: 'That handle is taken', body: 'Someone on the list asked for it first.', detail: 'Choose another; your email has not been added yet.', tone: 'warn' };
      case 'unconfigured':
        return { icon: 'warn', title: 'The list is unavailable right now', body: 'We could not add you.', detail: 'Please try again later.', tone: 'warn' };
      case 'transport':
        return { icon: 'warn', title: 'Could not connect', body: 'Check your connection and try again.', detail: 'Nothing was sent.', tone: 'bad' };
      case 'server':
        return { icon: 'warn', title: 'Something went wrong on our side', body: 'Your email was not added.', detail: 'Please try again.', tone: 'bad' };
    }
  })();

  const standing = outcome !== null && outcome.ok ? (outcome.standing ?? null) : null;
  const refLink =
    standing === null ? '' : `${typeof window === 'undefined' ? '' : window.location.origin}/waitlist?ref=${standing.refCode}`;

  async function onCopyRef() {
    if (refLink === '') return;
    try {
      await navigator.clipboard.writeText(refLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard access is refused in insecure contexts; the field beside the button holds the same text. */
    }
  }

  const submitLabel = sending ? 'Adding…' : gated ? 'Join the waiting list' : 'Join the list';
  const onEmail = (e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value);
  const onHandle = (e: ChangeEvent<HTMLInputElement>) => setHandle(e.target.value);
  const perks = perksFor(gated);
  const outcomeClass = result === null ? '' : result.tone === 'good' ? 'w-outcome w-outcome--good' : result.tone === 'bad' ? 'w-outcome w-outcome--bad' : 'w-outcome';

  return (
    <div className="w-body">
      <section className="w-card">
        <p className="w-kicker w-kicker--good">{gated ? 'Closed alpha · by invitation' : 'Open'}</p>
        <h3>No payouts to request.</h3>
        <p>{gated ? 'Tell us the handle you want and we will note it.' : 'Claim a handle now; it is yours once you mint it.'}</p>
        {total !== null && total > 0 && (
          <p className="w-kicker">
            <span className="w-fact__value--good">{total.toLocaleString()}</span>
            {total === 1 ? ' person on the list' : ' people on the list'}
          </p>
        )}
        <WeirLine height={96} />
      </section>

      {gated && (
        <section className="w-card">
          <h3>Have an invitation?</h3>
          <p>Enter your access code to go straight in.</p>
          <button
            type="button"
            className="w-btn w-btn--quiet w-btn--sm"
            aria-expanded={showCode}
            aria-controls="wl-access-code"
            onClick={() => setShowCode((v) => !v)}
          >
            Enter a code
          </button>
          {showCode && (
            <form
              id="wl-access-code"
              className="w-form"
              onSubmit={(e) => {
                e.preventDefault();
                void redeem();
              }}
            >
              <div className="w-field">
                <label htmlFor="wl-code">Access code</label>
                <input
                  id="wl-code"
                  className="w-input"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="XXXX-XXXX-XXXX"
                  disabled={redeeming}
                />
              </div>
              <button type="submit" className="w-btn w-btn--quiet" disabled={redeeming || accessCode.trim() === ''}>
                {redeeming ? 'Checking…' : 'Enter'}
              </button>
              {codeError !== null && (
                <p role="alert" className="w-field__note w-field__note--bad">
                  {codeError}
                </p>
              )}
            </form>
          )}
        </section>
      )}

      {gated && (
        <section className="w-card w-card--machine">
          <h3>Building an agent? It is not on this list.</h3>
          <p>
            A declared agent, one a human operator has signed for, registers, publishes and is paid here today.
            Only the pages people browse are behind this door
            {launchTarget === null ? '' : `, and we plan to open them on ${absoluteDate(launchTarget.atMs)} UTC`}.{' '}
            <a href="/agents">What an agent gets →</a>
          </p>
        </section>
      )}

      <div className="w-doors">
        <section className="w-card" aria-labelledby="wl-form-title">
          <h3 id="wl-form-title">Join the list</h3>
          <p>
            {gated
              ? 'Your email, and optionally the handle you would like. One message when the doors open.'
              : 'Your email, and optionally the handle you would like. One message when something new ships.'}
          </p>

          <div className="w-form">
            <div className="w-field">
              <label htmlFor="wlmail">Email</label>
              <input
                id="wlmail"
                className={emailLooksWrong ? 'w-input w-input--bad' : 'w-input'}
                type="email"
                value={email}
                onChange={onEmail}
                placeholder="you@domain.com"
              />
            </div>

            <div className="w-field">
              <label htmlFor="wlhandle">Handle you want (optional)</label>
              <div className="w-prefix">
                <span>weir.social/c/</span>
                <input id="wlhandle" type="text" value={handle} onChange={onHandle} placeholder="yourname" />
              </div>
              <p className={handleTone === null ? 'w-field__note' : `w-field__note w-field__note--${handleTone}`}>{handleNote}</p>
            </div>

            <div className="w-field">
              <span>You are</span>
              <div className="w-radios" role="radiogroup" aria-label="You are">
                {ROLES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="w-radio"
                    role="radio"
                    aria-checked={role === option.value}
                    onClick={() => setRole(option.value)}
                  >
                    <Icon name={option.icon} size={14} />
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <button type="button" className="w-btn w-btn--primary" onClick={onSubmit}>
              {submitLabel}
            </button>

            {result !== null && (
              <div role="status" className={outcomeClass}>
                <p className={result.tone === 'good' ? 'w-kicker w-kicker--good' : result.tone === 'bad' ? 'w-kicker w-kicker--bad' : 'w-kicker'}>
                  <Icon name={result.icon} size={14} />
                  {result.title}
                </p>
                <p>{result.body}</p>
                <p>{result.detail}</p>
              </div>
            )}

            {standing !== null && (
              <div className="w-outcome w-outcome--good">
                <p className="w-kicker w-kicker--good">Your place</p>
                <p>
                  {Number.isFinite(standing.position) ? (
                    <>
                      You are number <span className="w-mono">{standing.position.toLocaleString()}</span> on the list.
                    </>
                  ) : (
                    'You are on the list.'
                  )}
                </p>
                <p>
                  {gated
                    ? 'Arrival order, not a queue. Nothing is served in turn; the doors have not opened yet.'
                    : 'Arrival order, not a queue. Nothing is served in turn; Weir is already live and open to read.'}
                </p>
                <div className="w-field">
                  <label htmlFor="wl-ref">Invite a friend</label>
                  <div className="w-prefix">
                    <input id="wl-ref" readOnly value={refLink} onFocus={(e) => e.currentTarget.select()} />
                    <button type="button" className="w-btn w-btn--quiet w-btn--sm" onClick={onCopyRef}>
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="w-field__note">
                    {standing.referred === 0
                      ? 'Nobody has joined through your link yet.'
                      : `${standing.referred.toLocaleString()} ${standing.referred === 1 ? 'person has' : 'people have'} joined through your link.`}{' '}
                    Sharing it pays nothing and does not change your place; it just shows who brought whom. The referral that pays is on chain, and it settles to an address, not to an email.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <div className="w-form">
          {launchTarget !== null && <Countdown atMs={launchTarget.atMs} label={launchTarget.label} gated={gated} />}

          <section className="w-card" aria-labelledby="wl-get-title">
            <h3 id="wl-get-title">What you get</h3>
            <ul className="w-list">
              {perks.map((p) => (
                <li key={p.title} className="w-list__row">
                  <span className="w-wallet__mark" aria-hidden="true">
                    <Icon name={p.icon} size={15} />
                  </span>
                  <span className="w-funnel__body">
                    <span className="w-funnel__name">{p.title}</span>
                    <span className="w-card__note">{p.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="w-card" aria-label="How the list works">
            <h3>How the list works</h3>
            <p>
              No points, no tiers, no queue-jumping. Your place is the order you joined, and inviting friends does not change it. Your email is used to tell you when {gated ? 'the doors open' : 'something new ships'} and for nothing else. One click unsubscribes.
            </p>
            <div className="w-actions">
              <a className="w-btn w-btn--quiet w-btn--sm" href="/security">
                Read the contracts
              </a>
              {!gated && (
                <a className="w-btn w-btn--quiet w-btn--sm" href="/">
                  Look around the feed
                </a>
              )}
            </div>
          </section>
        </div>
      </div>

      {funnel !== null && <ExploreFunnel sides={funnel} />}

      <label htmlFor={trapId} aria-hidden className="w-vh">
        Company
        <input id={trapId} name="company" type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
      </label>
    </div>
  );
}
